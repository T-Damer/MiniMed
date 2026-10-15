/**
 * The secondary-classes file of the drug screen (CLS2): derived from the interaction index at build
 * time, so the screen reads a few kB and never the 2.1 MB index.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { type AssetCard, parseInteractionIndex } from './interaction-index';
import {
  parseSecondaryClassAsset,
  type SecondaryClassAsset,
  secondaryClassAsset,
  secondaryClassLine,
} from './secondary-classes';

const ATC = { version: '3.8', publishDate: '2025-07-15' } as const;

describe('the secondary-classes asset', () => {
  const cards: readonly AssetCard[] = [
    ['ибупрофен', ['M01AE01'], [1]],
    ['капли', ['N05CM'], [2], [['N05CB', 'фенобарбитал', 'барбитурат, снотворное']]],
    [
      'алфа',
      ['N02BB72'],
      [3],
      [
        ['N02A', 'кодеин', 'опиоид'],
        ['N06BC', 'кофеин', 'психостимулятор'],
      ],
    ],
  ];

  it('holds only the cards that have secondary classes, by slug, sorted', () => {
    const asset = secondaryClassAsset(cards, ATC);
    expect(Object.keys(asset.cards)).toEqual(['алфа', 'капли']);
    expect(asset.cards['капли']).toEqual([['N05CB', 'фенобарбитал', 'барбитурат, снотворное']]);
    expect(asset.atc).toEqual(ATC);
  });

  it('reads back what it wrote and refuses a malformed file', () => {
    const asset = secondaryClassAsset(cards, ATC);
    const catalog = parseSecondaryClassAsset(JSON.parse(JSON.stringify(asset)));
    expect(catalog.get('алфа')).toEqual([
      { code: 'N02A', via: 'кодеин', label: 'опиоид' },
      { code: 'N06BC', via: 'кофеин', label: 'психостимулятор' },
    ]);
    expect(catalog.has('ибупрофен')).toBe(false);
    expect(() => parseSecondaryClassAsset({ ...asset, schemaVersion: 2 })).toThrow(/schema/u);
    expect(() => parseSecondaryClassAsset({ ...asset, cards: [] })).toThrow(/cards/u);
    expect(() => parseSecondaryClassAsset({ ...asset, cards: { x: [] } })).toThrow(/malformed/u);
    expect(() => parseSecondaryClassAsset({ ...asset, cards: { x: [['N05CB', 'y']] } })).toThrow(
      /malformed/u,
    );
  });
});

describe('the line of the drug screen', () => {
  it('says the class first and the component after, in plain words', () => {
    expect(
      secondaryClassLine([{ code: 'N05CB', via: 'фенобарбитал', label: 'барбитурат, снотворное' }]),
    ).toBe('также: барбитурат, снотворное (через фенобарбитал)');
  });

  it('puts several classes in one line and never says the same thing twice', () => {
    expect(
      secondaryClassLine([
        { code: 'N02A', via: 'кодеин', label: 'опиоид' },
        { code: 'N06BC', via: 'кофеин', label: 'психостимулятор' },
        { code: 'N06BC', via: 'кофеин', label: 'психостимулятор' },
      ]),
    ).toBe('также: опиоид (через кодеин); психостимулятор (через кофеин)');
  });

  it('has no line for a drug without secondary classes and shows no ATC code', () => {
    expect(secondaryClassLine(undefined)).toBeNull();
    expect(secondaryClassLine([])).toBeNull();
    const line = secondaryClassLine([
      { code: 'R06AB', via: 'хлорфенамин', label: 'антигистаминное' },
    ]);
    expect(line).not.toMatch(/R06AB/u);
  });
});

describe('the committed file', () => {
  const read = (path: string): unknown =>
    JSON.parse(readFileSync(resolve(import.meta.dirname, path), 'utf8'));
  const index = parseInteractionIndex(read('data/interaction-index.json'));
  const file = read('data/secondary-classes.json') as SecondaryClassAsset;

  it('is exactly what the committed interaction index says (rebuild after a change)', () => {
    expect(file).toEqual(secondaryClassAsset(index.cards, index.basis.atc));
  });

  it('is small enough to load on every drug screen', () => {
    const bytes = readFileSync(
      resolve(import.meta.dirname, 'data/secondary-classes.json'),
    ).byteLength;
    expect(bytes).toBeLessThan(20_000);
    expect(Object.keys(file.cards).length).toBeGreaterThan(20);
  });

  it('carries the drops of Корвалол with the phenobarbital class', () => {
    const catalog = parseSecondaryClassAsset(file);
    const line = secondaryClassLine(
      catalog.get('мяты-перечной-листьев-масло-фенобарбитал-этилбромизовалерианат'),
    );
    expect(line).toBe('также: барбитурат, снотворное (через фенобарбитал)');
  });
});

describe('every recorded card shows its line (QA 0.6.60)', () => {
  const read = (path: string): unknown =>
    JSON.parse(readFileSync(resolve(import.meta.dirname, path), 'utf8'));
  const file = read('data/secondary-classes.json') as SecondaryClassAsset;
  const catalog = parseSecondaryClassAsset(file);
  const comparison = read('../drug-comparison/data/comparison-index.json') as {
    cards: readonly { readonly s: string }[];
  };
  const screenCards = new Set(comparison.cards.map((card) => card.s));

  it('has a card on the drug screen for each recorded slug: the screen finds its line by that slug', () => {
    // The drug screen takes the slug from the card's `esklp.mnn.<slug>` id (the comparison index lists
    // the same cards); a recorded slug the screen never produces would leave its line unseen.
    const unseen = [...catalog.keys()].filter((slug) => !screenCards.has(slug));
    expect(unseen).toEqual([]);
  });

  it('gives each recorded card a line that names every class and the component that brings it', () => {
    for (const [slug, classes] of catalog) {
      const line = secondaryClassLine(catalog.get(slug));
      expect(line, slug).not.toBeNull();
      for (const entry of classes) {
        expect(line, `${slug} ${entry.code}`).toContain(entry.label);
        expect(line, `${slug} ${entry.code}`).toContain(`через ${entry.via}`);
      }
      expect(line, slug).not.toMatch(/[A-Z]\d{2}/u);
    }
  });

  it('shows the cold remedies of one component set alike: Колдакт Флю Плюс like Колдакт Форс', () => {
    const line = (slug: string): string | null => secondaryClassLine(catalog.get(slug));
    expect(line('парацетамол-фенилэфрин-хлорфенамин')).toBe(
      'также: деконгестант (через фенилэфрин); антигистаминное (через хлорфенамин)',
    );
    expect(line('парацетамол-фенилэфрин-хлорфенамин-аскорбиновая-кислота')).toBe(
      line('парацетамол-фенилэфрин-хлорфенамин'),
    );
  });
});
