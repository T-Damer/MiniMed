/**
 * The page «as on the site» (ADR-0024, amended 2026-10-08): the HTML the app downloaded itself,
 * with every script and active element removed, shown through `<iframe srcdoc sandbox>`. The
 * sandbox never gets `allow-scripts` (and never `allow-same-origin` with it), a CSP in the document
 * forbids scripts again, and a `<base>` makes the site's relative stylesheets, images and links
 * resolve, with links opening outside the frame.
 */

/** Elements removed with everything inside them. */
const ACTIVE_SELECTOR = [
  'script',
  'noscript',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'base',
  'meta[http-equiv]',
  'link[rel~="import"]',
  'link[rel~="preload"]',
  'link[rel~="prefetch"]',
  'link[rel~="modulepreload"]',
].join(',');

/** Attributes that carry an address a click or a load may follow. */
const URL_ATTRIBUTES = ['href', 'src', 'action', 'formaction', 'xlink:href', 'data', 'poster'];

export const PAGE_FRAME_CSP =
  "script-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'";

/** A script-bearing address: `javascript:`, `vbscript:` or an HTML document in a `data:` URL. */
export function isActiveUrl(value: string): boolean {
  // Browsers ignore tabs, newlines and other control characters inside a scheme.
  const compact = [...value]
    .filter((char) => char.charCodeAt(0) > 0x20)
    .join('')
    .toLowerCase();
  return (
    compact.startsWith('javascript:') ||
    compact.startsWith('vbscript:') ||
    compact.startsWith('data:text/html') ||
    compact.startsWith('data:application/xhtml')
  );
}

function stripActiveContent(document: Document): void {
  for (const element of Array.from(document.querySelectorAll(ACTIVE_SELECTOR))) element.remove();
  for (const element of Array.from(document.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on')) {
        element.removeAttribute(attribute.name);
      } else if (URL_ATTRIBUTES.includes(name) && isActiveUrl(attribute.value)) {
        element.removeAttribute(attribute.name);
      }
    }
  }
}

/**
 * Builds the document for the frame from downloaded HTML. `finalUrl` is where the page came from
 * (after redirects): it becomes the base of every relative address.
 */
export function buildPageFrameDocument(html: string, finalUrl: string): string {
  const document = new DOMParser().parseFromString(html, 'text/html');
  stripActiveContent(document);
  const head = document.head;
  const guard = document.createElement('meta');
  guard.setAttribute('http-equiv', 'Content-Security-Policy');
  guard.setAttribute('content', PAGE_FRAME_CSP);
  const referrer = document.createElement('meta');
  referrer.setAttribute('name', 'referrer');
  referrer.setAttribute('content', 'no-referrer');
  const base = document.createElement('base');
  base.setAttribute('href', finalUrl);
  base.setAttribute('target', '_blank');
  head.prepend(base, referrer, guard);
  return `<!doctype html>${document.documentElement.outerHTML}`;
}
