/**
 * What a link to another site shows in running text: the site's name, not the whole address
 * («publication.pravo.gov.ru» for a long registry URL). A short address, or one that cannot be read,
 * is shown as written. The full address stays in the link and its title.
 */
const SHORT_URL_LENGTH = 32;

export function externalUrlLabel(url: string): string {
  if (url.length <= SHORT_URL_LENGTH) return url;
  try {
    const host = new URL(url).hostname.replace(/^www\./u, '');
    return host || url;
  } catch {
    return url;
  }
}
