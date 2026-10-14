const NO_BREAK_SPACE = ' ';

/**
 * Units that follow a number and must stay on its line: «250 мг», «8,5 МБ», «6 мес.», «20 кг».
 * Matched as whole words after a digit, so «2 мг/мл» keeps «2 мг» together and «3 класс» is left
 * alone.
 */
const UNITS = [
  'мг',
  'мкг',
  'г',
  'кг',
  'мл',
  'л',
  'мм',
  'см',
  'м',
  'мкмоль',
  'ммоль',
  'моль',
  'ЕД',
  'МЕ',
  'мин',
  'ч',
  'с',
  'сут',
  'дн',
  'нед',
  'мес',
  'лет',
  'год',
  'года',
  'дней',
  'дня',
  'день',
  'КБ',
  'МБ',
  'ГБ',
  'уд',
] as const;

const NUMBER_UNIT = new RegExp(`(\\d(?:[.,]\\d+)?) (${UNITS.join('|')})(?![\\p{L}\\p{N}])`, 'gu');
const NUMBER_SIGN = /(\d) ([%‰°])/gu;
const NUMERO = /№ (?=\d)/gu;

/**
 * The same text with no-break spaces where a line must not end: between a number and its unit,
 * before «%», «‰» and «°», and after «№». A text without such places comes back unchanged.
 */
export function bindNumberUnits(text: string): string {
  return text
    .replace(NUMBER_UNIT, `$1${NO_BREAK_SPACE}$2`)
    .replace(NUMBER_SIGN, `$1${NO_BREAK_SPACE}$2`)
    .replace(NUMERO, `№${NO_BREAK_SPACE}`);
}

/** «250 мг»: a value and its unit joined by a no-break space. */
export function joinNumberUnit(value: string | number, unit: string): string {
  return `${String(value)}${NO_BREAK_SPACE}${unit}`;
}
