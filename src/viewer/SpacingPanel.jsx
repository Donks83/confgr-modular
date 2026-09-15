// What a customer gets when they tap the line between two ladders.
//
// Matt: "can we have a marker similar to the hot spot dots that is a line
// connecting two neighbouring ladders that you can click to choose the spacing
// between those ladders". This is the second half of that - the line is in the
// scene, and this is what it opens.
//
// ONE BAY, NOT THE RUN. The Width control in the options sheet still means all
// of them, which is the right default and the thing somebody reaches for first.
// This means exactly the gap it was drawn across, and the title says which.
//
// NO three.js IN ITS IMPORTS, like MovePanel and the option panel, so it can be
// rendered in jsdom and asserted on.
//
// IT WEARS MovePanel's CLOTHES on purpose. Both are "you tapped a thing in the
// scene, here is what it can be" - a second visual language for the same idea
// would be one more thing to learn for no reason.

import React from 'react';
import './move.css';

export default function SpacingPanel({
  /** The bay's position in the run, counting from zero. */
  bay = 0,
  /** [{id, label, current}] - the widths this variant offers. */
  options = [],
  /**
   * The measured distance between the two ladders' centres.
   *
   * Shown quietly and only when it differs from the label, because it usually
   * does: a YouK 900 bay stands its ladders 920 mm apart, since the shelf
   * overhangs the stiles. Somebody planning a run against a wall needs the
   * number that is true of the product rather than the one on the box, and
   * printing the label over the measurement would be inventing a figure.
   */
  centresMm = null,
  onChoose,
  onClose,
}) {
  // A BAY IS NOT REMOVABLE FROM HERE, and there is deliberately no delete
  // button below. How many bays there are is the Bays stepper's business;
  // offering "remove" on a gap would either take a bay out of the middle of a
  // run or do nothing. MovePanel refuses the same thing for a ladder, for the
  // same reason.
  return (
    <div className="cfgm" role="dialog" aria-label={`Spacing of bay ${bay + 1}`}>
      <div className="cfgm-head">
        <span className="cfgm-title">
          {`Between ladder ${bay + 1} and ${bay + 2}`}
        </span>
        <button type="button" className="cfgm-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <div className="cfgm-label">Spacing</div>
      <div className="cfgm-heights">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            className={`cfgm-height${o.current ? ' cfgm-on' : ''}`}
            aria-current={o.current || undefined}
            // Choosing the one that is already chosen is how somebody closes a
            // panel they opened by mistake, which is the same behaviour the
            // height list has.
            onClick={() => (o.current ? onClose() : onChoose(o))}
          >
            {o.label}
          </button>
        ))}
      </div>

      {centresMm != null && (
        <p className="cfgm-reason">
          {`Ladder centres ${centresMm} mm apart`}
        </p>
      )}

      {!options.length && (
        <p className="cfgm-reason">
          This range offers one width, so there is nothing to choose.
        </p>
      )}
    </div>
  );
}
