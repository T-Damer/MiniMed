/**
 * Display repairs of stored source text that the formatting audit (FMT-AUDIT, 2026-11-08) found in
 * every family of documents. They change what the reader shows (and what in-document find
 * searches), never the stored text. Every repair here keeps the text length except the symbol-font
 * and superscript ones, which the reader treats like any other presented text.
 */

/** Cyrillic letters that look like Latin capitals, and back. */
const CYRILLIC_TO_LATIN: Readonly<Record<string, string>> = {
  А: 'A',
  В: 'B',
  С: 'C',
  Е: 'E',
  Н: 'H',
  К: 'K',
  М: 'M',
  О: 'O',
  Р: 'P',
  Т: 'T',
  Х: 'X',
  У: 'Y',
  а: 'a',
  с: 'c',
  е: 'e',
  о: 'o',
  р: 'p',
  х: 'x',
  у: 'y',
};
const LATIN_TO_CYRILLIC: Readonly<Record<string, string>> = {
  A: 'А',
  B: 'В',
  C: 'С',
  E: 'Е',
  H: 'Н',
  K: 'К',
  M: 'М',
  O: 'О',
  P: 'Р',
  T: 'Т',
  X: 'Х',
  Y: 'У',
  a: 'а',
  c: 'с',
  e: 'е',
  o: 'о',
  p: 'р',
  x: 'х',
  y: 'у',
  k: 'к',
};

const CYRILLIC = /[А-Яа-яЁё]/u;
const LATIN = /[A-Za-z]/u;

function toLatin(value: string): string {
  let result = '';
  for (const char of value) result += CYRILLIC_TO_LATIN[char] ?? char;
  return result;
}

/**
 * Codes typed with Cyrillic look-alike letters: МКБ-10 «К21.0», АТХ «С09АА01», services
 * «А16.10.003», «СYP3А4». They look right but are not found by search, copy or the code links, so
 * the reader shows them in Latin. Only a token that holds a Cyrillic letter changes.
 */
/** Letters and digits as a plain class: `\p{L}` in a lookaround compiles into a far larger matcher. */
const WORD_CHARS = 'A-Za-zА-Яа-яЁё0-9';
const CODE_PATTERN = new RegExp(
  [
    // Cytochromes: «СYP2D6», «CYPЗA4» (the digit 3 typed as the letter З), «Р450».
    '[CС][YУ][PР][\\dЗ][A-ZАВСЕНКМОРТХ]\\d{1,2}',
    'Р450',
    // Medical services: «А16.10.003», «В01.001.001».
    '[АВ]\\d{2}\\.\\d{2,3}\\.\\d{3}(?:\\.\\d{3})?',
    // АТХ, levels 3–5: «Н02АВ», «С09АА01».
    '[ABCDGHJLMNPRSVАВСНМР]\\d{2}[A-ZАВСЕНКМОРТХ]{1,2}(?:\\d{2})?',
    // МКБ-10: «Е75.2», «К71», «Р29.2».
    '[A-ZАВСЕНКМОРТХ]\\d{2}(?:\\.\\d{1,2})?',
  ]
    .map((alternative) => `(?<![${WORD_CHARS}])(?:${alternative})(?![${WORD_CHARS}])`)
    .join('|'),
  'gu',
);
/**
 * Every code the pattern changes holds a Cyrillic look-alike next to a digit («К21», «С09АА01»,
 * «А16.10») or is a cytochrome: most chunks skip it.
 */
const CODE_HINT = /[АВСЕНКМОРТХ]\d|\d[АВСЕНКМОРТХ]|[CС][YУ][PР]|Р450/u;

function latinCodes(text: string): string {
  if (!CODE_HINT.test(text)) return text;
  return text.replace(CODE_PATTERN, (code) =>
    CYRILLIC.test(code) ? toLatin(code).replace('З', '3') : code,
  );
}

const LATIN_LOOKALIKES = new Set(Object.keys(LATIN_TO_CYRILLIC));
const CYRILLIC_LOOKALIKES = new Set(Object.keys(CYRILLIC_TO_LATIN));

/**
 * A word typed in two alphabets: «активноcти» (Latin c), «СDS» (Cyrillic С). The letters of the
 * minority alphabet become the majority's when every one of them has a look-alike there.
 */
function singleScriptWords(text: string): string {
  if (!/[A-Za-z][А-Яа-яЁё]|[А-Яа-яЁё][A-Za-z]/u.test(text)) return text;
  return text.replace(/[A-Za-zА-Яа-яЁё]+/gu, (word) => {
    if (!CYRILLIC.test(word) || !LATIN.test(word)) return word;
    const letters = [...word];
    const cyrillic = letters.filter((char) => CYRILLIC.test(char));
    const latin = letters.filter((char) => LATIN.test(char));
    if (cyrillic.length >= latin.length && latin.every((char) => LATIN_LOOKALIKES.has(char))) {
      return letters.map((char) => LATIN_TO_CYRILLIC[char] ?? char).join('');
    }
    if (latin.length > cyrillic.length && cyrillic.every((char) => CYRILLIC_LOOKALIKES.has(char))) {
      return letters.map((char) => CYRILLIC_TO_LATIN[char] ?? char).join('');
    }
    return word;
  });
}

/** A Latin one-letter preposition between Russian words: «c целью», «(c использованием». */
function cyrillicPrepositions(text: string): string {
  if (!/(?:^|[\s(«"])[acoyk]\s/u.test(text)) return text;
  return text.replace(
    /(?<=(?:^|[\s(«"]))[acoyk](?=\s+[а-яё])/gu,
    (letter) => LATIN_TO_CYRILLIC[letter] ?? letter,
  );
}

/**
 * Characters of the Symbol and Wingdings fonts that a Word/PDF export left in the Private Use Area
 * (U+F0xx): U+F061 is α, U+F0B1 is ±, U+F0B7 is a bullet. Unknown ones stay as they are. Written as
 * code points: the formatter turns escapes into invisible characters.
 */
const SYMBOL_FONT = new Map<string, string>(
  (
    [
      [0xf020, ' '],
      [0xf02d, '−'],
      [0xf061, 'α'],
      [0xf062, 'β'],
      [0xf064, 'δ'],
      [0xf067, 'γ'],
      [0xf06d, 'μ'],
      [0xf0a7, '▪'],
      [0xf0ae, '→'],
      [0xf0b0, '°'],
      [0xf0b1, '±'],
      [0xf0b3, '≥'],
      [0xf0b4, '×'],
      [0xf0b7, '•'],
      [0xf0d2, '®'],
      [0xf0fc, '✓'],
      // A stress mark the export put in the PUA: «бо(U+E088)льшую».
      [0xe088, ''],
    ] as const
  ).map(([code, value]) => [String.fromCharCode(code), value]),
);
const PRIVATE_USE = /[\uE000-\uF8FF]/u;
const PRIVATE_USE_ALL = new RegExp(PRIVATE_USE.source, 'gu');
const BULLET_BETWEEN_LETTERS = /(?<=\p{L})\uF0B7(?=\p{L})/gu;
/** Symbol's «≤» before a number; elsewhere (questionnaires) the answer box. */
const LESS_OR_EQUAL = /\uF0A3(?=\s*\d)/gu;
const ANSWER_BOX = /\uF0A3/gu;

function symbolFontCharacters(text: string): string {
  if (!PRIVATE_USE.test(text)) return text;
  return text
    .replace(BULLET_BETWEEN_LETTERS, '·')
    .replace(LESS_OR_EQUAL, '≤')
    .replace(ANSWER_BOX, '□')
    .replace(PRIVATE_USE_ALL, (char) => SYMBOL_FONT.get(char) ?? char);
}

const SUPERSCRIPT: Readonly<Record<string, string>> = {
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
};

/** «Вт/см^(2)», «10^9» in the definitions' plain text: drawn as «Вт/см²», «10⁹». */
function caretSuperscripts(text: string): string {
  if (!text.includes('^')) return text;
  const lift = (value: string) => [...value].map((char) => SUPERSCRIPT[char] ?? char).join('');
  return text
    .replace(/\^\(([-−+]?\d{1,3})\)/gu, (_match, value: string) => lift(value))
    .replace(/(?<=[A-Za-zА-Яа-яЁё0-9)])\^([-−]?\d{1,2})(?!\d)/gu, (_match, value: string) =>
      lift(value),
    );
}

/**
 * Markup a converter left in running text: a backslash before a Russian word («\\дифференциально»)
 * and single-asterisk italics («*Построение зрительного образа*.»). A footnote star attached to a
 * word («Ксарелто*») or standing free («* — состав смеси») is not italics and stays.
 */
function strayMarkup(text: string): string {
  let result = text.includes('\\') ? text.replace(/\\(?=[А-Яа-яЁё])/gu, '') : text;
  if (result.includes('*')) {
    result = result.replace(
      /(?<![A-Za-zА-Яа-яЁё0-9*])\*(?=[A-Za-zА-Яа-яЁё«(])([^*\n]{1,160}?[A-Za-zА-Яа-яЁё.»)!?])\*(?![A-Za-zА-Яа-яЁё0-9*])/gu,
      '$1',
    );
  }
  return result;
}

/** Words after a suspended hyphen: «двух- или трёхкратно», «пре- и постнатальный». */
const SUSPENDED_HYPHEN_NEXT = new Set(['и', 'или', 'либо', 'а', 'ни', 'но']);
const INDEFINITE_PRONOUN =
  /^(?:что|кто|где|когда|как|как\p{L}*|куда|чей|чь\p{L}*|сколько|почему|зачем|откуда|чем|чего|кого|кому)$/u;
/** The tail of a word a line break cut: «включен- ная», «различ- ных», «мочеиспуска- ния». */
const WORD_TAIL =
  /^(?:н?ая|н?ый|н?ое|н?ые|н?ых|н?ым|н?ой|ния|ние|ний|нию|вого|вой|ого|его|ому|ему|ых|их|ий|ом|ем|ть|ся|ции|ция|сти|ки|ка|ку|ке|ны|на|но|ть)$/u;

/**
 * A hyphen the source followed by a stray space: «сердечно- сосудистой», «листок- вкладыш» read
 * «сердечно-сосудистой», «листок-вкладыш»; a word a line break cut («различ- ных») is one word
 * again. A suspended hyphen («двух- или трёхкратно») stays.
 */
export function spacedHyphens(text: string): string {
  if (!text.includes('- ')) return text;
  return text.replace(
    /(?<![A-Za-zА-Яа-яЁё0-9-])([А-Яа-яЁё]{2,})- ([а-яё]+)/gu,
    (match, before: string, after: string) => {
      if (SUSPENDED_HYPHEN_NEXT.has(after)) {
        return after === 'либо' && INDEFINITE_PRONOUN.test(before.toLocaleLowerCase('ru-RU'))
          ? `${before}-${after}`
          : match;
      }
      return WORD_TAIL.test(after) ? `${before}${after}` : `${before}-${after}`;
    },
  );
}

export function normalizeReaderText(text: string): string {
  let result = strayMarkup(text);
  result = spacedHyphens(result);
  result = latinCodes(result);
  result = singleScriptWords(result);
  result = cyrillicPrepositions(result);
  result = symbolFontCharacters(result);
  return caretSuperscripts(result);
}

function titleKey(value: string): string {
  return value
    .replace(/^#{1,6}\s+/u, '')
    .replaceAll('*', '')
    .replace(/^\d+(?:\.\d+)*\.?\s+/u, '')
    .replace(/[\s:.]+$/u, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е');
}

/**
 * A chunk whose first line only repeats its section's heading («Состав» under «Состав»): the line
 * goes (it would be drawn as a second heading). Its line break stays, so the stored blocks after it
 * keep their places for the PDF geometry.
 */
export function withoutSectionTitleEcho(text: string, sectionTitle: string): string {
  const firstLine = /^\s*([^\n]*)/u.exec(text)?.[1] ?? '';
  // Most chunks open with a line longer than any heading: no echo, no heading key to build.
  if (firstLine.length > sectionTitle.length + 12) return text;
  const key = titleKey(sectionTitle);
  if (key === '') return text;
  // The heading may repeat more than once («Режим дозирования» / «Режим дозирования»).
  let start = 0;
  let removed = false;
  while (start < text.length) {
    const end = text.indexOf('\n', start);
    const line = end === -1 ? text.slice(start) : text.slice(start, end);
    if (line.trim() !== '') {
      if (line.length > sectionTitle.length + 12 || titleKey(line) !== key) break;
      removed = true;
    }
    if (end === -1) return '';
    start = end + 1;
  }
  if (!removed) return text;
  // Every line break stays, so the blocks after the heading keep their places.
  return text.slice(0, start).replace(/[^\n]+/gu, '') + text.slice(start);
}

/** The chunk holds nothing but its section's heading. */
export function isSectionTitleEcho(text: string, sectionTitle: string): boolean {
  return withoutSectionTitleEcho(text.trim(), sectionTitle).trim() === '';
}

/** Two lines the reader joins into one paragraph or list item; a word the wrap cut is mended. */
export function joinWrappedLines(previous: string, next: string): string {
  const joined = `${previous} ${next}`;
  return /[А-Яа-яЁё]-$/u.test(previous) ? spacedHyphens(joined) : joined;
}
