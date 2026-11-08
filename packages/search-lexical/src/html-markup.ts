const BR_TAG = /<br\s*\/?>/giu;
const BLOCK_CLOSE_TAG = /<\/(?:div|p|ul|ol|li|details|summary)\s*>/giu;
const BOLD_TAG = /<(?:strong|b)>([\s\S]*?)<\/(?:strong|b)>/giu;
const KNOWN_TAG =
  /<\/?(?:div|span|em|i|u|strong|b|p|ul|ol|li|details|summary|small|font)(?:\s[^<>]*)?>/giu;
/** Superscripts and subscripts: «10<sup>9</sup>/л» reads «10⁹/л», «Ксарелто<sup>®</sup>» «Ксарелто®». */
const SCRIPT_TAG = /<(sup|sub)(?:\s[^<>]*)?>([^<>]{0,40})<\/\1\s*>/giu;
/** A source that escaped its own markup twice («&lt;u&gt;»): the tag shows after one decoding. */
const ESCAPED_KNOWN_TAG =
  /&lt;\/?(?:div|span|em|i|u|strong|b|p|ul|ol|li|details|summary|small|font|sup|sub)(?:\s(?:(?!&gt;)[^<>])*)?&gt;/giu;
const SUPERSCRIPT_CHARS: Readonly<Record<string, string>> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '-': '⁻',
  '−': '⁻',
  '+': '⁺',
  n: 'ⁿ',
};
const SUBSCRIPT_CHARS: Readonly<Record<string, string>> = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉',
  '-': '₋',
  '−': '₋',
  '+': '₊',
};

function scriptText(tag: string, content: string): string {
  const map = tag.toLowerCase() === 'sup' ? SUPERSCRIPT_CHARS : SUBSCRIPT_CHARS;
  const chars = [...content.trim()];
  return chars.length > 0 && chars.every((char) => map[char] !== undefined)
    ? chars.map((char) => map[char]).join('')
    : content;
}
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
    return HTML_ENTITY_REPLACEMENTS[name.toLowerCase()] ?? match;
  });
}

/**
 * Some ingested sources (medication instructions) store raw HTML fragments instead of plain
 * text. Only a small, known tag allowlist is touched so clinical comparisons like "<38°C" are
 * never mistaken for markup.
 */
export function stripKnownHtmlMarkup(value: string): string {
  if (!value.includes('<') && !value.includes('&')) return value;
  const unescaped = value.includes('&lt;')
    ? value.replace(ESCAPED_KNOWN_TAG, (tag) => tag.replace(/^&lt;/u, '<').replace(/&gt;$/u, '>'))
    : value;
  const withLineBreaks = unescaped
    .replace(SCRIPT_TAG, (_match, tag: string, content: string) => scriptText(tag, content))
    .replace(BR_TAG, '\n')
    .replace(BLOCK_CLOSE_TAG, '\n');
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
