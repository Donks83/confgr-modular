// Do two parts occupy the same space?
//
// §3.6 has listed collision refusal as missing since the first session, and it
// stayed a line on a list until it cost something. It cost something twice:
//
//   * a 920 mm desktop was made to span the full ladder spacing, and ran
//     straight through one ladder's uprights. Fourteen probe scenarios agreed
//     it was fine, because every assertion in them was a coordinate somebody
//     had predicted, and none of them asked whether two parts were in the same
//     place. Matt looked at a render.
//   * the same board, one session earlier, was resolved 5 mm too far back and
//     passed through the clamping angle.
//
// THIS FILE DELIBERATELY DOES NOT REFUSE ANYTHING. It measures, and the
// measurement is reported. That is not caution for its own sake — it is the
// order the problem has to be solved in, and the reason is worth stating
// before anyone is tempted to add a threshold:
//
// A BOUNDING BOX IS THE WRONG SHAPE FOR THIS RANGE. Almost every joint here is
// two pieces of pressed steel deliberately interpenetrating. A shelf's end
// bracket WRAPS the frame. A hang accessory HOOKS OVER a rung. The clamping
// angle's top foot LAPS FORWARD over the desktop. Every one of those is a real
// box overlap and every one of them is correct. Meanwhile a desk passing
// through a ladder overlaps by the ladder's 30 mm width — the same order of
// magnitude as the bracket that is supposed to wrap it.
//
// So a flat depth threshold cannot separate right from wrong, and one picked
// before looking at the numbers would be picked to agree with whatever was
// believed that morning. The report was built first and run across every
// scenario, and what it found is written up in describeOverlap: a lap is
// BOUNDED BY THE THING BEING LAPPED, and anything deeper did not stop.
//
// WHY THIS STILL DOES NOT REFUSE, having found a rule that works. Because the
// first thing the rule flagged on the real range was WRONG. `officeclamp`
// reports the two clamping angles as passing through the desktop by 25 mm —
// the board's whole thickness — and they are not. The angle is an L: a 4 mm
// upright at z -10..-6 and a 3 mm foot lapping forward to z +10, with the
// board's back edge sitting in the corner between them. The board is wholly
// inside the angle's BOUNDING BOX and touches almost none of its metal.
//
// That is the honest limit of this file, demonstrated on a real part rather
// than argued from first principles: a box is the wrong shape for an L. What
// fixes it is authored collision proxies — the `col-` node convention the
// pipeline already reserves and nothing in the range yet uses — and until those
// exist the report belongs in the probe harness, where it is read by somebody
// who knows what an L-section is, and NOT in the panel, where it would tell a
// customer their correct desk is broken.

import { sub, dot, cross, rotateVec, length, normalise } from './vec.js';

/**
 * Two overlapping boxes must share at least this much before it is worth
 * mentioning, in metres.
 *
 * 0.5 mm. Not a tolerance for "how much overlap is allowed" — that decision is
 * not being made here — but a floor under floating-point noise and under the
 * coincident faces every packer joint produces. A shelf sitting ON a rung has
 * two surfaces at the same height, and calling that a collision would bury the
 * report in every joint in the product.
 */
export const CONTACT_EPS_M = 0.0005;

/**
 * How far past flush a lap may run and still count as a lap, in metres.
 *
 * 1 mm, and it exists for a real 0.1 mm. A 900 shelf measures **950.2** wide and
 * two frames 30 wide at 920.1 centres want 950.1 — so the shelf overhangs the
 * far frame's outer face by a tenth of a millimetre. Those are two independent
 * measurements off two supplier STEP files and they agree to 0.1 mm, which is
 * agreement, not a fault. Without this the tightest joint in the range reports
 * as a part passing through a frame.
 *
 * Deliberately far below the 1.5 mm packer, so it cannot swallow a real
 * feature, and three orders of magnitude below the 27 mm by which the desk that
 * went through a ladder overshot it.
 */
export const FLUSH_TOL_M = 0.001;

/**
 * An oriented bounding box for one placed part, in world space.
 *
 * Oriented, not axis-aligned, because a part is yawed to face its joint and the
 * office arm is also tilted 9 degrees. Taking the world AABB of a rotated box
 * inflates it — a 900 mm shelf turned 45 degrees would claim a 1270 mm
 * footprint — and every one of those inflated millimetres would be a collision
 * that is not there.
 */
export function boxFor(component, transform) {
  const min = component?.body?.min;
  const max = component?.body?.max;
  if (!min || !max || !transform) return null;

  // The box's centre in the part's own space, carried into the world. NOT the
  // transform's translation: a part's origin is its base centre, so the centre
  // of its body is half its height above that, and using the origin would put
  // every box half a part low.
  const localCentre = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
  const t = transform.translation || [0, 0, 0];
  const q = transform.rotation || [0, 0, 0, 1];
  const rotated = rotateVec(q, localCentre);

  return {
    centre: [t[0] + rotated[0], t[1] + rotated[1], t[2] + rotated[2]],
    // The world directions of the part's own three axes.
    axes: [
      rotateVec(q, [1, 0, 0]),
      rotateVec(q, [0, 1, 0]),
      rotateVec(q, [0, 0, 1]),
    ],
    half: [
      (max[0] - min[0]) / 2,
      (max[1] - min[1]) / 2,
      (max[2] - min[2]) / 2,
    ],
  };
}

/**
 * How far two oriented boxes interpenetrate, or 0 if they are apart.
 *
 * The separating axis theorem, in Ericson's formulation: two convex boxes are
 * apart if and only if one of fifteen axes separates them — each box's own
 * three, and the nine cross products of one box's axes with the other's. The
 * fifteenth is the one people leave out and it is the one that catches an
 * edge-on crossing, which is exactly the desk-through-a-ladder case.
 *
 * WHAT THE NUMBER MEANS, because it is not what it first looks like. The depth
 * is the smallest overlap across those fifteen axes, which is **the distance
 * one part would have to move to be clear** — not the thickness of the region
 * the two share. Those are different, and the difference is large:
 *
 *   * a 950 mm shelf lapping a 30 mm frame by 15 mm at each end reports
 *     **30.1 mm**, because that is how far it would have to slide to come off;
 *   * a small box wholly inside a large one reports the sum of their
 *     half-extents, not the small box's size — you cannot escape containment
 *     by moving a little.
 *
 * That makes it a good number for "is this real", and a useless one for "is
 * this allowed". The desk that ran through a ladder reports 57.05 mm and the
 * shelf that is supposed to lap its frame reports 30.1 mm; no threshold
 * separates those, which is the finding, not a defect in the measurement.
 */
export function overlapDepth(a, b) {
  return describeOverlap(a, b)?.depth || 0;
}

/**
 * The overlap, and WHICH WAY OUT — which is the field that turns a measurement
 * into a judgement.
 *
 * The survey across every scenario found only two kinds of unjoined overlap in
 * the whole range, and both are correct:
 *
 *   1.5 mm   a PACKER. A shelf rests on a rung and an accessory hooks under
 *            the same rung; the sheets bolt them together through 1.5 mm of
 *            steel, so 1.5 mm of them share space. Reads as its own thickness.
 *   30.0 mm  a LAP. A span part's end is authored flush with the frame's outer
 *            face — that is why a 900 shelf is 950.2 wide across a 920.1 gap —
 *            so it laps the frame by exactly the frame's width. It reads the
 *            same whether the joint to that frame is the one holding it up or
 *            the one at the other end that nothing recorded.
 *
 * The desk that ran through a ladder reads **57.05 mm** on a frame that is
 * **30 mm** wide. That is the distinction, and it is geometric rather than a
 * threshold: a lap is bounded by the thing being lapped, because the part's end
 * stops at its far face. **An overlap deeper than the thinner part's own extent
 * along the escape axis means one part did not stop — it went through.**
 *
 * Measured along the SAME axis at both ends, which the first version of this
 * rule was not: comparing an escape in x against a part's smallest dimension in
 * y is comparing two different things and happens to agree on this range.
 *
 * @returns null when apart, else { depth, axis, spanA, spanB, through }
 */
export function describeOverlap(a, b) {
  if (!a || !b) return null;

  const between = sub(b.centre, a.centre);

  /**
   * How far box `box` reaches along a unit direction — the sum of its three
   * half-extents projected onto it.
   */
  const radius = (box, axis) => box.half[0] * Math.abs(dot(axis, box.axes[0]))
    + box.half[1] * Math.abs(dot(axis, box.axes[1]))
    + box.half[2] * Math.abs(dot(axis, box.axes[2]));

  // The fifteen candidate axes: each box's own three, and the nine cross
  // products. Built as VECTORS rather than as fifteen hand-expanded projection
  // formulae, which is the version this file had first.
  //
  // The expanded form is the textbook one and it is faster, but it hides a
  // trap that this range walks straight into: when two boxes are parallel -
  // which almost everything in a rectilinear bay is - six of the nine cross
  // products are the ZERO VECTOR. In the expanded form those come out as a
  // projection of nothing against a radius of nothing, which reads as an
  // overlap of nothing, and the smallest-overlap depth collapses to zero for
  // two parts that are solidly inside each other. Working in vectors makes the
  // degenerate axis visible and skippable, which is what Ericson says to do.
  const axes = [...a.axes, ...b.axes];
  for (const u of a.axes) {
    for (const v of b.axes) {
      const c = cross(u, v);
      if (length(c) > 1e-6) axes.push(c);
    }
  }

  let least = Infinity;
  let leastAxis = null;
  for (const raw of axes) {
    const axis = normalise(raw);
    if (!length(axis)) continue;
    const overlap = radius(a, axis) + radius(b, axis) - Math.abs(dot(between, axis));
    // One separating axis is enough: the boxes are apart and there is no depth.
    if (overlap <= 0) return null;
    if (overlap < least) { least = overlap; leastAxis = axis; }
  }
  if (least === Infinity || !leastAxis) return null;

  // How thick each part is ALONG THE WAY OUT. `radius` is the half-extent, so
  // twice it is the whole span the part occupies in that direction.
  const spanA = 2 * radius(a, leastAxis);
  const spanB = 2 * radius(b, leastAxis);

  return {
    depth: least,
    axis: leastAxis,
    spanA,
    spanB,
    // Went through, rather than lapped. A part's end stops at the far face of
    // whatever it laps, so a lap can never be deeper than the thinner of the
    // two is thick. Anything deeper did not stop.
    through: least > Math.min(spanA, spanB) + FLUSH_TOL_M,
  };
}

/**
 * Every pair of placed parts that share space, deepest first.
 *
 * Each row says how deep and — the part that matters — WHETHER THE TWO ARE
 * JOINED. A shelf and the frame it plugs into are meant to interpenetrate; a
 * desk and a ladder it merely passes through are not, and nothing else in the
 * data distinguishes them.
 *
 * `joined` is direct connection only. Siblings are not joined and will appear
 * here: the clamping angle and the desktop both hang off the same arm and lap
 * over one another by design. That is a known and deliberate false positive,
 * and the survey is what says how many of those there are.
 *
 * @returns Array<{ a, b, componentA, componentB, depthMm, joined }>
 */
export function overlaps(assembly, components, transforms, { minDepthM = CONTACT_EPS_M } = {}) {
  const instances = (assembly?.instances || []).filter(
    (i) => components?.get(i.componentId) && transforms?.get(i.instanceId),
  );

  const boxes = new Map(instances.map((i) => [
    i.instanceId,
    boxFor(components.get(i.componentId), transforms.get(i.instanceId)),
  ]));

  const joinedPairs = new Set(
    (assembly?.connections || []).map((c) => pairKey(c.fromInstanceId, c.toInstanceId)),
  );

  const out = [];
  for (let i = 0; i < instances.length; i += 1) {
    for (let j = i + 1; j < instances.length; j += 1) {
      const A = instances[i];
      const B = instances[j];
      const shared = describeOverlap(boxes.get(A.instanceId), boxes.get(B.instanceId));
      if (!shared || shared.depth <= minDepthM) continue;
      out.push({
        a: A.instanceId,
        b: B.instanceId,
        componentA: A.componentId,
        componentB: B.componentId,
        depthMm: Math.round(shared.depth * 10000) / 10,
        // How thick the thinner part is along the way out — the number the
        // depth has to be read against.
        thinnerMm: Math.round(Math.min(shared.spanA, shared.spanB) * 10000) / 10,
        through: shared.through,
        joined: joinedPairs.has(pairKey(A.instanceId, B.instanceId)),
      });
    }
  }

  return out.sort((x, y) => y.depthMm - x.depthMm);
}

/** Order-independent key for a pair of instances. */
const pairKey = (a, b) => (a < b ? `${a}::${b}` : `${b}::${a}`);

/**
 * The survey as plain text, for the probe harness.
 *
 * Split three ways, because the groups mean different things and a single list
 * sorted by depth reads as if they did not.
 */
export function formatOverlaps(rows) {
  if (!rows.length) return 'no two parts share space';

  // THREE groups, not two, and the split is the whole value of the report.
  // "Not joined" on its own was the first version and it cried wolf: every
  // scenario has a span part lapping a frame the graph does not record a joint
  // to, and every one of those is correct.
  const through = rows.filter((r) => r.through);
  const lapping = rows.filter((r) => !r.through && !r.joined);
  const joined = rows.filter((r) => !r.through && r.joined);

  const line = (r) => `  ${r.depthMm.toFixed(1)} mm into ${r.thinnerMm.toFixed(1)} mm  `
    + `${r.a} ${r.componentA}\n${' '.repeat(28)}${r.b} ${r.componentB}`;

  const out = [`${rows.length} overlapping pairs`];
  out.push(`${through.length} THROUGH — deeper than the thinner part is thick, `
    + 'so one did not stop at the other:');
  out.push(through.length ? through.map(line).join('\n') : '  (none)');
  out.push(`${lapping.length} lapping, not joined — a span part over a frame it is not `
    + 'wired to, or a packer:');
  out.push(lapping.length ? lapping.map(line).join('\n') : '  (none)');
  out.push(`${joined.length} at a joint — expected, two parts bolted through each other:`);
  out.push(joined.length ? joined.map(line).join('\n') : '  (none)');
  return out.join('\n');
}
