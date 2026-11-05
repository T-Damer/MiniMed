/** Tablet colours, picked by the name, so two medicines on one screen rarely look alike. */
const HUES = [205, 150, 28, 275, 340, 185, 95, 5] as const;

export function pillHue(name: string): number {
  let hash = 0;
  for (const char of name.toLocaleLowerCase('ru')) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  }
  return HUES[hash % HUES.length] ?? HUES[0];
}

/** The first letter or digit of a medicine's name, as printed on its tablet. */
export function pillLetter(name: string): string {
  return (/[\p{L}\p{N}]/u.exec(name)?.[0] ?? '•').toLocaleUpperCase('ru');
}

/** The shape a medicine's mark takes, by its form (owner 2026-11-04: pills and solutions differ). */
export type DrugShape = 'tablet' | 'capsule' | 'liquid' | 'ampoule' | 'tube';

const INJECTION = /инъек|ампул|в\/[вм]|п\/к|внутрив|внутримыш|подкож|шприц/u;

/** «капсулы» → capsule, «раствор для приёма внутрь» → liquid, «раствор для инъекций» → ampoule. */
export function drugShape(form: string | undefined): DrugShape {
  const text = (form ?? '').toLocaleLowerCase('ru');
  if (/капс/u.test(text)) return 'capsule';
  if (INJECTION.test(text)) return 'ampoule';
  if (/раствор|сироп|капл|суспенз|настойк|эликсир|эмульс|микстур|спрей|жидк/u.test(text)) {
    return 'liquid';
  }
  if (/мазь|крем|гель|линимент|паст/u.test(text)) return 'tube';
  return 'tablet';
}
