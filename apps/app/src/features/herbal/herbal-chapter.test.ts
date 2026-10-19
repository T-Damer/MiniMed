import { describe, expect, it } from 'vitest';

import {
  authorityLabel,
  buildHerbalBook,
  courseLongerThanEma,
  courseMaxDays,
  emaDoseLine,
  emaSourceLabel,
  evidenceLabel,
  type HerbalRedBook,
  type HerbalSupplementRule,
  herbalActions,
  herbalPlantCountLabel,
  herbalQueryStem,
  herbalSearchValues,
  limitFacts,
  readHerbalChapter,
  redBookLabel,
  safetyLabel,
  safetySourceLabel,
  supplementRuleLine,
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

describe('herbal search and source conflicts', () => {
  const senna = chapter('herbal.plant.senna-alexandrina', 'Сенна остролистная', {
    plantId: 'senna-alexandrina',
    latin: 'Senna alexandrina Mill.',
    brew: { course: { value: '2–3 недели', quote: 'Курс лечения 2-3 недели.' } },
    ema: {
      page: 'https://www.ema.europa.eu/en/medicines/herbal/sennae-folium',
      extracted: true,
      status: 'proposed',
      documents: {},
      facts: [
        { ...quote, kind: 'duration', ru: 'Не дольше 1 недели', maxDays: 7 },
        { ...quote, kind: 'indication', ru: 'Кратковременно при эпизодическом запоре' },
        { ...quote, kind: 'indication', ru: 'Отхаркивающее при кашле от простуды' },
      ],
      constituents: [],
    },
  });

  it('marks a ГРЛС course longer than the EMA limit and keeps both values', () => {
    const plant = readHerbalChapter(senna);
    expect(plant?.brew.course?.value).toBe('2–3 недели');
    expect(courseMaxDays('2–3 недели')).toBe(21);
    expect(courseMaxDays('10 дней')).toBe(10);
    expect(courseMaxDays('по мере')).toBeNull();
    expect(plant && courseLongerThanEma(plant)).toBe(true);
    const chamomilePlant = readHerbalChapter(chamomile);
    expect(chamomilePlant && courseLongerThanEma(chamomilePlant)).toBe(false);
  });

  it('finds a plant by an EMA indication in another word form', () => {
    const plant = readHerbalChapter(senna);
    expect(plant && herbalSearchValues(plant)).toContain('Кратковременно при эпизодическом запоре');
    expect(herbalQueryStem('кашель')).toBe('кашл');
    expect(herbalQueryStem('сон')).toBeNull();
    expect(herbalQueryStem('кашл')).toBeNull();
  });
});

describe('herbal identification', () => {
  it('reads the ГФ source and drops look-alikes without a name or text', () => {
    const plant = readHerbalChapter(
      chapter('herbal.plant.equisetum-arvense', 'Хвощ полевой', {
        plantId: 'equisetum-arvense',
        latin: 'Equisetum arvense L.',
        identification: {
          source: {
            number: 'ФС.2.5.0045',
            edition: 15,
            url: 'https://pharmacopoeia.regmed.ru/pharmacopoeia/izdanie-15/2/2-3/x/',
          },
          lookalikes: [
            { name: 'Хвощ болотный (Equisetum palustre L.)', text: 'г) Хвощ болотный …' },
            { name: 'Без текста' },
            {
              name: 'Хвощ зимующий (Equisetum hyemale)',
              text: 'Примесь к хвощу полевому',
              source: 'manual',
              sourceLabel: 'СибГМУ, 2013, с. 60',
              poisonous: true,
            },
          ],
          key: { text: 'Побеги ветвистые', sourceLabel: 'СибГМУ, 2013, с. 60' },
        },
      }),
    );
    expect(plant?.identification?.sourceLabel).toBe('ГФ XV, ФС.2.5.0045');
    expect(plant?.identification?.lookalikes).toEqual([
      {
        name: 'Хвощ болотный (Equisetum palustre L.)',
        text: 'г) Хвощ болотный …',
        source: 'gf',
        sourceLabel: null,
        poisonous: false,
      },
      {
        name: 'Хвощ зимующий (Equisetum hyemale)',
        text: 'Примесь к хвощу полевому',
        source: 'manual',
        sourceLabel: 'СибГМУ, 2013, с. 60',
        poisonous: true,
      },
    ]);
    expect(plant?.identification?.key?.sourceLabel).toBe('СибГМУ, 2013, с. 60');
    expect(readHerbalChapter(chamomile)?.identification).toBeNull();
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

describe('Red Book', () => {
  it('reads the category and the row note of a listed plant', () => {
    const parsed = readHerbalChapter(
      chapter('herbal.plant.rhodiola-rosea', 'Родиола розовая', {
        plantId: 'rhodiola-rosea',
        latin: 'Rhodiola rosea L.',
        redBook: {
          number: 156,
          category: 3,
          categoryRu: 'Редкие',
          note: 'За исключением популяций Магаданской обл.',
          url: 'http://publication.pravo.gov.ru/document/0001202307210008',
          pdfPage: 7,
        },
      }),
    );
    expect(parsed?.redBook?.note).toBe('За исключением популяций Магаданской обл.');
    expect(redBookLabel(parsed?.redBook as HerbalRedBook)).toBe('3 — редкие');
    const unlisted = readHerbalChapter(
      chapter('herbal.plant.mentha-piperita', 'Мята перечная', {
        plantId: 'mentha-piperita',
        latin: 'Mentha × piperita L.',
      }),
    );
    expect(unlisted?.redBook).toBeNull();
  });
});

describe('safety lines', () => {
  it('reads quoted lines, the LiverTox score and the food-supplement rule', () => {
    const parsed = readHerbalChapter(
      chapter('herbal.plant.frangula-alnus', 'Крушина ломкая', {
        plantId: 'frangula-alnus',
        latin: 'Frangula alnus Mill.',
        safety: {
          lines: [
            {
              source: 'lactmed',
              kind: 'lactation',
              ru: 'Избегать',
              quote: 'Their use should be avoided.',
              url: 'https://www.ncbi.nlm.nih.gov/books/n/lactmed/LM941/',
            },
            { source: 'blog', kind: 'use', ru: 'x', quote: 'y' },
          ],
          liver: null,
          trts: {
            section: '1.1',
            ru: 'запрещено в составе БАД',
            parts: 'незрелые плоды, свежая кора',
            number: 157,
            quote:
              '157. Крушина ломкая (ольховидная) — Frangula alnus Mill — незрелые плоды, свежая кора',
            url: 'https://evil.example/tr.pdf',
          },
        },
      }),
    );
    const safety = parsed?.safety;
    // A line of an unknown source is dropped; a link off the known hosts is not shown.
    expect(safety?.lines.map((line) => safetySourceLabel(line.source))).toEqual(['LactMed']);
    expect(safety?.supplements?.url).toBeNull();
    expect(supplementRuleLine(safety?.supplements as HerbalSupplementRule)).toBe(
      'Запрещено в составе БАД: незрелые плоды, свежая кора',
    );
    expect(safetyLabel('interaction')).toBe('Лекарства');
  });
});

describe('WHO monographs', () => {
  it('labels the facts of a plant EMA does not cover as WHO facts', () => {
    const parsed = readHerbalChapter(
      chapter('herbal.plant.bidens-tripartita', 'Череда трёхраздельная', {
        plantId: 'bidens-tripartita',
        latin: 'Bidens tripartita L.',
        ema: {
          authority: 'WHO',
          page: 'https://iris.who.int/handle/10665/44059',
          extracted: true,
          status: 'proposed',
          useType: 'both',
          documents: { monograph: { url: 'https://example.test/nis.pdf' } },
          facts: [{ kind: 'pregnancy', ru: 'Не применять при беременности', ...quote, page: 53 }],
        },
      }),
    );
    expect(parsed?.ema?.authority).toBe('WHO');
    expect(authorityLabel(parsed?.ema ?? null)).toBe('ВОЗ');
    expect(emaSourceLabel({ ...quote, page: 53 } as never, 'WHO')).toBe('монография ВОЗ, с. 53');
    expect(evidenceLabel('review', 'WHO')).toBe('обзор ВОЗ');
    expect(evidenceLabel('animal', 'WHO')).toBe('опыты на животных');
    // A block without an authority is EMA, as every chapter before WHO was.
    expect(authorityLabel(null)).toBe('EMA');
  });
});
