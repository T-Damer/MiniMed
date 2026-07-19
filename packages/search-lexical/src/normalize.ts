const STOP_WORDS = new Set([
  'без',
  'бы',
  'в',
  'во',
  'для',
  'до',
  'же',
  'и',
  'из',
  'или',
  'к',
  'как',
  'ко',
  'ли',
  'на',
  'не',
  'но',
  'о',
  'об',
  'от',
  'по',
  'под',
  'при',
  'с',
  'со',
  'у',
  'что',
  'это',
]);

const RUSSIAN_SUFFIXES = [
  'иями',
  'ями',
  'ами',
  'ого',
  'ему',
  'ому',
  'ыми',
  'ими',
  'иях',
  'ях',
  'ах',
  'ение',
  'ания',
  'ений',
  'ание',
  'ость',
  'ости',
  'его',
  'ая',
  'яя',
  'ое',
  'ее',
  'ые',
  'ие',
  'ой',
  'ей',
  'ий',
  'ый',
  'ам',
  'ям',
  'ом',
  'ем',
  'ов',
  'ев',
  'ия',
  'ья',
  'ью',
  'ы',
  'и',
  'а',
  'я',
  'у',
  'ю',
  'е',
  'о',
].toSorted((left, right) => right.length - left.length);

export function normalizeSurfaceText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replace(/[‐‑‒–—−]/gu, '-')
    .replace(/[^0-9a-zа-я\s.,:+/%-]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function tokenize(value: string): readonly string[] {
  return [...normalizeSurfaceText(value).matchAll(/[0-9a-zа-я]+/gu)]
    .map((match) => match[0])
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

export function lightStemRussian(token: string): string {
  if (token.length < 5 || !/[а-я]/u.test(token)) return token;
  for (const suffix of RUSSIAN_SUFFIXES) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 4) {
      return token.slice(0, -suffix.length);
    }
  }
  return token;
}

export function normalizeForIndex(value: string): string {
  const forms = new Set<string>();
  for (const token of tokenize(value)) {
    forms.add(token);
    forms.add(lightStemRussian(token));
  }
  return [...forms].join(' ');
}
