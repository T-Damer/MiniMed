/**
 * A small, tolerant XML/HTML tokenizer for untrusted feed text (ADR-0024).
 *
 * It produces a plain element tree and never touches the DOM, so parsing works the same in the
 * browser, in a worker and in unit tests, survives the malformed markup real feeds contain, and has
 * no way to execute or load anything. Entity declarations are ignored (never expanded), which makes
 * entity-expansion attacks impossible. Everything is bounded by node count, depth and input size.
 */

export interface MarkupElement {
  readonly kind: 'element';
  /** Lower-case qualified name as written, e.g. `item`, `dc:date`, `content:encoded`. */
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: MarkupNode[];
}

export interface MarkupText {
  readonly kind: 'text';
  readonly text: string;
}

export type MarkupNode = MarkupElement | MarkupText;

export type MarkupMode = 'xml' | 'html';

export interface MarkupLimits {
  readonly maxNodes: number;
  readonly maxDepth: number;
}

export const DEFAULT_MARKUP_LIMITS: MarkupLimits = { maxNodes: 150_000, maxDepth: 64 };

const HTML_VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/** Their content is not text for a reader: it is dropped while parsing HTML. */
const HTML_RAW_TEXT = new Set(['script', 'style']);

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  laquo: '«',
  raquo: '»',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bull: '•',
  middot: '·',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  plusmn: '±',
  times: '×',
  euro: '€',
  sect: '§',
  para: '¶',
  minus: '−',
  larr: '←',
  rarr: '→',
  thinsp: ' ',
  ensp: ' ',
  emsp: ' ',
  shy: '',
};

const ENTITY_PATTERN = /&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{1,9});/giu;

export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(ENTITY_PATTERN, (match, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return '';
      if (code >= 0xd800 && code <= 0xdfff) return '';
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

function isNameChar(char: string): boolean {
  return /[\p{L}\p{N}_:.-]/u.test(char);
}

interface ParsedTag {
  readonly name: string;
  readonly attrs: Record<string, string>;
  readonly selfClosing: boolean;
  /** Index just after the closing `>`. */
  readonly end: number;
}

/** Index of the `>` that closes the tag starting at `from`, honouring quoted attribute values. */
function findTagEnd(source: string, from: number): number {
  let quote = '';
  for (let index = from; index < source.length; index += 1) {
    const char = source[index] as string;
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return index;
    }
  }
  return -1;
}

function parseTag(source: string, start: number): ParsedTag | undefined {
  const close = findTagEnd(source, start + 1);
  if (close < 0) return undefined;
  const body = source.slice(start + 1, close);
  let cursor = 0;
  while (cursor < body.length && isNameChar(body[cursor] as string)) cursor += 1;
  const name = body.slice(0, cursor).toLowerCase();
  if (name === '') return undefined;
  const attrs: Record<string, string> = {};
  const selfClosing = body.trimEnd().endsWith('/');
  while (cursor < body.length) {
    while (cursor < body.length && /[\s/]/u.test(body[cursor] as string)) cursor += 1;
    const nameStart = cursor;
    while (
      cursor < body.length &&
      !/[\s=/>]/u.test(body[cursor] as string) &&
      body[cursor] !== '"' &&
      body[cursor] !== "'"
    ) {
      cursor += 1;
    }
    const attrName = body.slice(nameStart, cursor).toLowerCase();
    if (attrName === '') {
      cursor += 1;
      continue;
    }
    while (cursor < body.length && /\s/u.test(body[cursor] as string)) cursor += 1;
    let value = '';
    if (body[cursor] === '=') {
      cursor += 1;
      while (cursor < body.length && /\s/u.test(body[cursor] as string)) cursor += 1;
      const quote = body[cursor];
      if (quote === '"' || quote === "'") {
        const endQuote = body.indexOf(quote, cursor + 1);
        const stop = endQuote < 0 ? body.length : endQuote;
        value = body.slice(cursor + 1, stop);
        cursor = stop + 1;
      } else {
        const valueStart = cursor;
        while (cursor < body.length && !/\s/u.test(body[cursor] as string)) cursor += 1;
        value = body.slice(valueStart, cursor);
      }
    }
    if (!(attrName in attrs)) attrs[attrName] = decodeEntities(value);
  }
  return { name, attrs, selfClosing, end: close + 1 };
}

/**
 * Parses `source` into a synthetic `#root` element. Unmatched closing tags are ignored, unclosed
 * elements are closed at the end, text is entity-decoded (CDATA is taken literally).
 */
export function parseMarkup(
  source: string,
  mode: MarkupMode,
  limits: MarkupLimits = DEFAULT_MARKUP_LIMITS,
): MarkupElement {
  const root: MarkupElement = { kind: 'element', name: '#root', attrs: {}, children: [] };
  const stack: MarkupElement[] = [root];
  let nodes = 0;
  let index = 0;
  const top = (): MarkupElement => stack[stack.length - 1] as MarkupElement;
  const addText = (text: string): void => {
    if (text === '' || nodes >= limits.maxNodes) return;
    const parent = top();
    const last = parent.children[parent.children.length - 1];
    if (last?.kind === 'text') {
      parent.children[parent.children.length - 1] = { kind: 'text', text: last.text + text };
      return;
    }
    nodes += 1;
    parent.children.push({ kind: 'text', text });
  };

  while (index < source.length && nodes < limits.maxNodes) {
    const lt = source.indexOf('<', index);
    if (lt < 0) {
      addText(decodeEntities(source.slice(index)));
      break;
    }
    if (lt > index) addText(decodeEntities(source.slice(index, lt)));
    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4);
      index = end < 0 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', lt)) {
      const end = source.indexOf(']]>', lt + 9);
      addText(source.slice(lt + 9, end < 0 ? source.length : end));
      index = end < 0 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<?', lt)) {
      const end = source.indexOf('?>', lt + 2);
      index = end < 0 ? source.length : end + 2;
      continue;
    }
    if (source.startsWith('<!', lt)) {
      const end = findTagEnd(source, lt + 2);
      index = end < 0 ? source.length : end + 1;
      continue;
    }
    if (source[lt + 1] === '/') {
      const end = source.indexOf('>', lt + 2);
      const name = source
        .slice(lt + 2, end < 0 ? source.length : end)
        .trim()
        .toLowerCase();
      index = end < 0 ? source.length : end + 1;
      for (let depth = stack.length - 1; depth > 0; depth -= 1) {
        if ((stack[depth] as MarkupElement).name === name) {
          stack.length = depth;
          break;
        }
      }
      continue;
    }
    const tag = parseTag(source, lt);
    if (!tag) {
      addText('<');
      index = lt + 1;
      continue;
    }
    index = tag.end;
    if (stack.length > limits.maxDepth) continue;
    const element: MarkupElement = {
      kind: 'element',
      name: tag.name,
      attrs: tag.attrs,
      children: [],
    };
    nodes += 1;
    top().children.push(element);
    if (mode === 'html') {
      if (HTML_RAW_TEXT.has(tag.name) && !tag.selfClosing) {
        const closer = source.toLowerCase().indexOf(`</${tag.name}`, index);
        const end = closer < 0 ? -1 : source.indexOf('>', closer);
        index = end < 0 ? source.length : end + 1;
        continue;
      }
      if (HTML_VOID.has(tag.name) || tag.selfClosing) continue;
    } else if (tag.selfClosing) {
      continue;
    }
    stack.push(element);
  }
  return root;
}

export function findChild(element: MarkupElement, name: string): MarkupElement | undefined {
  for (const child of element.children) {
    if (child.kind === 'element' && child.name === name) return child;
  }
  return undefined;
}

export function findChildren(element: MarkupElement, name: string): MarkupElement[] {
  return element.children.filter(
    (child): child is MarkupElement => child.kind === 'element' && child.name === name,
  );
}

/** All text below `element`, concatenated as written (no block spacing). */
export function textContent(element: MarkupElement): string {
  let text = '';
  const walk = (node: MarkupNode): void => {
    if (node.kind === 'text') text += node.text;
    else for (const child of node.children) walk(child);
  };
  walk(element);
  return text;
}

/** First element called `name` anywhere below `element`, depth first. */
export function findDescendant(element: MarkupElement, name: string): MarkupElement | undefined {
  for (const child of element.children) {
    if (child.kind !== 'element') continue;
    if (child.name === name) return child;
    const nested = findDescendant(child, name);
    if (nested) return nested;
  }
  return undefined;
}
