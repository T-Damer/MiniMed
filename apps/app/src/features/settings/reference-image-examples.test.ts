import { describe, expect, it } from 'vitest';

import {
  chooseReferenceImageExamples,
  parseBundledPreviewIndex,
  referenceImageExamplesNote,
  referenceImagesContentsLabel,
} from '@/features/settings/reference-image-examples';

const HASH = 'a'.repeat(64);
const example = (name: string) => ({
  alt: name,
  url: `blob:${name}`,
  sourceUrl: 'https://www.krasotaimedicina.ru/upload/a.jpg',
});

describe('reference image examples', () => {
  it('reads the bundled index and drops entries outside the set', () => {
    const index = {
      images: [
        {
          alt: ' Потница ',
          path: `assets/${HASH}.jpg`,
          sourceUrl: 'https://www.krasotaimedicina.ru/upload/a.jpg',
        },
        {
          alt: 'Путь наружу',
          path: '../secret.jpg',
          sourceUrl: 'https://www.krasotaimedicina.ru/x',
        },
        {
          alt: 'Чужой источник',
          path: `assets/${HASH}.jpg`,
          sourceUrl: 'https://example.com/a.jpg',
        },
        { alt: '', path: `assets/${HASH}.jpg`, sourceUrl: 'https://www.krasotaimedicina.ru/x' },
        { path: `assets/${HASH}.jpg` },
      ],
    };
    expect(parseBundledPreviewIndex(index, (path) => `/p/${path}`)).toEqual([
      {
        alt: 'Потница',
        url: `/p/assets/${HASH}.jpg`,
        sourceUrl: 'https://www.krasotaimedicina.ru/upload/a.jpg',
      },
    ]);
    expect(parseBundledPreviewIndex(null, (path) => path)).toEqual([]);
    expect(parseBundledPreviewIndex({ images: 'x' }, (path) => path)).toEqual([]);
  });

  it('prefers downloaded images, then bundled ones, within the limit', () => {
    const downloaded = [example('a'), example('b'), example('c')];
    const bundled = [example('x'), example('y')];
    expect(chooseReferenceImageExamples(downloaded, bundled, 2)).toEqual({
      origin: 'device',
      images: [example('a'), example('b')],
    });
    expect(chooseReferenceImageExamples([], bundled)).toEqual({
      origin: 'bundled',
      images: bundled,
    });
    expect(chooseReferenceImageExamples([], [])).toEqual({ origin: 'none', images: [] });
  });

  it('describes the set with the right plural forms and size', () => {
    const label = (documents: number, files: number, bytes: number) =>
      referenceImagesContentsLabel({ documents, files, bytes }).replace(/ /gu, ' ');
    expect(label(5932, 9123, 484019603)).toBe('9 123 иллюстрации к 5 932 статьям · 462 МБ');
    expect(label(1, 1, 2 * 1024 * 1024)).toBe('1 иллюстрация к 1 статье · 2,0 МБ');
    expect(label(5, 12, 20 * 1024 * 1024)).toBe('12 иллюстраций к 5 статьям · 20 МБ');
  });

  it('explains where the examples come from', () => {
    expect(referenceImageExamplesNote({ origin: 'device', images: [example('a')] })).toMatch(
      /уже скачанные/u,
    );
    expect(referenceImageExamplesNote({ origin: 'bundled', images: [example('a')] })).toMatch(
      /встроены в приложение/u,
    );
    expect(referenceImageExamplesNote({ origin: 'none', images: [] })).toMatch(/недоступны/u);
  });
});
