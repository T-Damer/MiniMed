/**
 * What is taken out of an EPUB chapter before it is printed (SEC-AUDIT1). The book is someone
 * else's file and its markup lands in the app's own page (the native print preview) or a
 * same-origin window: nothing that runs, submits, redirects or re-bases may survive.
 */
import { isActiveUrl } from '@/features/news/page-frame';

/** Elements removed with everything inside them. */
export const EPUB_ACTIVE_SELECTOR =
  'script, noscript, iframe, frame, frameset, object, embed, applet, base, meta[http-equiv], form, button';

/**
 * An event handler, or any value that is a script address. `isActiveUrl` ignores the tabs and
 * newlines a browser skips inside a scheme (`java\tscript:`), which a plain prefix test missed.
 */
export function epubAttributeIsActive(name: string, value: string): boolean {
  return name.toLowerCase().startsWith('on') || isActiveUrl(value);
}
