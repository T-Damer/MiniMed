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
