/**
 * The addresses met in running text. A Markdown link `[текст](https://…)` is one segment that shows
 * its own text and opens its address; a bare address is one segment too. Before this the pattern
 * took only the address, so `[психическое расстройство](https://www.krasotaimedicina.ru/…)` was
 * drawn as `[психическое расстройство](krasotaimedicina.ru)` (brackets kept, address shortened).
 */
const EXTERNAL_URL_PATTERN =
  /\[([^\]\n]{1,300})\]\((https?:\/\/[^\s<>"')\]]+)\)|https?:\/\/[^\s<>"')\]]+/gu;

export type PlainTextSegment =
  | { readonly kind: 'text'; readonly value: string }
  /**
   * `value` is the text as written (its length keeps later offsets right); `href` is the address;
   * `label` is the link text of a Markdown link (a bare address has none).
   */
  | {
      readonly kind: 'url';
      readonly value: string;
      readonly href: string;
      readonly label?: string;
    };

export function segmentTextWithExternalUrls(text: string): readonly PlainTextSegment[] {
  const segments: PlainTextSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(EXTERNAL_URL_PATTERN)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      segments.push({ kind: 'text', value: text.slice(lastIndex, start) });
    }
    const label = match[1]?.trim();
    segments.push({
      kind: 'url',
      value: match[0],
      href: match[2] ?? match[0],
      ...(label ? { label } : {}),
    });
    lastIndex = start + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ kind: 'text', value: text.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ kind: 'text', value: text }];
}
