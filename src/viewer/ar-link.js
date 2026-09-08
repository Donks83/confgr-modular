// The handoff from a web page to the phone's own AR viewer.
//
// This is the last link in the chain the project has been building one piece at
// a time: measure a part, place it, encode the configuration, export a GLB
// (§5.19), convert it to USDZ (§5.20), ship both in a folder (§5.22). None of
// that reaches a room until a browser hands a file to ARKit or ARCore, and
// neither of them is a thing you can call. There is no API. There are two
// URLs, each with rules that fail silently when broken, and this file is the
// only place in the project that knows them.
//
// WHY IT IS PURE. No three.js, no React, no DOM. `arAvailability` answers a
// question about a page from strings, which means the whole of the platform
// decision is testable in Node — and the platform decision is exactly the part
// nobody can test by looking at their own laptop, because their laptop is
// neither of the two platforms that matter.
//
// WHAT EACH SIDE DEMANDS
//
//   iOS — AR Quick Look. An <a rel="ar"> whose ONLY child is an <img> or a
//   <picture>. That is not a style convention: Safari looks for the image
//   child, and without one it treats the link as an ordinary download and
//   shows the USDZ as a file. Apple's own note ("Adding an AR Quick Look to a
//   Webpage") is explicit about the single-image-child requirement, and it is
//   the single most common reason a correct USDZ appears not to work.
//
//   Android — Scene Viewer. An intent:// URL carrying `file=<absolute url>`.
//   ABSOLUTE, and fetched by Scene Viewer itself rather than by the page, so a
//   relative path, a `file://` page or a blob URL cannot work at all: the
//   viewer is a different process and has no idea what the page's base was.
//
// Both of those are refusals we can detect BEFORE the user taps, which is the
// whole reason this returns a `reason` alongside a mode. A button that does
// nothing is the worst of the available outcomes; a button that is not there,
// with a sentence saying why, is the second best; the best is a button that
// works, and that is the case this file exists to produce.

import { placementFor } from '../engine/ar.js';

/** Where the exporter puts the two AR files, relative to index.html. */
export const AR_DIR = 'ar';

export const AR_MODE = {
  /** iOS: an <a rel="ar"> to a USDZ. */
  QUICK_LOOK: 'quick-look',
  /** Android: an intent:// URL to Scene Viewer, carrying an absolute GLB url. */
  SCENE_VIEWER: 'scene-viewer',
  /** Neither, and `reason` says which of the several reasons it is. */
  NONE: 'none',
};

/**
 * Which platform this is, from what a browser will tell us.
 *
 * `maxTouchPoints` is not belt-and-braces. Since iPadOS 13 an iPad reports its
 * user agent as "Macintosh; Intel Mac OS X" — deliberately, so that sites stop
 * serving it a phone layout — and a UA sniff alone therefore hands every iPad
 * the desktop answer and no AR at all. A Mac with a touchscreen does not
 * exist, so "claims to be a Mac and has more than one touch point" is iPadOS.
 *
 * The iOS answer does not depend on the browser being Safari. Every browser on
 * iOS is WebKit underneath, and AR Quick Look rides on WebKit rather than on
 * Safari's chrome. Whether every third-party shell honours `rel="ar"` is one of
 * the two questions on this project's list that only a real device settles
 * (§5.20) — so this offers the link, and the failure if there is one is a file
 * download rather than a broken page.
 */
export function platformOf({ userAgent = '', maxTouchPoints = 0 } = {}) {
  if (/iPad|iPhone|iPod/i.test(userAgent)) return 'ios';
  if (/\bMac(intosh| OS X)\b/i.test(userAgent) && maxTouchPoints > 1) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  return 'other';
}

/**
 * The absolute URL of one of the bundle's AR files, or null.
 *
 * Absolute because Scene Viewer needs one, and resolved against the PAGE
 * rather than against a configured origin because a bundle does not know where
 * it will be hosted — a client's IT department will put it in a subdirectory
 * and nobody will tell us.
 */
export function arAssetUrl(file, pageHref) {
  if (!file || !pageHref) return null;
  try {
    return new URL(`${AR_DIR}/${file}`, pageHref).href;
  } catch {
    return null;
  }
}

/**
 * Scene Viewer, by intent.
 *
 * `mode=ar_preferred` rather than `ar_only`: on a phone without ARCore,
 * ar_only fails outright while ar_preferred falls back to Scene Viewer's own
 * 3D viewer, which is a worse experience than AR and a much better one than an
 * error. `S.browser_fallback_url` is the third rung — a phone with no Scene
 * Viewer at all returns to the page it came from, rather than to a Play Store
 * listing for something the person did not ask to install.
 *
 * `enable_vertical_placement` comes from `placementFor` rather than from a
 * boolean invented here, because the engine has known which products go on
 * walls since long before there was anything to hand to a phone, and a second
 * opinion about it is precisely the failure mode this project keeps hitting.
 */
export function sceneViewerUrl(glbUrl, { title = null, mounting = null, pageHref = null } = {}) {
  if (!/^https?:\/\//i.test(glbUrl || '')) return null;

  const params = new URLSearchParams();
  params.set('file', glbUrl);
  params.set('mode', 'ar_preferred');
  if (title) params.set('title', title);
  const placement = mounting ? placementFor(mounting) : null;
  if (placement?.sceneViewerEnableVerticalPlacement) {
    params.set('enable_vertical_placement', 'true');
  }

  const fallback = /^https?:\/\//i.test(pageHref || '') ? pageHref : glbUrl;

  // Assembled by hand, not with URL(): an intent:// URL is not a hierarchical
  // URL and `new URL` will not keep the fragment's `;`-separated fields intact.
  return `intent://arvr.google.com/scene-viewer/1.0?${params.toString()}`
    + '#Intent;scheme=https;package=com.google.android.googlequicksearchbox'
    + ';action=android.intent.action.VIEW'
    + `;S.browser_fallback_url=${encodeURIComponent(fallback)};end;`;
}

/**
 * Can this page offer AR, and if not, why not?
 *
 * `ar` is the manifest's block, so a bundle exported with `--no-ar` says so
 * honestly instead of offering a link to a file that was never written.
 */
export function arAvailability({
  ar = null, pageHref = '', userAgent = '', maxTouchPoints = 0, mounting = null, title = null,
} = {}) {
  const no = (reason) => ({ mode: AR_MODE.NONE, url: null, reason });

  if (!ar) return no('This bundle was exported without AR files.');

  const platform = platformOf({ userAgent, maxTouchPoints });

  if (platform === 'ios') {
    const url = arAssetUrl(ar.usdz, pageHref);
    if (!url) return no('This bundle has no USDZ, which is the only format iOS reads.');
    // No http(s) check. Quick Look is handed the file by WebKit rather than
    // fetching it in a second process, so unlike Scene Viewer it has no
    // objection to the page's origin.
    return { mode: AR_MODE.QUICK_LOOK, url, reason: null };
  }

  if (platform === 'android') {
    const glb = arAssetUrl(ar.glb, pageHref);
    if (!glb) return no('This bundle has no GLB, which is what Scene Viewer reads.');
    const url = sceneViewerUrl(glb, { title, mounting, pageHref });
    if (!url) {
      // The honest version of the most likely failure: somebody opened
      // index.html by double-clicking it. Quick Look would survive that;
      // Scene Viewer cannot, and saying which is more use than a dead button.
      return no('Android needs this folder on a web server — Scene Viewer '
        + 'fetches the model itself and cannot see a file on your device.');
    }
    return { mode: AR_MODE.SCENE_VIEWER, url, reason: null };
  }

  return no('AR needs a phone or tablet. Open this page on one to place the '
    + 'product in your room.');
}

/**
 * What the manifest records about a bundle's AR files.
 *
 * The triangle count is written down because it is the number that decides
 * whether AR will be smooth, `arReadiness` already measures it against a
 * published limit, and a bundle that carries the figure can be diagnosed by
 * whoever receives it — which is not true of a folder you have to re-export to
 * ask a question about.
 */
export function arBlock({ glb, usdz, triangles = null, vertical = false }) {
  if (!glb && !usdz) return null;
  return {
    glb: glb || null,
    usdz: usdz || null,
    triangles,
    vertical: !!vertical,
  };
}
