/**
 * ICD-10 chapters by code, and the ICD-11 chapter that carries the same subject. The ICD-10 chapter
 * of a code is derived from its letter and number (the classification's own ranges), because the
 * app's ICD-10 cards do not store it; the build script checks this table against the chapter column
 * of every WHO mapping row.
 */

/** One ICD-10 chapter as a range of three-character codes, both ends included. */
export interface Icd10ChapterRange {
  /** Roman numeral as WHO's mapping tables write it. */
  readonly chapter: string;
  readonly from: string;
  readonly to: string;
}

export const ICD10_CHAPTER_RANGES: readonly Icd10ChapterRange[] = [
  { chapter: 'I', from: 'A00', to: 'B99' },
  { chapter: 'II', from: 'C00', to: 'D48' },
  { chapter: 'III', from: 'D50', to: 'D89' },
  { chapter: 'IV', from: 'E00', to: 'E90' },
  { chapter: 'V', from: 'F00', to: 'F99' },
  { chapter: 'VI', from: 'G00', to: 'G99' },
  { chapter: 'VII', from: 'H00', to: 'H59' },
  { chapter: 'VIII', from: 'H60', to: 'H95' },
  { chapter: 'IX', from: 'I00', to: 'I99' },
  { chapter: 'X', from: 'J00', to: 'J99' },
  { chapter: 'XI', from: 'K00', to: 'K93' },
  { chapter: 'XII', from: 'L00', to: 'L99' },
  { chapter: 'XIII', from: 'M00', to: 'M99' },
  { chapter: 'XIV', from: 'N00', to: 'N99' },
  { chapter: 'XV', from: 'O00', to: 'O99' },
  { chapter: 'XVI', from: 'P00', to: 'P96' },
  { chapter: 'XVII', from: 'Q00', to: 'Q99' },
  { chapter: 'XVIII', from: 'R00', to: 'R99' },
  { chapter: 'XIX', from: 'S00', to: 'T98' },
  { chapter: 'XX', from: 'V01', to: 'Y98' },
  { chapter: 'XXI', from: 'Z00', to: 'Z99' },
  { chapter: 'XXII', from: 'U00', to: 'U99' },
];

/**
 * ICD-11 chapter numbers that correspond, by the chapters' subject, to each ICD-10 chapter. A WHO
 * target outside this list is in a chapter that has no counterpart of the code's ICD-10 chapter —
 * the code's subject was moved to another chapter in ICD-11 (for example immune disorders from
 * ICD-10 chapter III to ICD-11 chapter 04). This is a fixed reading of the two classifications'
 * chapter titles, not data from the WHO tables.
 */
export const ICD10_CHAPTER_HOME_ICD11: Readonly<Record<string, readonly string[]>> = {
  I: ['01'],
  II: ['02'],
  III: ['03'],
  IV: ['05'],
  V: ['06'],
  VI: ['08'],
  VII: ['09'],
  VIII: ['10'],
  IX: ['11'],
  X: ['12'],
  XI: ['13'],
  XII: ['14'],
  XIII: ['15'],
  XIV: ['16'],
  XV: ['18'],
  XVI: ['19'],
  XVII: ['20'],
  XVIII: ['21'],
  XIX: ['22'],
  XX: ['23'],
  XXI: ['24'],
  XXII: ['25'],
};

/** The ICD-10 chapter of a normalized category code such as «G40.9», or null outside the ranges. */
export function icd10ChapterOf(code: string): string | null {
  if (!/^[A-Z]\d{2}(?:\.\d+)?$/u.test(code)) return null;
  const stem = code.slice(0, 3);
  return (
    ICD10_CHAPTER_RANGES.find((range) => stem >= range.from && stem <= range.to)?.chapter ?? null
  );
}
