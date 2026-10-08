import { describe, expect, it } from 'vitest';

import {
  buildReaderPageModel,
  parseReaderPage,
  READER_IMAGE_WEIGHT,
  readerPageAriaLabel,
  readerPageAt,
  readerPageLabel,
  readerPageOfAnchor,
  readerPageTarget,
  readerSectionWeight,
  uniformReaderPageModel,
} from '@/features/library/document-reader-position';

/** 100 characters per page keeps the arithmetic readable. */
const options = { charsPerPage: 100 };
const sections = [
  { anchor: 'a', weight: 50 },
  { anchor: 'b', weight: 250 },
  { anchor: 'c', weight: 10 },
  { anchor: 'd', weight: 190 },
];

function model() {
  const built = buildReaderPageModel(sections, options);
  if (!built) throw new Error('expected a model');
  return built;
}

describe('buildReaderPageModel', () => {
  it('counts pages from the text, not from the number of sections', () => {
    expect(model().total).toBe(5);
    expect(model().length).toBe(500);
  });

  it('has no model for a document of one section or one page', () => {
    expect(buildReaderPageModel([{ anchor: 'a', weight: 900 }], options)).toBeNull();
    expect(
      buildReaderPageModel(
        [
          { anchor: 'a', weight: 20 },
          { anchor: 'b', weight: 30 },
        ],
        options,
      ),
    ).toBeNull();
    expect(buildReaderPageModel([], options)).toBeNull();
  });

  it('moves every section down by the text that stands before the first one', () => {
    const shifted = buildReaderPageModel(sections, { ...options, leading: 100 });
    expect(shifted?.total).toBe(6);
    expect(shifted && readerPageOfAnchor(shifted, 'a')).toBe(2);
  });

  it('gives an empty section a weight of one character so it keeps its place', () => {
    const built = buildReaderPageModel(
      [
        { anchor: 'a', weight: 0 },
        { anchor: 'b', weight: 150 },
      ],
      options,
    );
    expect(built?.starts).toEqual([0, 1]);
  });
});

describe('readerPageOfAnchor', () => {
  it('is the page a section starts on', () => {
    expect(readerPageOfAnchor(model(), 'a')).toBe(1);
    expect(readerPageOfAnchor(model(), 'b')).toBe(1);
    expect(readerPageOfAnchor(model(), 'c')).toBe(4);
    expect(readerPageOfAnchor(model(), 'd')).toBe(4);
    expect(readerPageOfAnchor(model(), 'missing')).toBeUndefined();
  });

  it('never exceeds the last page', () => {
    for (const section of sections) {
      expect(readerPageOfAnchor(model(), section.anchor)).toBeLessThanOrEqual(model().total);
    }
  });
});

describe('readerPageAt', () => {
  it('moves through a long section page by page as the fraction grows', () => {
    // Section «b» starts at 50 and holds 250 characters: pages 1 to 4.
    expect(readerPageAt(model(), 'b', 0)).toBe(1);
    expect(readerPageAt(model(), 'b', 0.2)).toBe(2);
    expect(readerPageAt(model(), 'b', 0.6)).toBe(3);
    expect(readerPageAt(model(), 'b', 1)).toBe(4);
  });

  it('clamps the fraction and ends on the last page', () => {
    expect(readerPageAt(model(), 'a', -1)).toBe(1);
    expect(readerPageAt(model(), 'd', 1)).toBe(5);
    expect(readerPageAt(model(), 'd', 7)).toBe(5);
  });

  it('reads an unknown anchor as the first page', () => {
    expect(readerPageAt(model(), '', 0.5)).toBe(1);
    expect(readerPageAt(model(), 'elsewhere', 0.5)).toBe(1);
  });
});

describe('readerPageTarget', () => {
  it('finds the section that holds the first character of a page', () => {
    expect(readerPageTarget(model(), 1)).toEqual({ anchor: 'a', fraction: 0 });
    // Page 3 begins at character 200: section «b» (50–300), 150 characters in.
    expect(readerPageTarget(model(), 3)).toEqual({ anchor: 'b', fraction: 0.6 });
    // Page 4 begins at 300, exactly where «c» starts.
    expect(readerPageTarget(model(), 4)).toEqual({ anchor: 'c', fraction: 0 });
  });

  it('clamps a page beyond the document to its ends', () => {
    expect(readerPageTarget(model(), 99)?.anchor).toBe('d');
    expect(readerPageTarget(model(), 0)).toEqual({ anchor: 'a', fraction: 0 });
  });

  it('lands on the page it was asked for', () => {
    const built = model();
    for (let page = 1; page <= built.total; page += 1) {
      const target = readerPageTarget(built, page);
      expect(target).not.toBeNull();
      if (!target) continue;
      // A hair past the target (the reading line sits a few pixels below it) is the same page.
      expect(readerPageAt(built, target.anchor, Math.min(1, target.fraction + 0.001))).toBe(page);
    }
  });
});

describe('uniformReaderPageModel', () => {
  it('counts every section as one page', () => {
    const uniform = uniformReaderPageModel(['a', 'b', 'c']);
    expect(uniform?.total).toBe(3);
    expect(uniform && readerPageOfAnchor(uniform, 'c')).toBe(3);
    expect(uniform && readerPageTarget(uniform, 2)).toEqual({ anchor: 'b', fraction: 0 });
  });

  it('shows nothing for fewer than two sections', () => {
    expect(uniformReaderPageModel(['only'])).toBeNull();
  });
});

describe('labels', () => {
  it('prints «page / total» and a spoken label', () => {
    expect(readerPageLabel(12, 48)).toBe('12 / 48');
    expect(readerPageAriaLabel(12, 48)).toBe('Страница 12 из 48. Перейти к странице');
  });
});

describe('parseReaderPage', () => {
  it('reads a number and clamps it to the document', () => {
    expect(parseReaderPage('7', 48)).toBe(7);
    expect(parseReaderPage(' 12 ', 48)).toBe(12);
    expect(parseReaderPage('0', 48)).toBe(1);
    expect(parseReaderPage('999', 48)).toBe(48);
  });

  it('rejects anything that is not a whole number', () => {
    expect(parseReaderPage('', 48)).toBeNull();
    expect(parseReaderPage('1.5', 48)).toBeNull();
    expect(parseReaderPage('-3', 48)).toBeNull();
    expect(parseReaderPage('двенадцать', 48)).toBeNull();
    expect(parseReaderPage('5', 0)).toBeNull();
  });
});

describe('readerSectionWeight', () => {
  it('adds the heading and the text of its chunks', () => {
    expect(
      readerSectionWeight({
        title: 'Лечение',
        chunks: [{ originalText: 'a'.repeat(100) }, { originalText: 'b'.repeat(40) }],
      }),
    ).toBe(7 + 140);
  });

  it('counts a picture as a fixed amount of text', () => {
    expect(
      readerSectionWeight({
        title: '',
        chunks: [{ originalText: '', metadata: { renderBlock: { kind: 'image' } } }],
      }),
    ).toBe(READER_IMAGE_WEIGHT);
  });

  it('keeps the text of a table at its own length', () => {
    expect(
      readerSectionWeight({
        title: '',
        chunks: [{ originalText: 'x'.repeat(2000), metadata: { renderBlock: { kind: 'table' } } }],
      }),
    ).toBe(2000);
  });
});
