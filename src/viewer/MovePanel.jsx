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
// missing, which a drag that simply refuses to land cannot.

import React from 'react';
import './move.css';

export default function MovePanel({
  label, options = [], reason = null, structural = false, canDelete = true,
  onMove, onDelete, onClose,
}) {
  return (
    <div className="cfgm" role="dialog" aria-label={`Move ${label || 'part'}`}>
      <div className="cfgm-head">
        <span className="cfgm-title">{label || 'This part'}</span>
        <button type="button" className="cfgm-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      {/* The engine's own sentence, not a rephrasing of it. A frame that says
          "change the size instead" is more use than a greyed-out list. */}
      {reason && <p className={`cfgm-reason${structural ? ' cfgm-structural' : ''}`}>{reason}</p>}

      {options.length > 0 && (
        <>
          <div className="cfgm-label">Height</div>
          <div className="cfgm-heights">
            {options.map((o) => (
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
          saying, because the alternative is a panel that looks broken. */}
      {!reason && options.length <= 1 && (
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
