// The configurator, as opposed to the viewer.
//
// `Viewer` draws a configuration id. This owns the CHOICES, turns them into an
// id, and hands that id to `Viewer` - so what is on screen is always exactly
// what an id encodes, and the id in the URL is always exactly what is on
// screen. That round trip is not a formality: it is the thing that makes a
// quote reconcilable with a drawing, and doing it on every change means a
// divergence between the two would show up immediately rather than at the point
// somebody sends a link.
//
// It also means this file adds no drawing code at all. The runtime's scene, the
// bill of materials, the AR handoff and the framing all stay where they are; the
// only new thing is a panel and a piece of state.
//
// THE URL IS THE STATE, up to a point. A configuration id is 400-odd characters,
// which is a link rather than a text message, so `?c=` is written on change and
// read on load. Someone who configures a product and sends the URL sends the
// product. The short-code service that would make that pretty is Phase 2 item 7
// and is not this.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import Viewer from './Viewer.jsx';
import Options from './Options.jsx';
import MovePanel from './MovePanel.jsx';
import './options.css';
import {
  buildGuided, defaultChoices, normaliseChoices, variantOf, sizeOf, moveOptions,
  moveCandidates, movePoints, addPoints,
  slotKeyFor, builderIdOf, addAvailability, GuidedError,
} from '../engine/guided.js';
import { pointKey } from '../engine/attach.js';
import { MOUNTING } from '../engine/ar.js';

/**
 * Deleting the nth of something, in slot terms.
 *
 * Removing the second of three shelves is not just "count minus one": the third
 * shelf becomes the second, so any position recorded against #2 now belongs to
 * what used to be #1's neighbour. Every override above the hole shifts down.
 *
 * Without this, removing a shelf silently moved the ones above it to positions
 * chosen for different parts - the sort of thing that looks like the engine
 * misbehaving rather than like bookkeeping.
 */
export function removeSlot(choices, componentId, index) {
  const count = choices.adds?.[componentId] || 0;
  if (index < 0 || index >= count) return choices;

  const at = {};
  for (const [key, ref] of Object.entries(choices.at || {})) {
    const hash = key.lastIndexOf('#');
    const owner = key.slice(0, hash);
    const i = Number(key.slice(hash + 1));
    if (owner !== componentId) { at[key] = ref; continue; }
    if (i === index) continue;
    at[slotKeyFor(componentId, i > index ? i - 1 : i)] = ref;
  }

  const adds = { ...choices.adds };
  if (count - 1 > 0) adds[componentId] = count - 1;
  else delete adds[componentId];

  return { ...choices, adds, at };
}

const MOUNTING_LABELS = [
  { id: MOUNTING.FLOOR, label: 'The floor' },
  { id: MOUNTING.FEET, label: 'Feet' },
  { id: MOUNTING.WALL, label: 'The wall' },
];

/**
 * The choices in the URL, alongside the configuration id.
 *
 * BOTH are needed and they are not interchangeable, which took a moment to see.
 * `?c=` is the product - what the quote prices, what an AR file would be of,
 * what a person means when they send a link. `?o=` is the CHOICES, and a
 * configuration id cannot be turned back into them: an id records the parts and
 * the joints, not "two bays with one clothes rail". Resolving one tells you what
 * to draw and nothing about where the steppers should sit.
 *
 * So without `?o=`, reloading a configured product silently reset every control
 * while the URL still named the product - the page and its own address
 * disagreeing, which is exactly the class of thing a shared link exists to
 * avoid.
 *
 * base64url of the small JSON, not a second versioned format: these are five
 * short fields, they are read by the same build that wrote them, and anything
 * unrecognised is normalised away by `normaliseChoices` on the way in.
 */
const encodeChoices = (choices) => {
  try {
    return btoa(JSON.stringify(choices))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch {
    return null;
  }
};

const decodeChoices = (text) => {
  if (!text) return null;
  try {
    return JSON.parse(atob(text.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    // A truncated or hand-edited parameter opens the default product rather
    // than an error page. The URL is a convenience, not a contract.
    return null;
  }
};

export { encodeChoices, decodeChoices };

export default function Guided({
  schema,
  components,
  catalogue = null,
  tierId = null,
  title = null,
  ar = null,
  /**
   * The configuration the bundle's AR files were baked for.
   *
   * A pre-baked GLB is of ONE product. The moment a customer adds a shelf, the
   * file in `ar/` is a picture of something else - so the handoff has to be
   * withdrawn rather than left pointing at the wrong thing. Showing a customer
   * their own product in the room, except with a shelf missing, is worse than
   * showing them nothing.
   */
  arConfigurationId = null,
  initialChoices = null,
  onReady = null,
}) {
  const [choices, setChoices] = useState(() => {
    const fromUrl = typeof window === 'undefined'
      ? null
      : decodeChoices(new URL(window.location.href).searchParams.get('o'));
    return normaliseChoices(schema, initialChoices || fromUrl || defaultChoices(schema));
  });
  const [panelOpen, setPanelOpen] = useState(false);
  // The BUILDER's id of the tapped part, already translated. Storing the
  // translated one means everything downstream deals in one id space.
  const [picked, setPicked] = useState(null);
  // The accessory waiting for a position: pressing + says "another one of
  // these", and the next tap on a dot says where. Null the rest of the time.
  const [placing, setPlacing] = useState(null);
  // The assembly the runtime drew, captured from onReady. Needed because the
  // drawn product's instance ids come from decoding the configuration id and
  // are not the builder's - see builderIdOf.
  const drawnRef = useRef(null);

  const built = useMemo(() => {
    try {
      return { ...buildGuided(schema, choices, components), error: null };
    } catch (err) {
      // A schema naming parts that are not here is the one failure this cannot
      // work around, and it is named rather than swallowed: the alternative is
      // a product with pieces missing and nothing said.
      return {
        error: err instanceof GuidedError ? err.message : `Could not build this: ${err.message}`,
      };
    }
  }, [schema, choices, components]);

  const variant = useMemo(() => {
    try { return variantOf(schema, choices); } catch { return null; }
  }, [schema, choices]);
  const size = useMemo(
    () => (variant ? sizeOf(variant, choices) : null),
    [variant, choices],
  );

  // Which accessories this frame can take at all, so a row that can never be
  // used says so instead of refusing when it is pressed. Recomputed with the
  // product because "no room left" changes as bays are added, while "not
  // available on 200 mm deep frames" does not - `addAvailability` tells them
  // apart and this does not need to.
  const availability = useMemo(() => {
    if (!built.assembly || !components?.size) return {};
    try { return addAvailability(built, components); } catch { return {}; }
  }, [built, components]);

  // Which mountings this product can actually take. A schema may say, and if it
  // does not, all three are offered - the engine has handled all three since
  // §5.12 and the view changes for each.
  const mountings = useMemo(() => {
    const allowed = variant?.mountings;
    return allowed
      ? MOUNTING_LABELS.filter((m) => allowed.includes(m.id))
      : MOUNTING_LABELS;
  }, [variant]);

  // The id goes into the URL so the product can be sent. `replaceState` rather
  // than `pushState`: every tap on a stepper would otherwise be a history entry
  // and the back button would walk a customer backwards through their own
  // fiddling instead of out of the page.
  useEffect(() => {
    if (!built.configurationId || typeof window === 'undefined') return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('c', built.configurationId);
      const o = encodeChoices(built.choices);
      if (o) url.searchParams.set('o', o);
      window.history.replaceState(null, '', url);
    } catch {
      // A page served from somewhere that will not take a URL rewrite still
      // configures perfectly well; it just cannot be shared by copying the bar.
    }
  }, [built.configurationId]);

  const change = useCallback((next) => {
    setChoices(normaliseChoices(schema, next));
  }, [schema]);

  // What the tapped part can do. Computed here rather than held in state so it
  // is always about the CURRENT product: a stale list of positions is a list of
  // moves that will fail.
  const move = useMemo(() => {
    if (!picked || built.error) return null;
    const r = moveOptions(built, components, picked);
    const componentId = built.assembly.instances
      .find((i) => i.instanceId === picked)?.componentId;
    // WHAT TO CALL IT, and the span is the awkward case: a bay's shelf and an
    // "extra shelf" are the same article number, so looking the label up by
    // component alone titled the frame's own shelf "Extra metal shelf" while
    // telling the person it was part of the frame. Whether the part is
    // structural is the thing that decides, and the engine already said.
    const add = (size?.adds || []).find((a) => a.componentId === componentId);
    const label = r.structural
      ? (componentId === built.choices.frameId ? 'Frame' : (size?.span?.label || 'Shelf'))
      : (add?.label || componentId);
    return { ...r, componentId, label };
  }, [picked, built, components, size]);

  // A part the person moved is remembered against its SLOT, so the whole
  // product stays a function of the choices and the move survives every later
  // change to a count.
  const applyMove = useCallback((option) => {
    if (!move?.slot) return;
    change({ ...built.choices, at: { ...built.choices.at, [move.slot]: option.at } });
    setPicked(null);
  }, [move, built, change]);

  const applyDelete = useCallback(() => {
    if (!move?.slot) return;
    const hash = move.slot.lastIndexOf('#');
    change(removeSlot(
      built.choices,
      move.slot.slice(0, hash),
      Number(move.slot.slice(hash + 1)),
    ));
    setPicked(null);
  }, [move, built, change]);

// -------------------------------------------------------- dots and dragging
  //
  // Matt, after configuring a three-bay unit with steppers alone and finding
  // every accessory stacked on the bottom rail: "it needs to be the drag and
  // drop we had at the start with the snap dots, click a dot add an accessory
  // to the dot and then you can click and drag to change its location."
  //
  // TWO QUESTIONS, TWO SETS OF DOTS, and never both at once:
  //
  //   placing  - "another shelf, where?"        green dots, tap one to place
  //   picked   - "this rail, somewhere else"    amber dots, drag or tap
  //
  // With neither, there are no dots at all and a tap only selects. That is
  // deliberate: a customer's first instinct on a 3D product is to swipe it
  // round, and dots over a product nobody has asked to change are noise.
  //
  // EVERYTHING HERE IS IN THE BUILDER'S ID SPACE. The scene is drawn by
  // resolving a configuration id, which names its instances p0, p1, p2, while
  // buildGuided names them g1, g2, g3 - so every id arriving from the viewer is
  // translated once, at the boundary, and nothing downstream has to know there
  // was ever a second space. That mapping is `builderIdOf`, and the first
  // version of the move panel forgot it and asked the builder about "p3".
  const dots = useMemo(() => {
    if (built.error) return null;
    if (placing) {
      return { mode: 'add', points: addPoints(built, components, placing) };
    }
    if (picked) {
      return { mode: 'move', points: movePoints(built, components, picked) };
    }
    return null;
  }, [built, components, placing, picked]);

  // key -> the engine's own point, so a tap on a dot becomes an {instanceId,
  // snapId} record without asking a second question and getting a different
  // answer.
  const dotAt = useMemo(() => {
    const m = new Map();
    for (const p of dots?.points || []) m.set(pointKey(p), p);
    return m;
  }, [dots]);

  // Candidates for the part being moved, kept so the drag preview costs
  // nothing: each one already carries the pose the part would take, because it
  // was only accepted by making the move and looking at the result.
  const candidates = useMemo(() => {
    if (!picked || built.error) return new Map();
    const m = new Map();
    for (const c of moveCandidates(built, components, picked).candidates || []) {
      m.set(pointKey(c.point), c);
    }
    return m;
  }, [picked, built, components]);

  /** Put the accessory waiting for a position at this point. */
  const placeAt = useCallback((point) => {
    const componentId = placing;
    if (!componentId || !point) return;
    const index = built.choices.adds?.[componentId] || 0;
    setPlacing(null);
    change({
      ...built.choices,
      adds: { ...built.choices.adds, [componentId]: index + 1 },
      // The nth copy of this component is the slot, and the schema's order is
      // the order buildGuided places them - so the one about to be added is
      // index `n`, counting from zero.
      at: {
        ...built.choices.at,
        [slotKeyFor(componentId, index)]: { instanceId: point.instanceId, snapId: point.snapId },
      },
    });
  }, [placing, built, change]);

  /** Re-hang the selected part at this point. */
  const moveTo = useCallback((point) => {
    const slot = built.slots?.[picked];
    if (!slot || !point) return;
    change({
      ...built.choices,
      at: {
        ...built.choices.at,
        [slot]: { instanceId: point.instanceId, snapId: point.snapId },
      },
    });
  }, [picked, built, change]);

  const interaction = useMemo(() => {
    if (!dots) return null;
    return {
      points: dots.points,
      mode: dots.mode,
      targeted: dots.mode === 'add',
      keyOf: pointKey,

      onPoint: (key) => {
        const point = dotAt.get(key);
        if (!point) return;
        if (dots.mode === 'add') placeAt(point);
        else moveTo(point);
      },

      // A DRAG NEEDS THE PART TAPPED FIRST. On a phone the product fills the
      // screen, so nearly every orbit starts on a part; without this, swiping
      // to look round would pick a shelf up. One tap makes the intent explicit
      // and the refusal is silent - OrbitControls was never disabled, so the
      // camera just carries on turning.
      canDrag: (drawnId) => {
        if (dots.mode !== 'move') return { ok: false, reason: 'not-moving' };
        const id = builderIdOf(built, drawnRef.current, drawnId);
        if (!id || id !== picked) return { ok: false, reason: 'not-selected' };
        return { ok: true };
      },

      onMoved: (drawnId, key) => {
        const id = builderIdOf(built, drawnRef.current, drawnId);
        if (!id || id !== picked) return;
        const point = dotAt.get(key);
        if (point) moveTo(point);
      },

      ghostFor: (drawnId, key) => {
        const c = candidates.get(key);
        if (!c) return null;
        const instance = built.assembly.instances.find((i) => i.instanceId === picked);
        const component = instance && components.get(instance.componentId);
        return component ? { component, pose: c.pose } : null;
      },
    };
  }, [dots, dotAt, candidates, built, components, picked, placeAt, moveTo]);

  /** Stop asking where. Tapping the background is how a person changes their mind. */
  const clearPointer = useCallback(() => {
    setPlacing(null);
    setPicked(null);
  }, []);

  // A position that could not be honoured is FORGOTTEN rather than kept, or it
  // would come back the next time the product happened to have that point
  // again - a part moving on its own, some changes later, for no reason the
  // person could see.
  useEffect(() => {
    if (!built.dropped?.length) return;
    const at = { ...built.choices.at };
    for (const d of built.dropped) delete at[d.slot];
    change({ ...built.choices, at });
  }, [built.dropped, built.choices, change]);

  if (built.error) {
    return (
      <div className="cfgv">
        <div className="cfgv-error" role="alert">
          <strong>This product cannot be configured.</strong>
          <span>{built.error}</span>
        </div>
      </div>
    );
  }

  // AR only while the product on screen IS the product in the ar/ folder.
  const arMatches = !!arConfigurationId && arConfigurationId === built.configurationId;

  return (
    <div className={`cfgg${panelOpen ? ' cfgg-open' : ''}`}>
      <Viewer
        configurationId={built.configurationId}
        components={components}
        catalogue={catalogue}
        tierId={tierId}
        title={title}
        ar={arMatches ? ar : null}
        arWithheld={ar && !arMatches
          ? 'View in your room is ready for the starting product. Reset the '
            + 'options to see it in AR, or ask us for a link to this one.'
          : null}
        // Selection is back in the runtime, but only in the CONFIGURATOR. A
        // plain viewer of one configuration still has nothing to click.
        selectable
        selectedId={picked}
        interaction={interaction}
        onPick={(drawnId) => {
          const id = drawnId
            ? builderIdOf(built, drawnRef.current, drawnId)
            : null;
          // Tapping the background is how somebody changes their mind about
          // adding a part, as well as how they put one down.
          if (!id) { clearPointer(); return; }
          setPlacing(null);
          setPicked(id);
          // Opening the option sheet over a part somebody just tapped hides
          // the thing they are pointing at.
          setPanelOpen(false);
        }}
        onReady={(info) => {
          drawnRef.current = info?.resolved?.scene?.assembly || null;
          onReady?.(info);
        }}
      />

      {/* Only ever OPENS. Closing is the Done button inside the sheet, next to
          the thumb that has been tapping steppers - a control that opens a
          panel and then hides behind it is a control you have to remember. */}
      <button
        type="button"
        className="cfgg-toggle"
        aria-expanded={panelOpen}
        hidden={panelOpen || !!picked || !!placing}
        onClick={() => setPanelOpen(true)}
      >
        Configure
      </button>

      {/* Asking WHERE, with a way out.
          The sheet is closed at this point - it has to be, the dots are behind
          it - so this strip is the only thing telling somebody what the dots
          in front of them are for. It also answers the question a customer
          asks second: what if none of them is where I wanted it. */}
      {placing && (
        <div className="cfgg-ask" role="status">
          <span className="cfgg-askwhat">
            {(size?.adds || []).find((a) => a.componentId === placing)?.label || placing}
          </span>
          <span className="cfgg-askhow">
            {dots?.points?.length
              ? `Tap one of the ${dots.points.length} dots to put it there`
              : 'There is nowhere on this product for one of these'}
          </span>
          <button type="button" className="cfgg-askstop" onClick={() => setPlacing(null)}>
            Cancel
          </button>
        </div>
      )}

      {move && (
        <MovePanel
          label={move.label}
          options={move.options || []}
          reason={move.reason}
          structural={!!move.structural}
          canDelete={!!move.slot}
          onMove={applyMove}
          onDelete={applyDelete}
          onClose={() => setPicked(null)}
        />
      )}

      <div className="cfgg-panel" hidden={!panelOpen}>
        {/* A title and, when it matters, the shortfall. NOT the part count:
            on a phone the bill-of-materials strip sits directly above this
            sheet and already reads "5 parts · 3 included · 1870 × 1600 × 320
            mm", so a count here was the same number twice, 50 pixels apart. */}
        <div className="cfgg-head">
          <span className="cfgg-count">
            {built.refused.length > 0 ? (
              <span className="cfgg-short">
                {built.refused.length} option
                {built.refused.length === 1 ? '' : 's'} would not fit
              </span>
            ) : 'Configure'}
          </span>
          <button
            type="button"
            className="cfgg-done"
            onClick={() => setPanelOpen(false)}
          >
            Done
          </button>
        </div>

        <Options
          schema={schema}
          choices={built.choices}
          variant={variant}
          size={size}
          refused={built.refused}
          availability={availability}
          mountings={mountings}
          placing={placing}
          onPlace={(componentId) => {
            setPicked(null);
            setPlacing(componentId);
            // The dots are in the scene, so the sheet has to get out of the
            // way. Asking "where?" and then covering half the product with the
            // question is the mobile bug from §5.24 in a new costume.
            setPanelOpen(false);
          }}
          onChange={change}
        />
      </div>
    </div>
  );
}
