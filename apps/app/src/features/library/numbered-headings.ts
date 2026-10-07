/**
 * Numbered sub-headings of clinical recommendations that the source kept as plain paragraphs
 * («1.2.2.1 Заголовок», «3.4.1. Лечение …»). The Minzdrav JSON only separates the top-level sections
 * and the PDF extraction recognises headings by font size, so deeper numbered headings arrive as
 * body text. This is a deterministic reading rule applied at display time; stored text, chunk and
 * section identifiers are untouched.
 */

export interface NumberedHeading {
  /** «1.2.2.1» — the number as printed, without the trailing dot. */
  readonly number: string;
  /** The heading text after the number. */
  readonly title: string;
  /** Number of components in the number: «1.2.2.1» is 4. */
  readonly depth: number;
}

/** Longest line still read as a heading; one clinical recommendation heading runs to ~170. */
export const NUMBERED_HEADING_MAX_LENGTH = 220;
export const NUMBERED_HEADING_MAX_WORDS = 40;
/** A heading ending in a full stop is a title only while it is short; longer ones are sentences. */
const SENTENCE_WORD_LIMIT = 14;
const QUESTION_MAX_LENGTH = 160;

// 1–2 digit components without a leading zero («022.1» is a mis-read ICD code, «0.5» a dose).
const NUMBER = String.raw`(?:[1-9]\d?)(?:\.[1-9]\d?){1,5}`;
const HEADING_PATTERN = new RegExp(String.raw`^(${NUMBER})\.?[ \t]+(\S.*)$`, 'u');
const STARTS_AS_TITLE = /^[\p{Lu}«"([]/u;
const STARTS_AS_QUOTED_TITLE = /^[«"([]+\p{Lu}/u;
const UNIT_START = /^(?:Мг|Мл|Кг|Гр|МЕ|ЕД|Л|Г)(?![\p{L}\d])/u;
/** Two sentences in one line: a body paragraph that merely begins with its number. */
const SENTENCE_BREAK = /[.!?…][)"»]?(?:\s+|(?=\p{Lu}))\p{Lu}/u;
/** Finite phrasing of a recommendation or an instruction, never of a title. */
const STATEMENT_VERB =
  /(?:^|\s)(?:рекомендуется|рекомендовано|рекомендуются|следует|необходимо|необходимы|должен|должна|должны|допускается|может|могут|проводится|проводят|назначается|назначают|применяется|выполняется)(?:\s|[,.;:]|$)/u;
const STATEMENT_START =
  /^(?:Рекомендуется|Рекомендовано|Рекомендуются|Следует|Необходимо|Должен|Должна|Должны|Пациент|Пациентам|Пациентов|Больным|Больных)(?:\s|$)/u;
/** Reflexive / third-person present verbs: «увеличивается», «назначаются». */
const PRESENT_VERB =
  /\p{L}{3,}(?:ется|ются|ится|ятся|атся|ается|ются|уется|уются|ивается|ываются)(?![\p{L}])/u;
/** An infinitive in a clause («…, начать непрерывную инфузию») or opening the line. */
const INFINITIVE_AFTER_COMMA = /,\s+\p{Ll}{3,}(?:ать|ять|еть|ить|ыть|уть|оть)(?![\p{L}])/u;
const INFINITIVE_FIRST_WORD = /^\p{Lu}\p{Ll}{3,}(?:ать|ять|еть|ить|ыть|уть|оть)(?![\p{L}])/u;
/** «Для оценки …», «При госпитализации …», «Если …»: a clause once it runs on. */
const CLAUSE_START = /^(?:Для|При|После|Если|Когда|В случае|Во время|До)\s/u;
const CLAUSE_WORD_LIMIT = 8;
const DOT_LEADERS = /_{4,}|\.{4,}|…{2,}|(?:\.\s){4,}/u;
/** A trailing bracketed reference list or page number marks a table-of-contents line. */
const TRAILING_PAGE = /\s\d{1,3}$/u;

function wordCount(text: string): number {
  return text.split(/\s+/u).filter(Boolean).length;
}

/**
 * Whether `paragraph` is a numbered sub-heading. Guards, in order: at least two number components
 * (a single «1.» is a list item), no leading zeros or dose-like numbers, a capital letter after
 * the number, no list item (ends in «;» or «,»), no table-of-contents leaders, no second sentence,
 * no recommendation phrasing, and a bounded length.
 */
export function parseNumberedHeading(paragraph: string): NumberedHeading | null {
  const line = paragraph.trim();
  if (line.length === 0 || line.length > NUMBERED_HEADING_MAX_LENGTH + 24 || line.includes('\n')) {
    return null;
  }
  const match = HEADING_PATTERN.exec(line);
  const number = match?.[1];
  const rest = match?.[2]?.trim();
  if (!number || !rest) return null;
  if (!STARTS_AS_TITLE.test(rest)) return null;
  if (rest.startsWith('(') || rest.startsWith('[')) {
    if (!STARTS_AS_QUOTED_TITLE.test(rest)) return null;
  }
  if (UNIT_START.test(rest)) return null;
  if (rest.length > NUMBERED_HEADING_MAX_LENGTH) return null;
  if (/[;,]$/u.test(rest)) return null;
  if (DOT_LEADERS.test(rest) || TRAILING_PAGE.test(rest)) return null;
  const words = wordCount(rest);
  if (words > NUMBERED_HEADING_MAX_WORDS) return null;
  // «3.10 Как болезнь может повлиять на половую жизнь?»: questions of a patient section are titles.
  const question = rest.endsWith('?');
  if (!question) {
    if (SENTENCE_BREAK.test(rest)) return null;
    if (STATEMENT_START.test(rest) || STATEMENT_VERB.test(rest)) return null;
    if (PRESENT_VERB.test(rest) || INFINITIVE_AFTER_COMMA.test(rest)) return null;
    if (INFINITIVE_FIRST_WORD.test(rest)) return null;
    if (CLAUSE_START.test(rest) && words > CLAUSE_WORD_LIMIT) return null;
    if (/\.$/u.test(rest) && words > SENTENCE_WORD_LIMIT) return null;
  } else if (rest.length > QUESTION_MAX_LENGTH) {
    return null;
  }
  return {
    number,
    title: rest.replace(/\.$/u, '').trim(),
    depth: Math.min(6, number.split('.').length),
  };
}
