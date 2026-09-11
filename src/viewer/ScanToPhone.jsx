// The QR code, drawn as SVG.
//
// SVG RATHER THAN CANVAS, and rather than the library's own `createImgTag`.
// A QR is a grid of hard-edged squares, which is the one thing a raster image
// is bad at: a canvas at the wrong device pixel ratio blurs every module edge,
// and a blurred edge is exactly what a camera's binariser has to guess about.
// SVG modules are crisp at any zoom, on any screen, and print correctly if
// somebody puts this in a PDF later.
//
// ONE PATH, not N rects. A version 13 code is 69 x 69 = 4,761 cells, roughly
// half of them dark: two thousand DOM nodes for one picture, restyled on every
// option change. A single `d` string draws the same thing as one node.
//
// ERROR CORRECTION 'M'. The four levels trade capacity against damage
// tolerance, and every step up costs characters - which is the resource this is
// already short of. L is enough for a clean screen and leaves nothing spare if
// the screen is dusty or the photo is taken at an angle; M is the usual choice
// for exactly this case and costs about a version.

import React, { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/** Blank margin around the code, in modules. Four is the spec's minimum. */
export const QUIET_ZONE = 4;

/**
 * The path data for one URL, plus the size of the grid it was drawn on.
 *
 * Pure, and exported, so a test can count modules without rendering anything:
 * "does this draw a real code" is a question about the matrix, not about React.
 */
export function qrPath(text, { quiet = QUIET_ZONE } = {}) {
  // 0 means "pick the smallest version that fits", which is the whole point -
  // a three-bay product and a one-bay product should not produce the same
  // oversized grid.
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();

  const count = qr.getModuleCount();
  const parts = [];
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      // Runs of adjacent dark modules become ONE rect rather than several,
      // which is most of them: a QR is full of horizontal runs.
      if (!qr.isDark(row, col)) continue;
      let run = 1;
      while (col + run < count && qr.isDark(row, col + run)) run += 1;
      parts.push(`M${col + quiet} ${row + quiet}h${run}v1h-${run}z`);
      col += run - 1;
    }
  }

  return { d: parts.join(''), count, size: count + quiet * 2 };
}

/**
 * @param url      what the code carries - already decided by `scanAvailability`
 * @param label    the line above it
 * @param showUrl  print the URL underneath, for somebody with no camera to hand
 */
export default function ScanToPhone({ url, label = 'Open this on your phone', showUrl = false }) {
  const code = useMemo(() => {
    if (!url) return null;
    try {
      return qrPath(url);
    } catch {
      // The library throws when the text will not fit in a version 40 code.
      // That cannot happen with `o` on this range - the longest measured is 363
      // characters against a 2,331-character ceiling - but a schema with many
      // moved parts could grow, and a missing code beats a broken page.
      return null;
    }
  }, [url]);

  if (!code) return null;

  return (
    <div className="cfgv-scan">
      <p className="cfgv-scan-label">{label}</p>
      <svg
        className="cfgv-scan-code"
        viewBox={`0 0 ${code.size} ${code.size}`}
        role="img"
        aria-label="QR code linking to this product"
        // Crisp edges at any size. Without it a browser anti-aliases the module
        // boundaries when the SVG is scaled to a non-integer multiple, which is
        // the same blur that canvas was rejected for.
        shapeRendering="crispEdges"
      >
        {/* The quiet zone has to be WHITE, not transparent: the spec's margin
            is part of the code, and over a dark page a transparent margin is
            a code with no margin, which many readers simply will not see. */}
        <rect width={code.size} height={code.size} fill="#ffffff" />
        <path d={code.d} fill="#111111" />
      </svg>
      {showUrl && <p className="cfgv-scan-url">{url}</p>}
    </div>
  );
}
