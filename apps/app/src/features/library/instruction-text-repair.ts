/**
 * Wrapped lines of official drug instructions.
 *
 * The instruction modules keep every physical PDF/DOC line as its own block, joined by a blank
 * line («…целлюлоза микрокристаллическая\n\n- 14,0 мг, крахмал…»). A line that opens with a dash or a
 * bullet glyph then reads as a list item, a line that ends in «до-» leaves the rest of its word on
 * the next block, and a figure that belongs to the previous line («Флуконазол» / «- 50 мг») stands
 * alone. This module re-joins such wraps deterministically and conservatively. Only the display
 * changes: the stored text, its checksum and its anchors stay as they were (nothing here writes
 * back). It has no DOM, Solid or core imports so that extractors can call it on chunk text too.
 *
 * What is joined (previous block P, next block B):
 *  - hyphenated word break: P ends in «letter-» and B continues with a lowercase letter;
 *  - P is still inside a bracket or quotation («(см. раздел 2 «Особые указания»);
 *  - P ends in a word that cannot end a line ('и', 'в', 'для', 'примерно', …) or in a spaced dash;
 *  - B is a dash line after a frequency word inside running text («…; очень редко» / «– мигрень»);
 *  - B is a dash line that only carries an amount («- 14,0 мг, …») and P is not a list item or a
 *    finished sentence (composition rows: «Флуконазол» / «- 50 мг»);
 *  - B starts with a lowercase letter and P is neither finished nor a one-word heading.
 *
 * What is never joined: after P that ends a sentence, a colon or a semicolon; a frequency heading
 * («Часто»); tables, images, headings; B that opens with a capital letter or a number-led item
 * after a plain line unless one of the rules above applies; consecutive list items.
 */

/** The blank line(s) that separate stored blocks; identical to the display parser's separator. */
export const SOURCE_BLOCK_SEPARATOR = /\r?\n(?:\s*\r?\n)+/u;

/**
 * Markers the display path puts where two stored blocks became one. They keep the block count, so
 * the PDF geometry of the later blocks (`metadata.sourceSpans`) still lines up with the text. The
 * display parser removes them; text meant for anything else comes from
 * {@link repairWrappedInstructionText}, which never contains them.
 */
export const WRAP_JOIN_SPACE = '';
export const WRAP_JOIN_GLUE = '';

const BULLET_GLYPHS = '•▪◦●○';
const BULLET_PATTERN = /^([•▪◦●○*+\-–—])\s+(\S[\s\S]*)$/u;
const SENTENCE_END = /[.!?;:…]$/u;

/** Words after which a line cannot have ended on purpose. */
const DANGLING_WORDS: ReadonlySet<string> = new Set([
  'и',
  'или',
  'а',
  'но',
  'в',
  'во',
  'на',
  'с',
  'со',
  'по',
  'к',
  'ко',
  'от',
  'до',
  'из',
  'для',
  'при',
  'без',
  'об',
  'о',
  'у',
  'не',
  'за',
  'над',
  'под',
  'между',
  'через',
  'как',
  'что',
  'чтобы',
  'если',
  'также',
  'либо',
  'около',
  'примерно',
  'приблизительно',
  'более',
  'менее',
  'свыше',
  'после',
  'перед',
]);

/** A frequency heading of an adverse-reaction list: the lines under it are entries, not wraps. */
const FREQUENCY_HEADING =
  /^(?:очень\s+часто|часто|нечасто|редко|очень\s+редко|частота\s+неизвестна|неуточненной\s+частоты)$/iu;

/** The end of a line that carries a frequency inside an adverse-reaction sentence. */
const RUNNING_FREQUENCY_TAIL =
  /[;,:]\s*(?:очень\s+часто|часто|нечасто|редко|очень\s+редко|частота\s+неизвестна)$/iu;

const UNITS =
  '(?:мкг|мг|кг|г|мкл|мл|л|мкмоль|ммоль|моль|мэкв|мэкв\\.|ЕД|МЕ|IU|Ед|ккал|кДж|%|мм|см|нг|пг|ppm|КОЕ)';
/** «14,0 мг, …», «0,750 г», «2,6 мг.», «50 мг» — an amount that closes a composition row. */
const AMOUNT_START = new RegExp(
  `^[<>≥≤]?\\s*\\d[\\d\\s.,/–-]*\\s*${UNITS}(?:/[\\p{L}]+)?(?=\\s*(?:[,;.)\\]]|$|\\s[-–—]\\s|\\s\\())`,
  'u',
);

/** A line that goes on mid-sentence: lowercase, or a bracketed aside. */
const CONTINUATION_START = /^[\p{Ll}(]/u;

/** Fragments before a line-end hyphen that are a compound's first half, not a syllable. */
const COMPOUND_FRAGMENTS: ReadonlySet<string> = new Set([
  'бета',
  'альфа',
  'гамма',
  'дельта',
  'вич',
  'днк',
  'листок',
  'листка',
  'листком',
  'листке',
  'шприц',
  'ренин',
  'ангиотензин',
  'рефлюкс',
  'плацебо',
  'дистресс',
  'глюкозо',
  'водно',
  'темно',
  'светло',
  'генно',
  'экг',
  'рнк',
  'двс',
  'коа',
  'хром',
  'тест',
  'тюбик',
  'катетер',
  'антибиотик',
  'государства',
  'концентрация',
  'пробкой',
  'пробками',
  'листками',
  'листков',
  'какой',
  'какого',
  'какие',
  'каких',
  'кто',
  'что',
  'как',
]);
const COMPOUND_NEXT_WORDS: ReadonlySet<string> = new Set(['либо', 'то', 'нибудь', 'libo']);

interface BlockEntry {
  /** The text shown for this (possibly joined) block, with join markers. */
  text: string;
}

/**
 * A line-end hyphen is a syllable hyphen of the typesetting (dropped when the word is rejoined)
 * unless the fragment is the first half of a compound («желудочно-», «бета-», «N-»). The data
 * decides for the common ones; an unknown fragment is treated as a syllable (about 70 % of the
 * breaks in the modules).
 */
function keepsHyphen(fragment: string, nextWord: string): boolean {
  const lower = fragment.toLocaleLowerCase('ru-RU');
  if (lower.length <= 1) return true;
  if (/[a-z]$/iu.test(fragment)) return true;
  if (COMPOUND_FRAGMENTS.has(lower) || COMPOUND_NEXT_WORDS.has(nextWord)) return true;
  // Combining forms of adjectives: «желудочно», «причинно», «коричневато», «светло», «клинико».
  return lower.length >= 6 && /(?:нно|чно|тно|льно|ато|ико|ло|ско|вно|зно)$/u.test(lower);
}

function unclosedOpeners(text: string): boolean {
  const count = (char: string): number => text.split(char).length - 1;
  return count('(') > count(')') || count('«') > count('»');
}

function lastWord(text: string): string {
  return /([\p{L}]+)$/u.exec(text)?.[1] ?? '';
}

function endsDangling(text: string): boolean {
  const word = lastWord(text);
  if (word === '') return false;
  // A single capital letter is a label («витамин А»), not the preposition «а».
  if (word.length === 1 && word !== word.toLocaleLowerCase('ru-RU')) return false;
  return DANGLING_WORDS.has(word.toLocaleLowerCase('ru-RU'));
}

function isStructural(block: string): boolean {
  return (
    block.includes('|') ||
    block.includes('```') ||
    block.startsWith('![') ||
    block.startsWith('[Источник изображения]') ||
    /^#{1,6}\s/u.test(block)
  );
}

/** How B is attached to P: with a space, glued to the broken word, or not at all. */
type Join =
  | { readonly kind: 'space'; readonly text: string }
  | { readonly kind: 'glue'; readonly text: string; readonly dropHyphen: boolean };

function withoutBulletGlyph(block: string): string {
  const match = BULLET_PATTERN.exec(block);
  if (match?.[1] && BULLET_GLYPHS.includes(match[1]) && match[2]) return match[2];
  return block;
}

function decideJoin(previous: string, block: string): Join | null {
  if (previous === '' || block === '') return null;
  if (isStructural(previous) || isStructural(block)) return null;
  if (FREQUENCY_HEADING.test(previous)) return null;

  const marker = BULLET_PATTERN.exec(block);
  const isDashItem = marker?.[1] === '-' || marker?.[1] === '–' || marker?.[1] === '—';
  const body = marker?.[2] ?? block;

  // 1. A hyphenated word break: «натрия до-» / «децилсульфат».
  const broken = /([\p{L}]+)-$/u.exec(previous);
  if (broken?.[1] && /^\p{Ll}/u.test(body)) {
    const nextWord = /^[\p{L}]+/u.exec(body)?.[0] ?? '';
    return { kind: 'glue', text: body, dropHyphen: !keepsHyphen(broken[1], nextWord) };
  }

  // The remaining rules join a finished sentence, a colon or a semicolon to nothing.
  const finished = SENTENCE_END.test(previous);

  // 2. P is still inside a bracket or quotation.
  if (!finished && unclosedOpeners(previous)) {
    return { kind: 'space', text: withoutBulletGlyph(block) };
  }

  // 3. A spaced dash at the end of P («… (натрия додецилсульфат) -» / «1,950 мг»).
  if (/\s[-–—]$/u.test(previous) && !marker) {
    return { kind: 'space', text: block };
  }

  if (finished || previous.endsWith(',')) {
    // After a comma only a dangling-free plain lowercase wrap is safe, and only without a marker.
    if (finished || marker || !CONTINUATION_START.test(block)) return null;
    return decidePlain(previous, block);
  }

  // 4. P ends in a word that cannot end a line (a capitalised plain B is a table cell or heading).
  if (endsDangling(previous) && (marker || !/^\p{Lu}/u.test(block))) {
    return { kind: 'space', text: withoutBulletGlyph(block) };
  }

  // 5. A composition row: «Флуконазол» / «- 50 мг».
  if (isDashItem && AMOUNT_START.test(body) && !BULLET_PATTERN.test(previous)) {
    return { kind: 'space', text: block };
  }

  // 5b. A frequency inside running text: «…; очень редко» / «– мигрень, …».
  if (isDashItem && RUNNING_FREQUENCY_TAIL.test(previous)) {
    return { kind: 'space', text: block };
  }

  // 6. A plain lowercase wrap.
  if (!marker && CONTINUATION_START.test(block)) return decidePlain(previous, block);
  return null;
}

function decidePlain(previous: string, block: string): Join | null {
  const isListItem = BULLET_PATTERN.test(previous);
  // A one-word capitalised line («Часто», «Дети», «Взрослые») is a heading of what follows.
  if (!isListItem && /^\p{Lu}[\p{L}]*$/u.test(previous) && !endsDangling(previous)) return null;
  return { kind: 'space', text: block };
}

/**
 * The stored text with wrapped lines joined, join places marked with {@link WRAP_JOIN_SPACE} and
 * {@link WRAP_JOIN_GLUE} so that the number of stored blocks is still countable. Returns the text
 * itself when nothing is wrapped.
 */
export function markWrappedInstructionText(text: string): string {
  if (!text.includes('\n')) return text;
  const stored = text.split(SOURCE_BLOCK_SEPARATOR);
  if (stored.length < 2) return text;
  const entries: BlockEntry[] = [];
  let changed = false;
  for (const [index, raw] of stored.entries()) {
    const block = raw.trim();
    const last = entries.at(-1);
    if (last && index > 0) {
      const join = decideJoin(last.text, block);
      if (join) {
        changed = true;
        last.text = joinMarked(last.text, join);
        continue;
      }
    }
    entries.push({ text: block });
  }
  return changed ? entries.map((entry) => entry.text).join('\n\n') : text;
}

function joinMarked(previous: string, join: Join): string {
  if (join.kind === 'space') return `${previous}${WRAP_JOIN_SPACE}${join.text}`;
  const head = join.dropHyphen ? previous.slice(0, -1) : previous;
  return `${head}${WRAP_JOIN_GLUE}${join.text}`;
}

/** Removes the join markers: a space where the line broke, nothing inside a rejoined word. */
export function resolveWrapMarks(text: string): string {
  return text.replaceAll(WRAP_JOIN_SPACE, ' ').replaceAll(WRAP_JOIN_GLUE, '');
}

/** Number of stored blocks a marked text stands for (blank-line separated blocks plus joins). */
export function storedBlockCount(text: string): number {
  let marks = 0;
  for (const char of text) if (char === WRAP_JOIN_SPACE || char === WRAP_JOIN_GLUE) marks += 1;
  return text.split(SOURCE_BLOCK_SEPARATOR).length + marks;
}

/**
 * An instruction chunk's text with the wrapped lines joined into paragraphs: plain text, real
 * paragraph breaks («\n\n») only between blocks that were not joined. It reads the text alone (no
 * PDF geometry), so the reader's display and its in-document find agree.
 */
export function repairWrappedInstructionText(text: string): string {
  return resolveWrapMarks(markWrappedInstructionText(text));
}
