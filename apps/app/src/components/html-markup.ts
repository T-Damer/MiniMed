const BR_TAG = /<br\s*\/?>/giu;
const BOLD_TAG = /<(?:strong|b)>([\s\S]*?)<\/(?:strong|b)>/giu;
const KNOWN_TAG = /<\/?(?:em|i|strong|b|p|ul|ol|li)(?:\s[^<>]*)?>/giu;
const HTML_ENTITY =
  /&(nbsp|amp|lt|gt|quot|apos|ndash|mdash|hellip|laquo|raquo|deg|middot|bull|times|#\d+|#x[0-9a-f]+);/giu;

const HTML_ENTITY_REPLACEMENTS: Readonly<Record<string, string>> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  deg: '°',
  middot: '·',
  bull: '•',
  times: '×',
};

function decodeKnownHtmlEntities(value: string): string {
  return value.replace(HTML_ENTITY, (match, name: string) => {
    if (name.startsWith('#x')) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    if (name.startsWith('#')) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    return HTML_ENTITY_REPLACEMENTS[name] ?? match;
  });
}

/**
 * Some ingested sources (medication instructions) store raw HTML fragments instead of plain
 * text. Only a small, known tag allowlist is touched so clinical comparisons like "<38°C" are
 * never mistaken for markup.
 */
export function stripKnownHtmlMarkup(value: string): string {
  if (!value.includes('<') && !value.includes('&')) return value;
  const withLineBreaks = value.replace(BR_TAG, '\n');
  const withBold = withLineBreaks.replace(BOLD_TAG, '**$1**');
  const withoutTags = withBold.replace(KNOWN_TAG, '');
  return decodeKnownHtmlEntities(withoutTags);
}

/**
 * Same tag/entity handling as {@link stripKnownHtmlMarkup}, but collapses everything (including
 * line breaks) to a single line of plain text for compact card previews.
 */
export function stripKnownHtmlMarkupInline(value: string): string {
  return stripKnownHtmlMarkup(value)
    .replace(/\s*\n+\s*/gu, ' ')
    .replace(/\s{2,}/gu, ' ')
    .trim();
}
