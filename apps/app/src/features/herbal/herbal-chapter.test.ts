import { describe, expect, it } from 'vitest';

import {
  buildHerbalBook,
  emaDoseLine,
  herbalActions,
  herbalPlantCountLabel,
  limitFacts,
  readHerbalChapter,
} from './herbal-chapter';
import { herbalBookActionFromHash, herbalBookHash, isHerbalBookRoute } from './herbal-routing';

const quote = { doc: 'monograph', page: 4, quote: 'Hypersensitivity to the active substance.' };

function chapter(id: string, title: string, herbal: Record<string, unknown>) {
  return { id, title, sourceType: 'herbal_monograph', metadata: { herbal } };
}

const chamomile = chapter('herbal.plant.matricaria-chamomilla', 'Ромашка аптечная', {
  plantId: 'matricaria-chamomilla',
  latin: 'Matricaria chamomilla L.',
  family: 'Asteraceae',
  partRu: 'цветки',
  actions: ['противовоспалительное', 'спазмолитическое', 42],
  brew: {
    kind: 'настой',
    herb: { value: '8–10 г', quote: 'Около 8-10 г цветков помещают…' },
    water: { value: '200 мл' },
  },
  thumbnail: 'data:image/jpeg;base64,AAAA',
  plate: {
    asset: 'plates/matricaria-chamomilla.jpg',
    book: "Köhler's Medizinal-Pflanzen",
    credit: 'Köhler, 1887',
    licence: 'Public domain',
    commonsPage: 'https://commons.wikimedia.org/wiki/File:x.jpg',
  },
  ema: {
    page: 'https://www.ema.europa.eu/en/medicines/herbal/matricariae-flos',
    extracted: true,
    status: 'proposed',
    useType: 'traditional',
    documents: { monograph: { url: 'https://www.ema.europa.eu/m.pdf', draft: false } },
    facts: [
      { ...quote, kind: 'overdose', ru: 'Случаев передозировки не описано' },
      { ...quote, kind: 'contraindication', ru: 'Аллергия на астровые' },
      { ...quote, kind: 'age', ru: 'Не младше 6 месяцев' },
      { ...quote, kind: 'posology', ru: 'Чай', page: 0 },
    ],
    constituents: [],
  },
  grls: { ocr: false },
});

describe('herbal chapter metadata', () => {
  it('reads a chapter and drops malformed values', () => {
    const plant = readHerbalChapter(chamomile);
    expect(plant).not.toBeNull();
    expect(plant?.actions).toEqual(['противовоспалительное', 'спазмолитическое']);
    expect(plant?.brew.herb?.value).toBe('8–10 г');
    // A value without its source sentence is not shown.
    expect(plant?.brew.water).toBeNull();
    expect(plant?.plate?.credit).toBe('Köhler, 1887');
    expect(plant?.ema?.draft).toBe(true);
    // The posology fact cites page 0 and is dropped.
    expect(plant?.ema?.facts.map((fact) => fact.kind)).toEqual([
      'overdose',
      'contraindication',
      'age',
    ]);
    expect(plant?.ema?.documents.monograph).toBe('https://www.ema.europa.eu/m.pdf');
    expect(limitFacts(plant?.ema ?? null).map((fact) => fact.kind)).toEqual([
      'contraindication',
      'age',
    ]);
  });

  it('ignores other documents and builds the book in Russian order', () => {
    const guide = {
      id: 'herbal.guide.infusions',
      title: 'Настои и отвары: общие правила',
      sourceType: 'herbal_monograph',
      metadata: { herbal: { guide: 'infusions' } },
    };
    const sage = chapter('herbal.plant.salvia-officinalis', 'Шалфей лекарственный', {
      plantId: 'salvia-officinalis',
      latin: 'Salvia officinalis L.',
      actions: ['противовоспалительное'],
    });
    const other = { id: 'x', title: 'Другое', sourceType: 'medical_reference', metadata: {} };
    const book = buildHerbalBook([sage, other, guide, chamomile]);
    expect(book.plants.map((plant) => plant.title)).toEqual([
      'Ромашка аптечная',
      'Шалфей лекарственный',
    ]);
    expect(book.guides.map((item) => item.documentId)).toEqual(['herbal.guide.infusions']);
    expect(herbalActions(book.plants)).toEqual(['противовоспалительное', 'спазмолитическое']);
  });

  it('formats EMA doses and plant counts', () => {
    expect(
      emaDoseLine({
        preparationRu: 'настой',
        amount: '1.5-4',
        unit: 'г',
        waterMl: '150',
        timesPerDay: '3-4',
        populationRu: 'взрослые',
      }),
    ).toBe('1,5–4 г на 150 мл, 3–4 р/день');
    const documents = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ documentId: `herbal.plant.p${index}` }));
    expect(
      herbalPlantCountLabel([
        { documents: [...documents(30), { documentId: 'herbal.guide.infusions' }] },
      ]),
    ).toBe('30 растений');
    expect(herbalPlantCountLabel([{ documents: documents(1) }])).toBe('1 растение');
    expect(herbalPlantCountLabel([{ documents: [] }])).toBeNull();
  });
});

describe('herbal book routing', () => {
  it('keeps the action filter in the address', () => {
    expect(isHerbalBookRoute('#/modules/documents/herbal')).toBe(true);
    expect(isHerbalBookRoute('#/modules/documents/herbal?action=x')).toBe(true);
    expect(isHerbalBookRoute('#/modules/documents/conditions')).toBe(false);
    const hash = herbalBookHash('седативное');
    expect(isHerbalBookRoute(hash)).toBe(true);
    expect(herbalBookActionFromHash(hash)).toBe('седативное');
    expect(herbalBookActionFromHash(herbalBookHash(null))).toBeNull();
  });
});
