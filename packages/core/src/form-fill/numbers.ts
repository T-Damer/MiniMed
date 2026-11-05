/**
 * Numbers as a Russian conversation transcript carries them (FORMFILL1): speech recognition writes
 * them as words («семьдесят два года», «сто пятьдесят на девяносто»), people dictate digits too.
 * Whole numbers up to 999 999 in words, in the nominative and the frequent oblique forms; digits
 * with a decimal comma or point.
 */

const UNITS: Readonly<Record<string, number>> = {
  ноль: 0,
  нуля: 0,
  один: 1,
  одна: 1,
  одно: 1,
  одного: 1,
  одной: 1,
  одному: 1,
  два: 2,
  две: 2,
  двух: 2,
  двум: 2,
  три: 3,
  трех: 3,
  трем: 3,
  четыре: 4,
  четырех: 4,
  пять: 5,
  пяти: 5,
  шесть: 6,
  шести: 6,
  семь: 7,
  семи: 7,
  восемь: 8,
  восьми: 8,
  девять: 9,
  девяти: 9,
};

const TEENS: Readonly<Record<string, number>> = {
  десять: 10,
  десяти: 10,
  одиннадцать: 11,
  одиннадцати: 11,
  двенадцать: 12,
  двенадцати: 12,
  тринадцать: 13,
  тринадцати: 13,
  четырнадцать: 14,
  четырнадцати: 14,
  пятнадцать: 15,
  пятнадцати: 15,
  шестнадцать: 16,
  шестнадцати: 16,
  семнадцать: 17,
  семнадцати: 17,
  восемнадцать: 18,
  восемнадцати: 18,
  девятнадцать: 19,
  девятнадцати: 19,
};

const TENS: Readonly<Record<string, number>> = {
  двадцать: 20,
  двадцати: 20,
  тридцать: 30,
  тридцати: 30,
  сорок: 40,
  сорока: 40,
  пятьдесят: 50,
  пятидесяти: 50,
  шестьдесят: 60,
  шестидесяти: 60,
  семьдесят: 70,
  семидесяти: 70,
  восемьдесят: 80,
  восьмидесяти: 80,
  девяносто: 90,
  девяноста: 90,
};

const HUNDREDS: Readonly<Record<string, number>> = {
  сто: 100,
  ста: 100,
  двести: 200,
  двухсот: 200,
  триста: 300,
  трехсот: 300,
  четыреста: 400,
  четырехсот: 400,
  пятьсот: 500,
  пятисот: 500,
  шестьсот: 600,
  шестисот: 600,
  семьсот: 700,
  семисот: 700,
  восемьсот: 800,
  восьмисот: 800,
  девятьсот: 900,
  девятисот: 900,
};

const THOUSAND = /^тысяч[аиу]?$/u;

export interface SpokenNumber {
  readonly value: number;
  /** UTF-16 span in the text as given. */
  readonly start: number;
  readonly end: number;
}

const TOKEN = /[\p{L}]+|\d+(?:[.,]\d+)?/gu;

function fold(word: string): string {
  return word.toLowerCase().replaceAll('ё', 'е');
}

/** Rank of a number word: 0 units, 1 teens, 2 tens, 3 hundreds; null when it is not one. */
function numberWord(word: string): { readonly value: number; readonly rank: number } | null {
  if (word in UNITS) return { value: UNITS[word] as number, rank: 0 };
  if (word in TEENS) return { value: TEENS[word] as number, rank: 1 };
  if (word in TENS) return { value: TENS[word] as number, rank: 2 };
  if (word in HUNDREDS) return { value: HUNDREDS[word] as number, rank: 3 };
  return null;
}

/** Every number in `text`, left to right. «сто пятьдесят на девяносто» gives 150 and 90. */
export function spokenNumbers(text: string): SpokenNumber[] {
  const found: SpokenNumber[] = [];
  let value = 0;
  let thousands = 0;
  let lastRank = 4;
  let start = -1;
  let end = -1;
  const flush = () => {
    if (start >= 0) found.push({ value: thousands + value, start, end });
    value = 0;
    thousands = 0;
    lastRank = 4;
    start = -1;
  };
  for (const match of text.matchAll(TOKEN)) {
    const token = match[0];
    if (/^\d/u.test(token)) {
      flush();
      found.push({
        value: Number(token.replace(',', '.')),
        start: match.index,
        end: match.index + token.length,
      });
      continue;
    }
    const word = fold(token);
    if (THOUSAND.test(word) && start >= 0 && thousands === 0) {
      thousands = (value || 1) * 1000;
      value = 0;
      lastRank = 4;
      end = match.index + token.length;
      continue;
    }
    if (THOUSAND.test(word) && start < 0) {
      start = match.index;
      thousands = 1000;
      end = match.index + token.length;
      continue;
    }
    const number = numberWord(word);
    if (!number) {
      flush();
      continue;
    }
    // «двадцать пять» grows a number; «пять шесть» or «двадцать тридцать» starts a new one.
    const grows =
      number.rank < lastRank && !(lastRank === 1) && !(number.rank === 1 && lastRank < 3);
    if (start >= 0 && !grows) flush();
    if (start < 0) start = match.index;
    value += number.value;
    lastRank = number.rank;
    end = match.index + token.length;
  }
  flush();
  return found;
}

/** True when `text` says `value`, in digits or in words. */
export function mentionsNumber(text: string, value: number): boolean {
  return spokenNumbers(text).some((number) => Math.abs(number.value - value) < 1e-9);
}

const UNIT_WORDS = [
  '',
  'один',
  'два',
  'три',
  'четыре',
  'пять',
  'шесть',
  'семь',
  'восемь',
  'девять',
];
const TEEN_WORDS = [
  'десять',
  'одиннадцать',
  'двенадцать',
  'тринадцать',
  'четырнадцать',
  'пятнадцать',
  'шестнадцать',
  'семнадцать',
  'восемнадцать',
  'девятнадцать',
];
const TEN_WORDS = [
  '',
  '',
  'двадцать',
  'тридцать',
  'сорок',
  'пятьдесят',
  'шестьдесят',
  'семьдесят',
  'восемьдесят',
  'девяносто',
];
const HUNDRED_WORDS = [
  '',
  'сто',
  'двести',
  'триста',
  'четыреста',
  'пятьсот',
  'шестьсот',
  'семьсот',
  'восемьсот',
  'девятьсот',
];

/** A whole number from 0 to 999 in words, nominative («семьдесят два»); null otherwise. */
export function russianNumberWords(value: number): string | null {
  if (!Number.isInteger(value) || value < 0 || value > 999) return null;
  if (value === 0) return 'ноль';
  const words = [HUNDRED_WORDS[Math.floor(value / 100)] as string];
  const rest = value % 100;
  if (rest >= 10 && rest < 20) words.push(TEEN_WORDS[rest - 10] as string);
  else words.push(TEN_WORDS[Math.floor(rest / 10)] as string, UNIT_WORDS[rest % 10] as string);
  return words.filter(Boolean).join(' ');
}
