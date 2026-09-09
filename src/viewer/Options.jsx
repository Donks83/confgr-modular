// The controls a customer actually gets, and nothing else.
//
// This is the visible half of the guided flow (§5.24). The engine decides where
// parts go; this decides what a person is asked. It holds no state of its own -
// choices come in, changes go out - so the same panel serves the runtime, a
// future embed and a test without any of them disagreeing about what was
// chosen.
//
// NO three.js AND NO WebGL IN ITS IMPORTS, deliberately, which is what lets
// jsdom render it and assert on the controls. The AR button was split out for
// the same reason and the reason held: a rule that cannot fail a test is
// folklore.
//
// WHY SEGMENTED BUTTONS RATHER THAN SELECTS for depth, width and height: there
// are two to four options, every one is worth seeing at a glance, and a native
// select on a phone opens a modal wheel for something that should be one tap.
// Counts get a stepper rather than a number field because a number field on a
// phone opens a keyboard to change 1 into 2.

import React from 'react';

/** One row of mutually exclusive options. */
function Choice({
  label, help, options, value, onChange,
}) {
  if (options.length < 2) return null;
  return (
    <div className="cfgo-group">
      <div className="cfgo-label">{label}</div>
      {help && <p className="cfgo-help">{help}</p>}
      <div className="cfgo-seg" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={o.id === value}
            className={`cfgo-segbtn${o.id === value ? ' cfgo-on' : ''}`}
            onClick={() => onChange(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Minus, a number, plus.
 *
 * `off` is a row that cannot be used at all - the part has no joint this frame
 * offers, so there is nowhere for it to go however many bays there are. The row
 * STAYS, greyed, carrying the reason. Matt chose that over hiding it: a list
 * whose rows appear and disappear as you change depth reads as things going
 * missing, and the customer never learns why the thing they wanted is not
 * there.
 */
function Stepper({
  label, note, value, min = 0, max = 9, off = false, active = false, onChange,
}) {
  return (
    <div className={`cfgo-row${off ? ' cfgo-rowoff' : ''}${active ? ' cfgo-rowon' : ''}`}>
      <div className="cfgo-rowtext">
        <span className="cfgo-rowlabel">{label}</span>
        {/* The refusal, in the place the person can act on it. A count that
            silently stops going up is indistinguishable from a broken
            control. */}
        {note && <span className="cfgo-note">{note}</span>}
      </div>
      <div className="cfgo-stepper">
        <button
          type="button"
          className="cfgo-step"
          aria-label={`One fewer ${label}`}
          disabled={off || value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
        >
          −
        </button>
        <span className="cfgo-count" aria-live="polite">{value}</span>
        <button
          type="button"
          className="cfgo-step"
          aria-label={`One more ${label}`}
          disabled={off || value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
        >
          +
        </button>
      </div>
    </div>
  );
}

export default function Options({
  schema, choices, variant, size, refused = [], availability = {},
  mountings = [],
  /**
   * WHAT `+` MEANS, and it changed in §5.25.
   *
   * When a caller supplies `onPlace`, pressing + does not add a part - it says
   * "another one of these, and I will show you where". The dots come up in the
   * scene and the next tap decides the position. Matt: "click a dot add an
   * accessory to the dot".
   *
   * Without it, + still increments and the engine places, which is what the
   * embed and the tests use. Two behaviours from one control, decided by the
   * caller rather than by a mode flag inside here.
   */
  onPlace = null,
  placing = null,
  onChange,
}) {
  if (!schema || !choices || !variant || !size) return null;

  const set = (patch) => onChange({ ...choices, ...patch });

  // What the engine could not place, by part, so a stepper can say so next to
  // itself rather than in a list somewhere else on the page.
  const shortfall = new Map(refused.map((r) => [r.componentId, r]));

  // Two different sentences from two different questions, and the unavailable
  // one wins: "not available on 200 mm deep frames" is why the control is dead,
  // and printing "only 2 fit" over the top of it would explain the wrong thing.
  const noteFor = (componentId) => {
    const a = availability[componentId];
    if (a && a.ok === false) return a.reason;
    const r = shortfall.get(componentId);
    if (!r) return null;
    if (r.placed > 0) return `only ${r.placed} fit`;
    return 'no room for one';
  };

  return (
    <div className="cfgo">
      <Choice
        label="Depth"
        help={variant.help}
        options={schema.variants.map((v) => ({ id: v.id, label: v.label }))}
        value={variant.id}
        onChange={(id) => set({ variantId: id })}
      />

      <Choice
        label="Width"
        options={variant.sizes.map((s) => ({ id: s.id, label: s.label }))}
        value={size.id}
        onChange={(id) => set({ sizeId: id })}
      />

      <Choice
        label="Height"
        options={variant.frames.map((f) => ({ id: f.componentId, label: f.label }))}
        value={choices.frameId}
        onChange={(id) => set({ frameId: id })}
      />

      <div className="cfgo-group">
        <div className="cfgo-label">Size</div>
        <Stepper
          label="Bays"
          value={choices.bays}
          min={1}
          max={variant.maxBays ?? 4}
          onChange={(bays) => set({ bays })}
        />
      </div>

      {(size.adds || []).length > 0 && (
        <div className="cfgo-group">
          <div className="cfgo-label">Add to it</div>
          {size.adds.map((a) => (
            <Stepper
              key={a.componentId}
              label={a.label || a.componentId}
              note={placing === a.componentId
                ? 'tap a dot in the view'
                : noteFor(a.componentId)}
              off={availability[a.componentId]?.kind === 'never'}
              active={placing === a.componentId}
              value={choices.adds?.[a.componentId] || 0}
              max={a.perBay ? (a.max ?? 1) * choices.bays : (a.max ?? 4)}
              onChange={(n) => {
                const now = choices.adds?.[a.componentId] || 0;
                // Going UP is a question about where; going down is not.
                if (onPlace && n > now) { onPlace(a.componentId); return; }
                set({ adds: { ...choices.adds, [a.componentId]: n } });
              }}
            />
          ))}
        </div>
      )}

      {mountings.length > 1 && (
        <Choice
          label="Standing on"
          options={mountings}
          value={choices.mounting}
          onChange={(mounting) => set({ mounting })}
        />
      )}
    </div>
  );
}
