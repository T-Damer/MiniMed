/**
 * Links inside an imported document (SEC-AUDIT1). A DOCX is someone else's file shown inside the
 * app's own page, and docx-preview copies any hyperlink target as is, `javascript:` included.
 */

/** Link schemes a rendered document may keep. */
const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/** Whether a document's link may keep its address: an in-document `#` link or a safe scheme. */
export function documentLinkAllowed(href: string): boolean {
  if (href.startsWith('#')) return true;
  try {
    return SAFE_LINK_PROTOCOLS.has(new URL(href, 'https://document.invalid/').protocol);
  } catch {
    return false;
  }
}

/** Takes the address off every unsafe link under `root`; the link text stays. */
export function disarmDocumentLinks(root: ParentNode): void {
  for (const link of Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    const href = link.getAttribute('href') ?? '';
    if (!documentLinkAllowed(href)) link.removeAttribute('href');
    else if (!href.startsWith('#')) link.rel = 'noopener noreferrer';
  }
}
