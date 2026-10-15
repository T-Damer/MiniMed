/**
 * A unit that is a counted noun («баллов», «дней», «лет») agrees with the number written before it:
 * «1 балл», «2 балла», «5 баллов», «1,5 балла». The tool schema declares such a unit in any of its
 * forms; the form that fits the shown number is chosen here, for every screen, print sheet and shared
 * text alike. Abbreviations («нед», «мес», «шт.») and measurement units («мг/дл») never change. This
 * code never looks at a tool id.
 */

/** one / few (also the form after a fraction) / many. */
type NounForms = readonly [one: string, few: string, many: string];

const NOUN_FORMS: readonly NounForms[] = [
  ['балл', 'балла', 'баллов'],
  ['пункт', 'пункта', 'пунктов'],
  ['день', 'дня', 'дней'],
  ['календарный день', 'календарных дня', 'календарных дней'],
  ['неделя', 'недели', 'недель'],
  ['месяц', 'месяца', 'месяцев'],
  ['год', 'года', 'лет'],
  ['критерий', 'критерия', 'критериев'],
  ['признак', 'признака', 'признаков'],
  ['сегмент', 'сегмента', 'сегментов'],
  ['единица', 'единицы', 'единиц'],
  ['капля', 'капли', 'капель'],
  ['раз', 'раза', 'раз'],
];

/** The plural nominative a schema often declares a counted unit as («баллы», «дни», «недели»). */
const PLURAL_NOMINATIVE: Readonly<Record<string, string>> = {
  балл: 'баллы',
  пункт: 'пункты',
  день: 'дни',
  'календарный день': 'календарные дни',
  неделя: 'недели',
  месяц: 'месяцы',
  год: 'годы',
  критерий: 'критерии',
  признак: 'признаки',
  сегмент: 'сегменты',
  единица: 'единицы',
  капля: 'капли',
};

/** Every written form of a counted noun → its three forms. */
const FORMS_BY_WRITTEN_FORM: ReadonlyMap<string, NounForms> = (() => {
  const index = new Map<string, NounForms>();
  for (const forms of NOUN_FORMS) {
    for (const form of forms) index.set(form, forms);
    const nominativePlural = PLURAL_NOMINATIVE[forms[0]];
    if (nominativePlural) index.set(nominativePlural, forms);
  }
  return index;
})();

function formIndex(shown: number): 0 | 1 | 2 {
  // A fraction takes the genitive singular: «1,5 балла», «0,5 года».
  if (!Number.isInteger(shown)) return 1;
  const whole = Math.abs(shown);
  const mod10 = whole % 10;
  const mod100 = whole % 100;
  if (mod10 === 1 && mod100 !== 11) return 0;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 1;
  return 2;
}

/** The number as the reader sees it once rounded to the displayed precision. */
export function shownNumber(value: number, precision: number): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** Math.max(0, Math.min(precision, 10));
  return Math.round(value * factor) / factor;
}

/** Whether the unit is a counted noun whose form follows the number. */
export function isCountableUnit(unit: string): boolean {
  return FORMS_BY_WRITTEN_FORM.has(unit.trim().toLowerCase());
}

/** The unit in the form that agrees with `shown` (a number already rounded to what is displayed). */
export function unitForNumber(shown: number, unit: string): string {
  const forms = FORMS_BY_WRITTEN_FORM.get(unit.trim().toLowerCase());
  if (!forms || !Number.isFinite(shown)) return unit;
  return forms[formIndex(shown)];
}

/** `unitForNumber` for a raw value and the precision it is displayed with. */
export function unitForQuantity(value: number, precision: number, unit: string): string {
  return unitForNumber(shownNumber(value, precision), unit);
}
