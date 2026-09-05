import { createHash } from 'node:crypto';

export type Category =
  | 'case'
  | 'medication'
  | 'document'
  | 'symptom'
  | 'disease'
  | 'syndrome'
  | 'tool'
  | 'personal-note'
  | 'patient';
export type Kind = 'clinical' | 'medication' | 'document' | 'tool' | 'personal-note' | 'patient';

export interface Candidate {
  readonly id: string;
  readonly documentId: string;
  readonly title: string;
  readonly text: string;
  readonly sectionPath: string;
  readonly kind: Kind;
  readonly vector?: Uint8Array;
  readonly vectorNorm?: number;
}

export interface CoreDocument {
  readonly id: string;
  readonly title: string;
  readonly aliases: readonly string[];
  readonly keywords: readonly string[];
  readonly targetDocumentId?: string;
  readonly family: 'clinical' | 'medication';
}

export interface BenchmarkCase {
  readonly id: string;
  readonly category: Category;
  readonly query: string;
  readonly expectedDocumentIds: readonly string[];
  readonly phrase?: boolean;
  readonly personalAllowed?: boolean;
  readonly expectNoPatient?: boolean;
}

export function normalize(value: string): string {
  return value.toLocaleLowerCase('ru').replaceAll(/\s+/gu, ' ').trim();
}

export function tokens(value: string): readonly string[] {
  return normalize(value).match(/[\p{L}\p{N}]{2,}/gu) ?? [];
}

export function stableHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableTake<T extends { readonly id: string }>(values: readonly T[], count: number): T[] {
  const result = values
    .toSorted((left, right) => stableHash(left.id).localeCompare(stableHash(right.id)))
    .slice(0, count);
  if (result.length !== count)
    throw new Error(`Expected ${count} fixtures, found ${result.length}.`);
  return result;
}

function expectedIds(document: CoreDocument): readonly string[] {
  return document.targetDocumentId ? [document.id, document.targetDocumentId] : [document.id];
}

export function syntheticPersonal(): {
  readonly candidates: Candidate[];
  readonly cases: BenchmarkCase[];
} {
  const candidates: Candidate[] = [];
  const cases: BenchmarkCase[] = [];
  const noteTopics = [
    'контроль пикфлоуметрии после обострения астмы',
    'дневник давления после замены терапии',
    'переносимость железа и контроль ферритина',
    'наблюдение после внебольничной пневмонии',
    'питание при целиакии и динамика массы',
    'повторный осмотр после отита',
    'дневник головной боли и триггеров',
  ];
  for (let index = 0; index < 35; index += 1) {
    const id = `note:synthetic-${String(index + 1).padStart(2, '0')}`;
    const topic = noteTopics[index % noteTopics.length] ?? noteTopics[0] ?? '';
    const marker = `наблюдение-${index + 101}`;
    const title = `Учебная заметка ${index + 1}`;
    const text = `${topic}. Контрольная метка ${marker}. Только синтетические данные.`;
    candidates.push({
      id,
      documentId: id,
      title,
      text,
      sectionPath: 'Личные записи',
      kind: 'personal-note',
    });
    cases.push({
      id: `personal-note-${index + 1}`,
      category: 'personal-note',
      query: `${topic} ${marker}`,
      expectedDocumentIds: [id],
      personalAllowed: true,
    });
  }
  for (let index = 0; index < 30; index += 1) {
    const id = `patient:synthetic-${String(index + 1).padStart(2, '0')}`;
    const record = `УЧ-${String(index + 401).padStart(3, '0')}`;
    const title = `Учебный пациент ${index + 1}`;
    const text = `${title}. Локальная карта № ${record}. Синтетический профиль без данных реального пациента.`;
    candidates.push({
      id,
      documentId: id,
      title,
      text,
      sectionPath: 'Карточка пациента',
      kind: 'patient',
    });
    cases.push({
      id: `patient-unlocked-${index + 1}`,
      category: 'patient',
      query: `${title} ${record}`,
      expectedDocumentIds: [id],
      personalAllowed: true,
    });
  }
  for (let index = 0; index < 5; index += 1) {
    cases.push({
      id: `patient-locked-${index + 1}`,
      category: 'patient',
      query: `найти закрытую карточку Учебный пациент ${index + 1} УЧ-${String(index + 401).padStart(3, '0')}`,
      expectedDocumentIds: [],
      personalAllowed: false,
      expectNoPatient: true,
    });
  }
  return { candidates, cases };
}

const SYMPTOM_SCENARIOS = [
  ['Острый бронхиолит у детей', 'младенец свистящее дыхание тахипноэ после насморка'],
  ['Острый бронхиолит у детей', 'ребенок до года плохо ест и тяжело дышит с хрипами'],
  ['Острый бронхиолит у детей', 'апноэ у грудного ребенка на фоне вирусной инфекции'],
  ['Острый бронхиолит у детей', 'втяжение грудной клетки и раздувание крыльев носа у младенца'],
  ['Острый бронхиолит у детей', 'первый эпизод бронхиальной обструкции у грудничка'],
  ['Острый бронхиолит у детей', 'свистящие хрипы удлиненный выдох ребенок 8 месяцев'],
  ['Острый бронхиолит у детей', 'сатурация снижена и частое дыхание у грудничка'],
  ['Внебольничная пневмония у детей', 'лихорадка тахипноэ локальные хрипы у ребенка'],
  ['Внебольничная пневмония у детей', 'кашель высокая температура боль в груди у ребенка'],
  ['Внебольничная пневмония у детей', 'раздувание крыльев носа и кряхтящее дыхание'],
  ['Внебольничная пневмония у детей', 'асимметрия дыхания притупление перкуторного звука'],
  ['Внебольничная пневмония у детей', 'лихорадка больше трех дней и дыхательная недостаточность'],
  ['Внебольничная пневмония у детей', 'ребенок с гипоксемией и подозрением на инфильтрат легких'],
  ['Внебольничная пневмония у детей', 'боль в животе на фоне лихорадки и плеврита'],
  ['Бронхит у детей', 'кашель рассеянные симметричные сухие и влажные хрипы'],
  ['Бронхит у детей', 'кашель субфебрильная температура без выраженной интоксикации'],
  ['Бронхит у детей', 'экспираторная одышка и свистящие хрипы при бронхите'],
  ['Бронхит у детей', 'острый кашель после инфекции без признаков пневмонии'],
  ['Бронхит у детей', 'ребенок кашляет хрипы меняются после откашливания'],
  ['Бронхит у детей', 'затяжной кашель и жесткое дыхание у ребенка'],
] as const;

export function createCases(
  core: readonly CoreDocument[],
  candidates: readonly Candidate[],
): BenchmarkCase[] {
  const cases: BenchmarkCase[] = [];
  const clinical = core.filter((document) => document.family === 'clinical');
  const medications = core.filter(
    (document) =>
      document.family === 'medication' &&
      document.title.length >= 4 &&
      document.title.length <= 55 &&
      !/[[\]{}]/u.test(document.title),
  );
  stableTake(medications, 70).forEach((document, index) => {
    const term = document.aliases[0] ?? document.title;
    cases.push({
      id: `medication-${index + 1}`,
      category: 'medication',
      query: index % 2 === 0 ? `найти препарат ${term}` : `инструкция и документы ${term}`,
      expectedDocumentIds: expectedIds(document),
    });
  });

  const diseaseDocs = clinical.filter(
    (document) => !normalize(document.title).includes('синдром') && document.title.length <= 80,
  );
  stableTake(diseaseDocs, 60).forEach((document, index) => {
    const term = document.aliases.find((alias) => alias.length >= 4) ?? document.title;
    cases.push({
      id: `disease-${index + 1}`,
      category: 'disease',
      query: index % 2 === 0 ? `описание болезни ${term}` : `документы по заболеванию ${term}`,
      expectedDocumentIds: expectedIds(document),
    });
  });

  const syndromeDocs = clinical.filter((document) => normalize(document.title).includes('синдром'));
  for (let index = 0; index < 40; index += 1) {
    const document = syndromeDocs[index % syndromeDocs.length];
    if (!document) throw new Error('No syndrome documents found.');
    const variant = Math.floor(index / syndromeDocs.length);
    const term = variant === 1 ? (document.aliases[0] ?? document.title) : document.title;
    cases.push({
      id: `syndrome-${index + 1}`,
      category: 'syndrome',
      query:
        variant === 0
          ? `синдром ${term}`
          : variant === 1
            ? `материалы ${term}`
            : `что означает ${term}`,
      expectedDocumentIds: expectedIds(document),
    });
  }

  const caseDocs = stableTake(
    clinical.filter((document) => document.keywords.length >= 2),
    40,
  );
  caseDocs.forEach((document, index) => {
    const clues = document.keywords.slice(0, 3).join(', ');
    cases.push(
      {
        id: `case-${index + 1}-a`,
        category: 'case',
        query: `Пациент: ${clues}. Какие клинические документы открыть?`,
        expectedDocumentIds: expectedIds(document),
      },
      {
        id: `case-${index + 1}-b`,
        category: 'case',
        query: `Клинический случай с признаками ${clues}; нужна рекомендация и описание болезни`,
        expectedDocumentIds: expectedIds(document),
      },
    );
  });

  const fullDocumentIds = new Map(
    candidates
      .filter(
        (candidate) =>
          candidate.kind === 'clinical' &&
          !candidate.documentId.startsWith('core.catalog.pointer.'),
      )
      .map((candidate) => [candidate.title, candidate.documentId]),
  );
  SYMPTOM_SCENARIOS.forEach(([title, phrase], scenario) => {
    const documentId = fullDocumentIds.get(title);
    if (!documentId) throw new Error(`Missing full document for symptom scenario: ${title}`);
    for (let variant = 0; variant < 3; variant += 1) {
      cases.push({
        id: `symptom-${scenario + 1}-${variant + 1}`,
        category: 'symptom',
        query:
          variant === 0
            ? phrase
            : variant === 1
              ? `у ребенка ${phrase}, что проверить`
              : `найти документы: ${phrase}`,
        expectedDocumentIds: [documentId],
      });
    }
  });

  const documentCandidates = candidates.filter(
    (candidate) => candidate.kind === 'document' && candidate.text.length >= 80,
  );
  const documentGroups = [
    ...new Map(documentCandidates.map((item) => [item.documentId, item])).values(),
  ];
  stableTake(documentGroups, 35).forEach((candidate, index) => {
    cases.push({
      id: `document-title-${index + 1}`,
      category: 'document',
      query: `открыть документ ${candidate.title}`,
      expectedDocumentIds: [candidate.documentId],
    });
  });
  const phraseCandidates = stableTake(
    documentCandidates.filter((candidate) => normalize(candidate.text).split(' ').length >= 12),
    35,
  );
  phraseCandidates.forEach((candidate, index) => {
    const phrase = normalize(candidate.text).split(' ').slice(0, 9).join(' ');
    cases.push({
      id: `document-phrase-${index + 1}`,
      category: 'document',
      query: phrase,
      expectedDocumentIds: [candidate.documentId],
      phrase: true,
    });
  });

  const tools = [
    ...new Map(
      candidates
        .filter((candidate) => candidate.kind === 'tool')
        .map((item) => [item.documentId, item]),
    ).values(),
  ];
  stableTake(tools, 50).forEach((candidate, index) => {
    const label = candidate.sectionPath === 'Опросник' ? 'опросник' : 'калькулятор';
    cases.push({
      id: `tool-${index + 1}`,
      category: 'tool',
      query: `${label} ${candidate.title}`,
      expectedDocumentIds: [candidate.documentId],
    });
  });

  cases.push(...syntheticPersonal().cases);
  const duplicateIds = cases
    .filter(
      (item, index) => cases.findIndex((candidate) => candidate.query === item.query) !== index,
    )
    .map((item) => item.id);
  if (cases.length !== 500 || duplicateIds.length > 0) {
    throw new Error(
      `Benchmark must contain 500 unique queries, got ${cases.length}; duplicates: ${duplicateIds.join(', ')}.`,
    );
  }
  return cases;
}
