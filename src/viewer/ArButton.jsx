// The AR handoff, as a component of its own — because its DOM shape is a
// requirement rather than a style.
//
// AR Quick Look honours `rel="ar"` only when the anchor's single CHILD ELEMENT
// is an `<img>` or a `<picture>`. Get that wrong and iOS quietly downloads the
// USDZ as a file: no error, no console message, a correct model that appears
// not to work. It is the single most common reason a working USDZ looks broken,
// and it is invisible to every check this project has — a build compiles, a
// snapshot matches, the URL is right, and the feature is dead.
//
// So it lives here, on its own, with no three.js and no WebGL anywhere in its
// imports, which is what lets `tests/arButton.test.jsx` render it in jsdom and
// COUNT THE CHILDREN. That is the whole reason for the split: the rule is
// testable or it is folklore.
//
// `arAvailability` has already decided; this only draws the decision.

import React from 'react';
import { AR_MODE } from './ar-link.js';

/**
 * The image Quick Look insists on.
 *
 * The stroke colour is written out rather than `currentColor`, which cannot
 * work: an SVG loaded through an `<img>` is a separate document and inherits
 * nothing from the page. It matches `.cfgv-ar`'s colour in viewer.css, and the
 * two have to be changed together. Inline as a data URI because a bundle that
 * fetches nothing has to carry its own icon.
 */
export const AR_GLYPH = 'data:image/svg+xml;utf8,'
  + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" '
    + 'stroke="#1b1815" stroke-width="1.6" stroke-linecap="round" '
    + 'stroke-linejoin="round">'
    + '<path d="M12 2.8 20.5 7v10L12 21.2 3.5 17V7z"/>'
    + '<path d="M3.5 7 12 11.6 20.5 7M12 11.6v9.6"/>'
    + '</svg>',
  );

export default function ArButton({ availability, hasAr = true }) {
  if (!availability) return null;

  // iOS. ONE child, and it is the <img>. The label is a CSS `::after`, which is
  // not a child element and therefore does not break the rule.
  if (availability.mode === AR_MODE.QUICK_LOOK) {
    return (
      <a className="cfgv-ar" rel="ar" href={availability.url}>
        <img src={AR_GLYPH} alt="View this product in your room" />
      </a>
    );
  }

  // Android. Scene Viewer has no such rule, so the label is real text — which
  // is better for a screen reader and for anyone who has images turned off.
  if (availability.mode === AR_MODE.SCENE_VIEWER) {
    return (
      <a className="cfgv-ar cfgv-ar-text" href={availability.url}>
        <img src={AR_GLYPH} alt="" aria-hidden="true" />
        <span>View in your room</span>
      </a>
    );
  }

  // And when it cannot: the reason, never a disabled button. A greyed-out
  // control invites tapping and explains nothing, while "open this on a phone"
  // is an instruction somebody can follow. Silent when the bundle has no AR at
  // all, because then there is nothing the reader could do about it.
  if (!hasAr || !availability.reason) return null;
  return <p className="cfgv-ar-no">{availability.reason}</p>;
}
