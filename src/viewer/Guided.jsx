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
import SpacingPanel from './SpacingPanel.jsx';
import './options.css';
import './configurator.css';
import { recordingRequested, describeChange, drawnFacts, recordingFile } from './recorder.js';
import {
  buildGuided, defaultChoices, normaliseChoices, variantOf, sizeOf, moveOptions, addForComponent, pinPositions,
  moveCandidates, movePoints, addPoints, baySpacings,
  slotKeyFor, frameIndexOf, spanBayOf, builderIdOf, addAvailability, GuidedError,
} from '../engine/guided.js';
import { pointKey } from '../engine/attach.js';
import { MOUNTING } from '../engine/ar.js';
import { arHandoff } from './ar-link.js';

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

  // A record may also NAME a slot of this kind as what it hangs from (A2 §4) -
  // a ladder hung off the third shelf. Those names shift with the keys; one that
  // named the removed slot is kept as written and the rebuild reports it dropped.
  const shifted = (slot) => {
    if (typeof slot !== 'string') return slot;
    const h = slot.lastIndexOf('#');
    const i = Number(slot.slice(h + 1));
    return slot.slice(0, h) === componentId && i > index ? slotKeyFor(componentId, i - 1) : slot;
  };
  const at = {};
  for (const [key, raw] of Object.entries(choices.at || {})) {
    const ref = raw?.slot ? { ...raw, slot: shifted(raw.slot) } : raw;
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
  rules = undefined,
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
  /** A theme name from tokens.css ("youk"), or the neutral one. Per instance (B1). */
  theme = undefined,
}) {
  const [choices, setChoices] = useState(() => {
    const fromUrl = typeof window === 'undefined'
      ? null
      : decodeChoices(new URL(window.location.href).searchParams.get('o'));
    return normaliseChoices(schema, initialChoices || fromUrl || defaultChoices(schema));
  });
  // WHICH STEP of the guided flow is showing (direction C, chosen by Matt on
  // 12 Nov 2026): size, bays, shelves & storage, accessories, mounting, review.
  const [step, setStep] = useState(0);
  // UNDO / REDO, per instance. Choices are the whole state of the product, so
  // history is a stack of choices - the same values ?o= carries.
  const pastRef = useRef([]);
  const futureRef = useRef([]);
  const [historySize, setHistorySize] = useState({ past: 0, future: 0 });
  const syncHistory = () => setHistorySize({ past: pastRef.current.length, future: futureRef.current.length });
  // What the drawn product is - the resolved configuration and its size, handed
  // out by the viewer once it has drawn. The summary card and the review read it.
  const [drawn, setDrawn] = useState(null);

  // THE RECORDER (Matt, 13 Nov 2026: record what I do so a broken build can be
  // reproduced). Opt-in with ?record, per instance, in memory only.
  const [recordOn] = useState(() => typeof window !== 'undefined' && recordingRequested(window.location.href));
  const logRef = useRef([]);
  const startedRef = useRef(null);
  const prevForLogRef = useRef(null);
  const actionRef = useRef('opened');
  const [logSize, setLogSize] = useState(0);
  // The BUILDER's id of the tapped part, already translated. Storing the
  // translated one means everything downstream deals in one id space.
  const [picked, setPicked] = useState(null);
  // The accessory waiting for a position: pressing + says "another one of
  // these", and the next tap on a dot says where. Null the rest of the time.
  const [placing, setPlacing] = useState(null);
  // The bay whose spacing chooser is open, from tapping the line between two
  // ladders. A POSITION in the run, not a part, which is why it is a number:
  // bay 0 is a real bay and `null` has to mean "no chooser".
  const [spacingBay, setSpacingBay] = useState(null);
  // The assembly the runtime drew, captured from onReady. Needed because the
  // drawn product's instance ids come from decoding the configuration id and
  // are not the builder's - see builderIdOf.
  const drawnRef = useRef(null);

  const built = useMemo(() => {
    try {
      return { ...buildGuided(schema, choices, components, rules ? { rules } : {}), error: null };
    } catch (err) {
      // A schema naming parts that are not here is the one failure this cannot
      // work around, and it is named rather than swallowed: the alternative is
      // a product with pieces missing and nothing said.
      return {
        error: err instanceof GuidedError ? err.message : `Could not build this: ${err.message}`,
      };
    }
  }, [schema, choices, components, rules]);

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

  // Computed once and used twice: the address bar writes it in an effect, and
  // the QR code needs it DURING the render. Reading it back out of the URL for
  // the code would hand a phone the product as it was one change ago.
  const encoded = useMemo(
    () => (built.choices ? encodeChoices(built.choices) : null),
    [built.choices],
  );

  // The id goes into the URL so the product can be sent. `replaceState` rather
  // than `pushState`: every tap on a stepper would otherwise be a history entry
  // and the back button would walk a customer backwards through their own
  // fiddling instead of out of the page.
  useEffect(() => {
    if (!built.configurationId || typeof window === 'undefined') return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('c', built.configurationId);
      if (encoded) url.searchParams.set('o', encoded);
      window.history.replaceState(null, '', url);
    } catch {
      // A page served from somewhere that will not take a URL rewrite still
      // configures perfectly well; it just cannot be shared by copying the bar.
    }
  }, [built.configurationId, encoded]);

  const change = useCallback((next, { record = true } = {}) => {
    actionRef.current = record ? 'changed' : 'corrected by the engine';
    setChoices((prev) => {
      // A customer's change goes on the undo stack; a correction the system makes
      // on its own (forgetting a record the engine dropped) does not, or undo
      // would undo the engine rather than the person.
      if (record) {
        pastRef.current = [...pastRef.current.slice(-49), prev];
        futureRef.current = [];
      }
      // THE HEIGHT CONTROL MEANS ALL OF THEM. Per-ladder types are overrides on
      // top of that global choice, so changing the global one has to clear
      // them - otherwise "make them all 905 mm" leaves the 2210 somebody put in
      // position 2 standing there contradicting the control that just said
      // otherwise.
      let cleared = next.frameId && prev.frameId && next.frameId !== prev.frameId
        ? { ...next, frames: {} }
        : next;
      // THE WIDTH CONTROL MEANS ALL OF THEM TOO, and for the same reason: a
      // per-bay width is an override on top of the run's, so moving the run's
      // has to clear them. Otherwise "make them all 600" leaves the 1200 bay
      // somebody set from its own line standing there contradicting the control
      // that just said otherwise.
      //
      // Deliberately NOT applied when the sizeId is unchanged, so setting one
      // bay from its line - which sends the same sizeId back with a new
      // `widths` - does not wipe the entry it just made.
      if (cleared.sizeId && prev.sizeId && cleared.sizeId !== prev.sizeId) {
        cleared = { ...cleared, widths: {} };
      }
      return normaliseChoices(schema, cleared);
    });
    if (record) setHistorySize({ past: Math.min(50, pastRef.current.length + 1), future: 0 });
  }, [schema]);

  const undo = useCallback(() => {
    actionRef.current = 'undo';
    setChoices((prev) => {
      const back = pastRef.current.at(-1);
      if (!back) return prev;
      pastRef.current = pastRef.current.slice(0, -1);
      futureRef.current = [...futureRef.current, prev];
      return back;
    });
    setTimeout(syncHistory, 0);
  }, []);
  const redo = useCallback(() => {
    actionRef.current = 'redo';
    setChoices((prev) => {
      const fwd = futureRef.current.at(-1);
      if (!fwd) return prev;
      futureRef.current = futureRef.current.slice(0, -1);
      pastRef.current = [...pastRef.current, prev];
      return fwd;
    });
    setTimeout(syncHistory, 0);
  }, []);

  // Every change to the choices is a step - read off the choices themselves,
  // so no control can change the product without it being recorded.
  useEffect(() => {
    if (!recordOn) return;
    if (!startedRef.current) startedRef.current = Date.now();
    logRef.current = [...logRef.current, {
      step: logRef.current.length,
      ms: Date.now() - startedRef.current,
      action: actionRef.current,
      changes: describeChange(prevForLogRef.current, choices),
      o: encodeChoices(choices),
    }];
    prevForLogRef.current = choices;
    actionRef.current = 'changed';
    setLogSize(logRef.current.length);
  }, [choices, recordOn]);

  // ...and what the viewer then drew for it: size, issues, the lowest part.
  useEffect(() => {
    if (!recordOn || !drawn) return;
    const last = logRef.current.at(-1);
    if (last && !last.drawn) last.drawn = drawnFacts(drawn);
  }, [drawn, recordOn]);

  const recordingText = () => JSON.stringify(recordingFile(logRef.current, {
    page: typeof window !== 'undefined' ? window.location.href : null,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    startedAt: startedRef.current ? new Date(startedRef.current).toISOString() : null,
  }), null, 1);
  const [copiedLog, setCopiedLog] = useState(false);
  const copyRecording = async () => {
    try {
      await navigator.clipboard.writeText(recordingText());
      setCopiedLog(true);
      setTimeout(() => setCopiedLog(false), 2000);
    } catch { /* fall back to Download */ }
  };
  const downloadRecording = () => {
    const blob = new Blob([recordingText()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `confgr-recording-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const clearRecording = () => {
    logRef.current = [];
    prevForLogRef.current = null;
    startedRef.current = null;
    actionRef.current = 'cleared, then';
    // Start again from the product as it stands.
    logRef.current = [{ step: 0, ms: 0, action: 'cleared - recording from here', changes: ['started'], o: encodeChoices(choices) }];
    prevForLogRef.current = choices;
    startedRef.current = Date.now();
    setLogSize(1);
  };

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
    const add = addForComponent(variant, componentId);

    // A LADDER NAMES ITS POSITION, not just itself. With mixed heights in one
    // run, "Ladder" on its own leaves somebody guessing which of the four they
    // tapped, and the panel is about to offer to change it.
    if (r.kind === 'frame') {
      const index = frameIndexOf(built.slots?.[picked]);
      const here = (variant?.frames || []).find((f) => f.componentId === componentId);
      return {
        ...r,
        componentId,
        label: index === 0 ? 'First ladder' : `Ladder ${index + 1}`,
        types: (variant?.frames || []).map((f) => ({
          componentId: f.componentId,
          label: f.label,
          current: f.componentId === componentId,
        })),
        typeLabel: here?.label || null,
        frameIndex: index,
      };
    }

    // THE BAY'S OWN SPAN, not the run's. Tapping the shelf in a 600 bay of a
    // mostly-900 run called it by the 900 shelf's name, which is the same class
    // of mistake as the width control changing every bay: one size standing in
    // for a product that no longer has one.
    const bay = spanBayOf(built.slots?.[picked]);
    const spanSize = bay != null ? built.sizes?.[bay] : (built.sizes || [])
      .find((s) => s.span?.componentId === componentId) || size;
    // WHICH BAY'S SHELF, because in a three-bay run "Metal shelf 900 mm" is
    // three different parts and the panel is about to offer to move one of
    // them. Counted from one, the same as the ladders the spacing panel names.
    const label = r.kind === 'span'
      ? `Bay ${(bay ?? 0) + 1} shelf`
      : (add?.label || componentId);
    return { ...r, componentId, label, typeLabel: spanSize?.span?.label || null, types: [] };
  }, [picked, built, components, size, variant]);

  // WHICH LADDER STANDS HERE. Recorded against the POSITION rather than against
  // the component, so changing the type does not move the recorded height to a
  // different slot and make the ladder jump.
  const applyType = useCallback((type) => {
    if (move?.frameIndex == null) return;
    change({
      ...built.choices,
      frames: { ...built.choices.frames, [move.frameIndex]: type.componentId },
    });
  }, [move, built, change]);

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
    // Pin everything else where it is first (A1 F10): otherwise the rebuild
    // re-places parts nobody moved, and removing one shelf moved another.
    change(removeSlot(
      pinPositions(built),
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
      const points = movePoints(built, components, picked);
      // One dot is where the part already is. Drawing it says "you may move
      // this here", which is not true of the place it is - and for a ladder on
      // a floor-standing run that is the only position there is.
      return points.length > 1 ? { mode: 'move', points } : null;
    }
    return null;
  }, [built, components, placing, picked]);

// -------------------------------------------------------------- the spacing
  //
  // Matt: "can we have a marker similar to the hot spot dots that is a line
  // connecting two neighbouring ladders that you can click to choose the
  // spacing between those ladders".
  //
  // HIDDEN WHILE THE DOTS ARE UP, which is the whole of how the two controls
  // stay out of each other's way. A person placing a shelf is answering "where"
  // and every mark on the product should be an answer to that; a line running
  // across the bay would be one more thing to hit by mistake. It also means no
  // drag can ever end on one, which is the failure the `onDrop` guard in Viewer
  // exists to catch if this is ever relaxed.
  const spacings = useMemo(() => {
    if (built.error || placing || picked) return [];
    try { return baySpacings(built, components); } catch { return []; }
  }, [built, components, placing, picked]);

  // The chooser can outlive the bay it was opened on - reduce the bay count
  // with a chooser open and it would be asking about a gap that is no longer
  // there - so the OPEN bay is derived from what exists rather than trusted.
  const spacingFor = useMemo(
    () => spacings.find((s) => s.bay === spacingBay) || null,
    [spacings, spacingBay],
  );

  /** Set one bay's width, leaving every other bay as it is. */
  const applySpacing = useCallback((option) => {
    if (spacingBay == null) return;
    setSpacingBay(null);
    change({
      ...built.choices,
      widths: { ...built.choices.widths, [spacingBay]: option.id },
    });
  }, [spacingBay, built, change]);

  const spacing = useMemo(() => ({
    spacings,
    activeBay: spacingFor ? spacingFor.bay : null,
    onBay: (bay) => {
      // Tapping the line that is already open closes it, the same as tapping
      // the width it already has.
      setPicked(null);
      setSpacingBay((prev) => (prev === bay ? null : bay));
    },
  }), [spacings, spacingFor]);

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
    // A KIND, not a part number. Which LENGTH it becomes is decided by the bay
    // the point belongs to, and the engine works that out by trying the
    // candidates against the joint - so this records only the intent, which is
    // the same discipline every other slot follows.
    const kind = placing;
    if (!kind || !point) return;
    const index = built.choices.adds?.[kind] || 0;
    setPlacing(null);
    change({
      ...built.choices,
      adds: { ...built.choices.adds, [kind]: index + 1 },
      // The nth copy of this kind is the slot, and the schema's order is the
      // order buildGuided places them - so the one about to be added is index
      // `n`, counting from zero.
      at: {
        ...built.choices.at,
        // The SLOT the dot belongs to as well as the instance (A2 §4), so the
        // record survives a rebuild that numbers instances differently.
        [slotKeyFor(kind, index)]: { instanceId: point.instanceId, slot: built.slots?.[point.instanceId] || null, snapId: point.snapId },
      },
    });
  }, [placing, built, change]);

  /** Re-hang the selected part at this point. */
  const moveTo = useCallback((point) => {
    const slot = built.slots?.[picked];
    if (!slot || !point) return;
    // RECORD WHAT THE GHOST SHOWED (A1 I2). A point is not always a position: a
    // ladder offered at a shelf's free end can mate by any of its rungs, and the
    // ghost drew ONE of them. Recording only {instanceId, snapId} let the rebuild
    // choose a different rung, so the part landed somewhere other than where it
    // was previewed. The candidate carries the rung (mountSnapId) - record it.
    const shown = candidates.get(pointKey(point));
    change({
      ...built.choices,
      at: {
        ...built.choices.at,
        [slot]: shown?.at || { instanceId: point.instanceId, snapId: point.snapId },
      },
    });
  }, [picked, built, change, candidates]);

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
    setSpacingBay(null);
  }, []);

  // A position that could not be honoured is FORGOTTEN rather than kept, or it
  // would come back the next time the product happened to have that point
  // again - a part moving on its own, some changes later, for no reason the
  // person could see.
  useEffect(() => {
    if (!built.dropped?.length) return;
    const at = { ...built.choices.at };
    for (const d of built.dropped) delete at[d.slot];
    change({ ...built.choices, at }, { record: false });
  }, [built.dropped, built.choices, change]);

  if (built.error) {
    return (
      <div className="cfgv cfg-theme" data-cfg-theme={theme}>
        <div className="cfgv-error" role="alert">
          <strong>This product cannot be configured.</strong>
          <span>{built.error}</span>
        </div>
      </div>
    );
  }

  // Whether AR follows the options or only the opening product is a property
  // of the BUNDLE, and `arHandoff` is where that is decided and tested. On a
  // routed bundle nothing is withheld; on a static one the shipped pair is
  // right for exactly one product and saying so beats showing the wrong room.
  const handoff = arHandoff({
    ar, arConfigurationId, configurationId: built.configurationId,
  });

  // ------------------------------------------------------------ direction C
  //
  // Matt chose it at checkpoint 3 (12 Nov 2026): one decision at a time on a
  // dark rail, a step bar across the top, the light build space as the hero,
  // and a review step before anything is sent. Everything the runtime could do
  // before is still here - dots, drag, the spacing lines, moving and removing a
  // part, AR on the stage - it is the arrangement that changed.
  const lastStep = STEPS.length - 1;
  const goTo = (i) => { clearPointer(); setStep(Math.max(0, Math.min(lastStep, i))); };
  // While the person is answering "where does it go" - dots, a moved part, a
  // bay's spacing - the rail gets out of the way on a phone. On a wide screen the
  // CSS keeps it (see `.cfgc-rail` in configurator.css).
  const busy = !!placing || !!picked || spacingFor !== null;
  const quote = drawn?.resolved?.quote || null;
  const judgement = drawn?.resolved?.judgement || null;
  const issues = judgement && !judgement.ok ? [...new Set(judgement.reasons.map((r) => r.says))] : [];

  const onKeyDown = (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    else if (e.key === 'Escape') clearPointer();
  };

  return (
    <div className="cfgc cfg-theme" data-cfg-theme={theme} onKeyDown={onKeyDown}>
      <header className="cfgc-steps">
        {/* The product's own name from the schema beats the bundle's generic title. */}
        <h1 className="cfgc-title">{schema.title || title || 'Configure'}</h1>
        <ol className="cfgc-steplist" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                className={`cfgc-stepbtn${i < step ? ' is-done' : ''}`}
                aria-current={i === step ? 'step' : undefined}
                onClick={() => goTo(i)}
              >
                <span className="cfgc-stepnum" aria-hidden="true">{i < step ? '✓' : i + 1}</span>
                {s.label}
              </button>
            </li>
          ))}
        </ol>
      </header>

      <aside className="cfgg-panel cfgc-rail" hidden={busy} aria-label={STEPS[step].label}>
        <div className="cfgc-railbody">
          <h2 className="cfgc-railhead">
            <span className="cfgc-stepn">{String(step + 1).padStart(2, '0')}</span>
            {STEPS[step].label}
          </h2>
          {built.refused.length > 0 && step < lastStep && (
            <p className="cfgc-short" role="status">
              {built.refused.length} option{built.refused.length === 1 ? '' : 's'} would not fit — see the notes below.
            </p>
          )}
          {step < lastStep ? (
            <Options
              step={STEPS[step].id}
              schema={schema}
              choices={built.choices}
              variant={variant}
              size={size}
              adds={built.adds}
              refused={built.refused}
              availability={availability}
              mountings={mountings}
              placing={placing}
              onPlace={(kind) => {
                setPicked(null);
                setPlacing(kind);
              }}
              onChange={change}
            />
          ) : (
            <Review quote={quote} size={drawn?.size} issues={issues} />
          )}
        </div>
        <nav className="cfgc-nav" aria-label="Step navigation">
          <button type="button" className="cfgc-back" onClick={() => goTo(step - 1)} disabled={step === 0}>Back</button>
          {step < lastStep ? (
            <button type="button" className="cfgc-next" onClick={() => goTo(step + 1)}>
              Next: {STEPS[step + 1].label}
            </button>
          ) : (
            <CopyLink />
          )}
        </nav>
      </aside>

      <main className="cfgc-stage" aria-label="Your product">
        <Viewer
          configurationId={built.configurationId}
          components={components}
          catalogue={catalogue}
          tierId={tierId}
          rules={rules}
          title={title}
          themed={false}
          layout="stage"
          ar={handoff.ar}
          arWithheld={handoff.withheld}
          // The live choices, for the QR code - see the note on `encoded`.
          scanChoices={encoded}
          // Selection is back in the runtime, but only in the CONFIGURATOR. A
          // plain viewer of one configuration still has nothing to click.
          selectable
          selectedId={picked}
          interaction={interaction}
          spacing={spacing}
          onPick={(drawnId) => {
            const id = drawnId
              ? builderIdOf(built, drawnRef.current, drawnId)
              : null;
            // Tapping the background is how somebody changes their mind about
            // adding a part, as well as how they put one down.
            if (!id) { clearPointer(); return; }
            setPlacing(null);
            setSpacingBay(null);
            setPicked(id);
          }}
          onReady={(info) => {
            drawnRef.current = info?.resolved?.scene?.assembly || null;
            setDrawn(info || null);
            onReady?.(info);
          }}
        />

        {recordOn && (
          <div className="cfgc-rec" role="group" aria-label="Recording">
            <span className="cfgc-recdot" aria-hidden="true" />
            <span className="cfgc-reccount" aria-live="polite">Recording · {logSize} step{logSize === 1 ? '' : 's'}</span>
            <button type="button" onClick={copyRecording}>{copiedLog ? 'Copied' : 'Copy'}</button>
            <button type="button" onClick={downloadRecording}>Download</button>
            <button type="button" onClick={clearRecording}>Clear</button>
          </div>
        )}

        <div className="cfgc-tools" role="toolbar" aria-label="Edit">
          <button type="button" className="cfgc-tool" onClick={undo} disabled={!historySize.past} aria-label="Undo" title="Undo (Ctrl+Z)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" /></svg>
          </button>
          <button type="button" className="cfgc-tool" onClick={redo} disabled={!historySize.future} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" /></svg>
          </button>
        </div>

        {/* Asking WHERE, with a way out. On a phone the rail is out of the way
            at this point - the dots are behind it - so this strip is the only
            thing telling somebody what the dots in front of them are for. */}
        {placing && (
          <div className="cfgg-ask" role="status">
            <span className="cfgg-askwhat">
              {(built.adds || []).find((a) => (a.kind || a.componentId) === placing)?.label || placing}
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

        {/* Never both: the spacing lines are hidden while a part is selected. */}
        {spacingFor && !move && (
          <SpacingPanel
            bay={spacingFor.bay}
            options={spacingFor.options}
            centresMm={spacingFor.centresMm}
            onChoose={applySpacing}
            onClose={() => setSpacingBay(null)}
          />
        )}

        {move && (
          <MovePanel
            label={move.label}
            options={move.options || []}
            types={move.types || []}
            reason={move.reason}
            structural={!!move.structural}
            // A ladder is a POSITION in the run and a span IS the bay, so
            // neither can be removed one at a time - the bay count decides how
            // many there are (Matt, 12 Nov 2026: refused, with the reason).
            canDelete={!!move.slot && move.kind !== 'frame' && move.kind !== 'span'}
            onMove={applyMove}
            onType={applyType}
            onDelete={applyDelete}
            onClose={() => setPicked(null)}
          />
        )}

        {!move && !spacingFor && !placing && (
          <Summary quote={quote} size={drawn?.size} issues={issues} onReview={() => goTo(lastStep)} />
        )}
      </main>
    </div>
  );
}

/** The steps of the guided flow, in Matt's order (brief §B: size → bays → shelves/storage → accessories → finish). */
const STEPS = [
  { id: 'size', label: 'Size' },
  { id: 'bays', label: 'Bays' },
  { id: 'storage', label: 'Shelves & storage' },
  { id: 'accessories', label: 'Accessories' },
  { id: 'mounting', label: 'Mounting' },
  { id: 'review', label: 'Review' },
];

/** Money as the quote has it, or the honest absence of it. */
function priceOf(quote) {
  if (!quote || quote.net == null) return { main: 'Price on request', sub: 'Prices are not on file yet' };
  const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: quote.currency || 'GBP' });
  const total = quote.gross ?? quote.net;
  return {
    main: money.format(total),
    sub: `${quote.gross != null ? 'incl. VAT' : 'excl. VAT'}${quote.complete ? '' : ' · some parts not yet priced'}`,
  };
}

/** The card on the stage: what it costs, how big it is, whether it can be ordered. */
function Summary({ quote, size, issues, onReview }) {
  const price = priceOf(quote);
  return (
    <section className="cfgc-summary" aria-label="Summary">
      <div className="cfgc-price">{price.main}</div>
      <div className="cfgc-sub">
        {price.sub}
        {quote ? ` · ${quote.partCount} part${quote.partCount === 1 ? '' : 's'}` : ''}
        {size ? ` · ${size.w} × ${size.h} × ${size.d} mm` : ''}
      </div>
      <button
        type="button"
        className={`cfgc-state ${issues.length ? 'is-draft' : 'is-ok'}`}
        onClick={onReview}
        aria-label={issues.length ? `Draft, ${issues.length} issue${issues.length === 1 ? '' : 's'}. Review` : 'Ready to order. Review'}
      >
        {issues.length ? `Draft · ${issues.length} issue${issues.length === 1 ? '' : 's'}` : 'Ready to order'}
      </button>
    </section>
  );
}

/** The last step: the parts, the price, and - if it cannot be ordered - why. */
function Review({ quote, size, issues }) {
  const price = priceOf(quote);
  return (
    <div className="cfgc-review">
      {issues.length > 0 && (
        <div className="cfgc-draft" role="status">
          <strong>Draft — this can't be ordered yet.</strong>
          <ul>{issues.map((i) => <li key={i}>{i}</li>)}</ul>
        </div>
      )}
      {size && (
        <dl className="cfgc-dims">
          <div><dt>Width</dt><dd>{size.w} mm</dd></div>
          <div><dt>Height</dt><dd>{size.h} mm</dd></div>
          <div><dt>Depth</dt><dd>{size.d} mm</dd></div>
        </dl>
      )}
      {quote && (
        <table className="cfgc-bom">
          <caption>Parts list</caption>
          <thead><tr><th scope="col">Art.</th><th scope="col">Part</th><th scope="col" className="q">Qty</th></tr></thead>
          <tbody>
            {quote.lines.map((l) => (
              <tr key={l.componentId} className={l.implied ? 'is-implied' : undefined}>
                <td className="art">{l.article || '—'}</td>
                <td>{l.description}{l.implied && <small> Included — {l.because || 'not chosen'}</small>}</td>
                <td className="q">{l.qty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {quote?.notes?.length > 0 && (
        <ul className="cfgc-notes">{quote.notes.map((n) => <li key={n.text || n}>{n.text || n}</li>)}</ul>
      )}
      <p className="cfgc-total"><strong>{price.main}</strong> <span>{price.sub}</span></p>
    </div>
  );
}

/** Copy this configuration's link: the review step's action until a quote destination exists. */
function CopyLink() {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch { /* a page that cannot reach the clipboard still shows its URL */ }
  };
  return (
    <button type="button" className="cfgc-next" onClick={copy} aria-live="polite">
      {done ? 'Link copied' : 'Copy link to this design'}
    </button>
  );
}
