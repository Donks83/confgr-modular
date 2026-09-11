// Handing this page to a phone, which is the other half of the AR story.
//
// AR needs a phone, and the person configuring is usually at a desk. Until now
// the desktop case ended in a sentence — "AR needs a phone or tablet. Open this
// page on one." — which is honest and leaves the reader to retype a URL with
// four hundred characters of base64 in it. Nobody does that. A QR code is the
// whole of the fix: point a camera at the screen and the same product opens in
// your hand.
//
// WHY THIS IS A FILE OF ITS OWN, with no React and no QR library in it. Drawing
// a QR is a solved problem somebody else has solved. Deciding WHAT TO PUT IN IT
// is this project's problem, it is where the failures live, and every one of
// them is silent:
//
//   A code carrying `http://localhost:8124` scans perfectly and opens the
//   PHONE'S OWN localhost, which is nothing. The code is not broken and the
//   scan is not broken; the URL was never portable.
//
//   A code carrying a `file:///C:/...` page does the same, worse.
//
//   A code carrying the full URL is 647 to 1,126 characters — measured on this
//   range — which needs QR version 20 to 28: up to 125 modules across. On a
//   screen at any sensible size that is about two pixels per module, and a
//   phone waves at it for ten seconds. The SAME PRODUCT in 228 to 363
//   characters is version 11 to 15, and reads instantly.
//
// That last one is the reason this file exists rather than a one-liner. The URL
// carries BOTH `c` (the configuration id) and `o` (the choices), and `Guided`
// reads only `o` on the way in — `c` is rebuilt from it. So the code needs only
// `o`, and dropping `c` roughly halves the module count for nothing.
//
// And because `o` is COUNTS rather than parts (§5.24's state model), it barely
// grows: one bay and three bays are both 228 characters. The QR does not get
// harder to scan as the product gets bigger, which is not something anyone
// designed for and is worth not throwing away.

/**
 * Hosts that mean "this machine" and therefore mean nothing to a phone.
 *
 * `0.0.0.0` is in here because a server bound to it is often reached that way
 * in a browser, and it is the same trap with a different spelling.
 */
const OWN_MACHINE = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);

/** A URL a phone camera can act on, or the reason there is not one. */
export function scanAvailability({
  pageHref = '', choices = null, configurationId = null,
} = {}) {
  const no = (reason) => ({ ok: false, url: null, reason });

  if (!pageHref) return no(null);

  let page;
  try {
    page = new URL(pageHref);
  } catch {
    return no(null);
  }

  if (page.protocol === 'file:') {
    // The most likely way somebody meets this: they double-clicked index.html.
    // Naming the fix is worth more than naming the fault.
    return no('This page was opened from a folder rather than a web server, so '
      + 'there is no address a phone could open. Run "Start Preview.bat" and use '
      + 'the address it prints.');
  }

  if (!/^https?:$/.test(page.protocol)) return no(null);

  if (OWN_MACHINE.has(page.hostname)) {
    // A code of this URL scans perfectly and opens the phone's own localhost.
    // The failure is invisible at the scanning end, so it has to be caught here.
    return no('This page is open at "localhost", which means this computer only '
      + '— a phone scanning it would look at itself. Open the page at this '
      + "machine's network address instead, and the code will appear.");
  }

  // The short form, deliberately. `o` alone restores the product because the
  // runtime rebuilds `c` from it; carrying both would double the code for a
  // parameter that is thrown away on arrival.
  const url = new URL(page.href);
  url.search = '';
  url.hash = '';
  if (choices) {
    url.searchParams.set('o', choices);
  } else if (configurationId) {
    // A bundle with no option schema has no choices to carry, so the id is the
    // only description of the product there is. Longer, and unavoidable.
    url.searchParams.set('c', configurationId);
  }

  return { ok: true, url: url.href, reason: null };
}

/**
 * How many characters the code will carry, and therefore how hard it is to scan.
 *
 * Exported because the number is the whole argument for dropping `c`, and a
 * number in a comment rots while a number in a test does not.
 */
export const scanLength = (result) => (result?.url ? result.url.length : 0);
