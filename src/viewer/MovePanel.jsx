// What a customer gets when they tap a part.
//
// Three things and no more: where it can go, what it is, and how to remove it.
// The heights come from the engine (`moveOptions`), which builds each one by
// actually performing the move on a copy and surveying the result - so an
// option that is offered is an option that works.
//
// NO three.js IN ITS IMPORTS, like the option panel and the AR button, so its
// behaviour is testable in jsdom. That has now caught something in each of the
// three.
//
// WHY A LIST OF HEIGHTS rather than dragging. Dragging a 30 mm stile with a
// thumb on a phone is a poor bet, and the complaint this answers - "all of the
// addons are just on the bottom rail" - is about height rather than about free
// movement. A list is also the only version that can say WHY an option is
// missing, which a drag that simply refuses to land cannot. Since §5.25 the
// dots do the dragging and this does the same job with a thumb; both write the
// same record.
//
// A TAPPED LADDER GETS A TYPE LIST TOO, from Matt: "maybe i can click on a
// ladder in the scene and change its type and then change what height it
// sits?" Type first, because on a floor-standing run it is the only one of the
// two that has more than one answer - see `types` below.

import React from 'react';
import './move.css';

export default function MovePanel({
  label,
  options = [],
  /**
   * The ladder types this position can take: [{componentId, label, current}].
   *
   * Empty for an accessory. For a frame it is the variant's own list, because
   * "these are all ladders" is a fact about the range and lives in the schema.
   */
  types = [],
  reason = null,
  structural = false,
  canDelete = true,
  onMove, onType, onDelete, onClose,
}) {
  // A LIST OF ONE IS NOT A CHOICE. On a floor-standing run a ladder has exactly
  // one legal height - it stands on the floor - because mating a span by a
  // higher rung hangs the ladder LOWER, and the engine now refuses anything
  // below the floor. Drawing a "Height" heading over a single button that is
  // already selected invites somebody to look for the others.
  const heights = options.length > 1 ? options : [];

  return (
    <div className="cfgm" role="dialog" aria-label={`Change ${label || 'part'}`}>
      <div className="cfgm-head">
        <span className="cfgm-title">{label || 'This part'}</span>
        <button type="button" className="cfgm-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      {types.length > 1 && (
        <>
          <div className="cfgm-label">Type</div>
          <div className="cfgm-heights">
            {types.map((t) => (
              <button
                key={t.componentId}
                type="button"
                className={`cfgm-height${t.current ? ' cfgm-on' : ''}`}
                aria-current={t.current || undefined}
                onClick={() => (t.current ? undefined : onType(t))}
              >
                {t.label}
              </button>
            ))}
          </div>
        </>
      )}

      {/* The engine's own sentence, not a rephrasing of it. A frame that says
          "change the size instead" is more use than a greyed-out list. */}
      {reason && <p className={`cfgm-reason${structural ? ' cfgm-structural' : ''}`}>{reason}</p>}

      {heights.length > 0 && (
        <>
          <div className="cfgm-label">Height</div>
          <div className="cfgm-heights">
            {heights.map((o) => (
              <button
                key={o.heightMm}
                type="button"
                className={`cfgm-height${o.current ? ' cfgm-on' : ''}`}
                aria-current={o.current || undefined}
                onClick={() => (o.current ? onClose() : onMove(o))}
              >
                {o.heightMm} mm
              </button>
            ))}
          </div>
        </>
      )}

      {/* An accessory that is on the product but has nowhere else to go. Worth
          saying, because the alternative is a panel that looks broken. A ladder
          says nothing here: it has a type list, so the panel is not empty, and
          "nowhere else to go" is not the interesting fact about it. */}
      {!reason && !types.length && options.length <= 1 && (
        <p className="cfgm-reason">
          There is nowhere else on this product for it to go.
        </p>
      )}

      {canDelete && (
        <button type="button" className="cfgm-delete" onClick={onDelete}>
          Remove this one
        </button>
      )}
    </div>
  );
}
