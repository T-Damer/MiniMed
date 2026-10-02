/**
 * Builds the retrieval benchmark of docs/research/query-datasets-2026-10.md from external datasets.
 *
 *   bun tools/benchmarks/src/build-retrieval-benchmark.ts --fetch   # download the (small) sources first
 *   bun tools/benchmarks/src/build-retrieval-benchmark.ts           # rebuild from data/raw/query-datasets
 *
 * Outputs
 * - `tools/benchmarks/retrieval-icd-queries.json`: complaints (RuMedPrimeData, CC BY 3.0) and
 *   diagnosis phrases (RuCCoD, CC BY 4.0) with ICD-10 relevance; redistributable with attribution.
 * - `data/build/retrieval-drug-forum-queries.json` (git-ignored): forum drug questions whose
 *   dataset has no licence (blinoff/medical_qa_ru_data, `license: unknown`); never committed.
 *
 * Relevance is derived, not judged: a clinical recommendation counts when the registry lists an
 * ICD code related to the gold code, an МКБ card when its code is related, a medication document
 * when a drug name in the question resolves to its ЕСКЛП МНН. Rows are drawn deterministically
 * (SHA-1 order of the record id) with a per-block cap, split dev/test by the source's own split
 * where it has one.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import {
  bestRelation,
  icdBlock,
  normalizeIcdCode,
  type RelevantDocument,
  type RetrievalBenchmark,
  type RetrievalQuery,
  type RetrievalSource,
  type RetrievalSplit,
} from './retrieval-benchmark';

interface ReadonlyDatabase {
  query(sql: string): { all(): unknown[] };
  close(): void;
}
// Bun's SQLite, loaded dynamically so the package typechecks without Bun's type definitions.
const { Database } = (await import('bun:sqlite' as string)) as unknown as {
  Database: new (path: string, options: { readonly: boolean }) => ReadonlyDatabase;
};

const ROOT = resolve(import.meta.dirname, '../../..');
const RAW = resolve(ROOT, 'data/raw/query-datasets');
const CONTENT = resolve(ROOT, 'apps/app/public/content');
const SEED = 'minimed-retrieval-2026-10-02';

const SOURCES = {
  rumedprime: {
    id: 'rumedprime',
    name: 'RuMedPrimeData (RuMedBench RuMedTop3 splits)',
    url: 'https://zenodo.org/records/5765873',
    licence: 'CC-BY-3.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/3.0/',
    attribution:
      'Starovoytova E.A., Kulikov E.S., Fedosenko S.V., Shmyrina A.A., Kirillova N.A., Vinokurova D.A., Balaganskaya M.A. RuMedPrimeData, Zenodo, doi:10.5281/zenodo.5765873; splits from Blinov et al., RuMedBench (arXiv:2201.06499)',
    redistributable: true,
  },
  ruccod: {
    id: 'ruccod',
    name: 'RuCCoD',
    url: 'https://github.com/auto-icd-coding/ruccod',
    licence: 'CC-BY-4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
    attribution:
      'Nesterov A. et al. RuCCoD: Towards Automated ICD Coding in Russian, EMNLP 2025 (arXiv:2502.21263); licence stated in the paper ("released under the CC BY 4.0 license"), the repository has no LICENSE file',
    redistributable: true,
  },
  'forum-drug': {
    id: 'forum-drug',
    name: 'blinoff/medical_qa_ru_data (forum questions about medications)',
    url: 'https://huggingface.co/datasets/blinoff/medical_qa_ru_data',
    licence: 'unknown (Hugging Face card: license: unknown; scraped forum posts)',
    licenceUrl: 'https://huggingface.co/datasets/blinoff/medical_qa_ru_data',
    attribution: 'Blinov P., Hugging Face dataset blinoff/medical_qa_ru_data',
    redistributable: false,
  },
} as const satisfies Record<string, RetrievalSource>;

interface Download {
  readonly path: string;
  readonly url: string;
  readonly range?: string;
}
const DOWNLOADS: readonly Download[] = [
  {
    path: 'rumedprime/RuMedPrimeData.zip',
    url: 'https://zenodo.org/api/records/5765873/files/RuMedPrimeData.zip/content',
  },
  {
    path: 'rumedprime/top3-dev_v1.jsonl',
    url: 'https://raw.githubusercontent.com/sb-ai-lab/MedBench/main/data/RuMedTop3/dev_v1.jsonl',
  },
  {
    path: 'rumedprime/top3-test_v1.jsonl',
    url: 'https://raw.githubusercontent.com/sb-ai-lab/MedBench/main/data/RuMedTop3/test_v1.jsonl',
  },
  {
    path: 'ruccod/data.zip',
    url: 'https://github.com/auto-icd-coding/ruccod/raw/main/data.zip',
  },
  {
    path: 'forum/medical_qa_ru_data.head.csv',
    url: 'https://huggingface.co/datasets/blinoff/medical_qa_ru_data/resolve/main/medical_qa_ru_data.csv',
    // First 20 MB of the 266 MB file: ~14 000 posts are enough for 100 drug questions.
    range: 'bytes=0-19999999',
  },
];

async function fetchSources(): Promise<void> {
  for (const item of DOWNLOADS) {
    const target = resolve(RAW, item.path);
    mkdirSync(resolve(target, '..'), { recursive: true });
    const response = await fetch(item.url, {
      headers: item.range ? { Range: item.range } : {},
      redirect: 'follow',
    });
    if (!response.ok) throw new Error(`${item.url}: HTTP ${response.status}`);
    writeFileSync(target, new Uint8Array(await response.arrayBuffer()));
    console.log(`[fetch] ${item.path}`);
  }
  for (const [zip, directory] of [
    ['rumedprime/RuMedPrimeData.zip', 'rumedprime'],
    ['ruccod/data.zip', 'ruccod'],
  ] as const) {
    const result = spawnSync('unzip', [
      '-o',
      '-q',
      resolve(RAW, zip),
      '-d',
      resolve(RAW, directory),
    ]);
    if (result.status !== 0) throw new Error(`unzip ${zip}: ${result.stderr.toString()}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Corpus facts: which documents the full databases contain and which ICD codes they carry

interface Corpus {
  /** `kr.rf.<id>` → ICD-10 codes/ranges from the registry. */
  readonly recommendations: ReadonlyMap<string, readonly string[]>;
  /** `rls.mkb.node.*` → code. */
  readonly mkbCards: ReadonlyMap<string, string>;
}

function loadCorpus(): Corpus {
  const registry = resolve(ROOT, 'data/raw/official-clinical-registry/2026-10-02');
  const codes = new Map<string, readonly string[]>();
  for (const name of ['catalog-all-statuses.json', 'catalog.json']) {
    const catalog = JSON.parse(readFileSync(resolve(registry, name), 'utf8')) as {
      records: readonly { id: string; mkb10?: readonly string[] }[];
    };
    for (const record of catalog.records) codes.set(record.id, record.mkb10 ?? []);
  }
  const packDirectories = [
    resolve(ROOT, 'data/build/release-clinical'),
    resolve(ROOT, 'data/build/core-clinical-new-editions/databases'),
  ];
  const recommendations = new Map<string, readonly string[]>();
  for (const directory of packDirectories) {
    for (const file of readdirSync(directory).filter((name) => name.endsWith('.db'))) {
      const database = new Database(resolve(directory, file), { readonly: true });
      for (const row of database.query('SELECT id FROM documents').all() as { id: string }[]) {
        const officialId = row.id.replace(/^kr\.rf\./u, '');
        recommendations.set(row.id, codes.get(officialId) ?? []);
      }
      database.close();
    }
  }
  const mkb = new Database(resolve(CONTENT, 'mkb.db'), { readonly: true });
  const mkbCards = new Map<string, string>();
  for (const row of mkb
    .query(
      "SELECT id, json_extract(metadata_json, '$.mkbCode') AS code FROM documents WHERE id LIKE 'rls.mkb.node.%'",
    )
    .all() as { id: string; code: string | null }[]) {
    const code = row.code ? normalizeIcdCode(row.code) : null;
    if (code) mkbCards.set(row.id, code);
  }
  mkb.close();
  return { recommendations, mkbCards };
}

function relevantForCodes(corpus: Corpus, goldCodes: readonly string[]): RelevantDocument[] {
  const found: RelevantDocument[] = [];
  for (const [documentId, codes] of corpus.recommendations) {
    const relation = bestRelation(goldCodes, codes);
    if (relation) {
      found.push({
        documentId,
        grade: relation === 'exact' ? 3 : 1,
        kind: 'clinical-recommendation',
      });
    }
  }
  for (const [documentId, code] of corpus.mkbCards) {
    const relation = bestRelation(goldCodes, [code]);
    if (relation) {
      found.push({ documentId, grade: relation === 'exact' ? 3 : 1, kind: 'mkb-card' });
    }
  }
  return found.toSorted(
    (left, right) => right.grade - left.grade || left.documentId.localeCompare(right.documentId),
  );
}

// ---------------------------------------------------------------------------------------------
// Sampling helpers

const order = (id: string) => createHash('sha1').update(`${SEED}:${id}`).digest('hex');
const clean = (text: string) => text.replace(/\s+/gu, ' ').trim();

interface Candidate {
  readonly recordId: string;
  readonly query: string;
  readonly split: RetrievalSplit;
  readonly goldCodes: readonly string[];
  readonly relevant: readonly RelevantDocument[];
  readonly hasRecommendation: boolean;
}

/**
 * Deterministic, block-capped sample: per split, `recommendationShare` of the rows have a grade-3
 * recommendation (the rest only МКБ cards), at most `blockCap` rows per 3-character ICD block.
 */
function sample(
  candidates: readonly Candidate[],
  perSplit: number,
  recommendationShare: number,
  blockCap: number,
): Candidate[] {
  const chosen: Candidate[] = [];
  for (const split of ['dev', 'test'] as const) {
    const pool = candidates
      .filter((candidate) => candidate.split === split)
      .toSorted((left, right) => order(left.recordId).localeCompare(order(right.recordId)));
    const quotas = {
      withRecommendation: Math.round(perSplit * recommendationShare),
      without: perSplit - Math.round(perSplit * recommendationShare),
    };
    const blocks = new Map<string, number>();
    for (const candidate of pool) {
      const key = candidate.hasRecommendation ? 'withRecommendation' : 'without';
      if (quotas[key] === 0) continue;
      const block = icdBlock(candidate.goldCodes[0] ?? '');
      if ((blocks.get(block) ?? 0) >= blockCap) continue;
      blocks.set(block, (blocks.get(block) ?? 0) + 1);
      quotas[key] -= 1;
      chosen.push(candidate);
    }
    if (quotas.withRecommendation > 0 || quotas.without > 0) {
      throw new Error(`Not enough candidates for ${split}: ${JSON.stringify(quotas)}`);
    }
  }
  return chosen;
}

function toQuery(
  source: RetrievalSource['id'],
  style: RetrievalQuery['style'],
  candidate: Candidate,
): RetrievalQuery {
  return {
    id: `${source}-${candidate.recordId}`,
    query: candidate.query,
    source,
    sourceRecordId: candidate.recordId,
    split: candidate.split,
    style,
    machineTranslated: false,
    goldCodes: candidate.goldCodes,
    goldNames: [],
    relevant: candidate.relevant,
  };
}

function candidateFor(
  corpus: Corpus,
  recordId: string,
  query: string,
  split: RetrievalSplit,
  rawCode: string,
): Candidate | null {
  const code = normalizeIcdCode(rawCode);
  if (!code) return null;
  const relevant = relevantForCodes(corpus, [code]);
  if (!relevant.some((doc) => doc.grade === 3)) return null;
  return {
    recordId,
    query,
    split,
    goldCodes: [code],
    relevant,
    hasRecommendation: relevant.some(
      (doc) => doc.grade === 3 && doc.kind === 'clinical-recommendation',
    ),
  };
}

// ---------------------------------------------------------------------------------------------
// RuMedPrimeData: patient complaints written down by the doctor → ICD-10 code

function parseTsv(text: string): string[][] {
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.split('\t'));
}

/** Anonymisation placeholders (`*ДАТА*`) and «no complaints» visits are not patient language. */
const NOT_A_COMPLAINT =
  /\*[А-ЯЁ]+\*|жалоб(?:\s+активн\p{L}*)?\s+нет|жалоб(?:ы|а)?\s+не\s+предъявля|без\s+жалоб/iu;

function rumedprimeCandidates(corpus: Corpus): Candidate[] {
  const splitOf = new Map<string, RetrievalSplit>();
  for (const [file, split] of [
    ['top3-dev_v1.jsonl', 'dev'],
    ['top3-test_v1.jsonl', 'test'],
  ] as const) {
    for (const line of readFileSync(resolve(RAW, 'rumedprime', file), 'utf8').split('\n')) {
      if (line.trim()) splitOf.set((JSON.parse(line) as { idx: string }).idx, split);
    }
  }
  const rows = parseTsv(readFileSync(resolve(RAW, 'rumedprime/RuMedPrimeData.tsv'), 'utf8')).slice(
    1,
  );
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const [symptoms = '', , icd = '', , eventId = ''] of rows) {
    const split = splitOf.get(eventId);
    const query = clean(symptoms);
    // Complaints that are too short carry no signal; very long ones are histories, not queries.
    if (!split || query.length < 25 || query.length > 400 || NOT_A_COMPLAINT.test(query)) continue;
    if (seen.has(query.toLowerCase())) continue;
    seen.add(query.toLowerCase());
    const candidate = candidateFor(corpus, eventId, query, split, icd);
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

// ---------------------------------------------------------------------------------------------
// RuCCoD: diagnosis phrases from doctors' conclusions → ICD-10 code (train → dev, test → test)

/** A single adjective cut out of a longer diagnosis («болевым») is not a query. */
const FRAGMENT = /^[\p{L}]+(?:ый|ий|ой|ая|ое|ые|ым|им|их|ых|ого|ему|ому|ыми)$/iu;

function ruccodCandidates(corpus: Corpus): Candidate[] {
  const phrases = new Map<
    string,
    { codes: Set<string>; recordId: string; split: RetrievalSplit; phrase: string }
  >();
  for (const [directory, split] of [
    ['ruccod_train', 'dev'],
    ['ruccod_test', 'test'],
  ] as const) {
    const base = resolve(RAW, 'ruccod/data', directory);
    for (const file of readdirSync(base).filter((name) => name.endsWith('.ann'))) {
      const entities = new Map<string, { text: string; start: string }>();
      for (const line of readFileSync(resolve(base, file), 'utf8').split('\n')) {
        const parts = line.split('\t');
        // Some files reuse an entity id (T2 twice); the entity is the latest one with that id.
        if (line.startsWith('T') && parts[0] && parts[1] && parts[2]) {
          entities.set(parts[0], { text: parts[2], start: parts[1].split(' ')[1] ?? '0' });
        }
        if (line.startsWith('N') && parts[1] && parts[2]) {
          const entity = entities.get(parts[1].split(' ')[1] ?? '');
          const phrase = clean(entity?.text ?? '');
          if (!entity || phrase.length < 5 || FRAGMENT.test(phrase)) continue;
          const key = `${split}:${phrase.toLowerCase()}`;
          const entry = phrases.get(key) ?? {
            codes: new Set<string>(),
            recordId: `${split === 'dev' ? 'train' : 'test'}-${basename(file, '.ann')}-${entity.start}`,
            split,
            phrase,
          };
          entry.codes.add(parts[2]);
          phrases.set(key, entry);
        }
      }
    }
  }
  const candidates: Candidate[] = [];
  const testPhrases = new Set(
    [...phrases.keys()].filter((key) => key.startsWith('test:')).map((key) => key.slice(5)),
  );
  for (const [key, entry] of phrases) {
    // An ambiguous phrase (several codes) has no single gold; a dev phrase also present in the
    // test split would leak.
    if (entry.codes.size !== 1) continue;
    if (key.startsWith('dev:') && testPhrases.has(key.slice(4))) continue;
    const candidate = candidateFor(
      corpus,
      entry.recordId,
      entry.phrase,
      entry.split,
      [...entry.codes][0] ?? '',
    );
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

// ---------------------------------------------------------------------------------------------
// Forum drug questions → ЕСКЛП МНН by drug name (names from the core's alias table)

interface DrugDictionary {
  /** lower-case single-token alias → canonical МНН titles */
  readonly names: ReadonlyMap<string, ReadonlySet<string>>;
  /** МНН title → documents (esklp.mnn.* plus Allmed instructions with the same title) */
  readonly documents: ReadonlyMap<string, readonly string[]>;
}

const normalizeWord = (word: string) => word.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');

function loadDrugDictionary(): DrugDictionary {
  const core = new Database(resolve(CONTENT, 'core.db'), { readonly: true });
  const pointers = new Map<string, string>();
  for (const row of core
    .query(
      "SELECT title, json_extract(metadata_json, '$.targetDocumentId') AS target FROM documents WHERE json_extract(metadata_json, '$.catalogFamily') = 'medication'",
    )
    .all() as { title: string; target: string }[]) {
    pointers.set(row.title, row.target);
  }
  const names = new Map<string, Set<string>>();
  for (const row of core
    .query("SELECT alias, canonical_term AS canonical FROM aliases WHERE category = 'medication'")
    .all() as { alias: string; canonical: string }[]) {
    if (!pointers.has(row.canonical)) continue;
    if (!/^[\p{L}-]{5,}$/u.test(row.alias)) continue;
    const key = normalizeWord(row.alias);
    names.set(key, (names.get(key) ?? new Set()).add(row.canonical));
  }
  core.close();
  const medications = new Database(resolve(CONTENT, 'medications.db'), { readonly: true });
  const allmedByTitle = new Map<string, string[]>();
  for (const row of medications.query('SELECT id, title FROM documents').all() as {
    id: string;
    title: string;
  }[]) {
    const key = normalizeWord(row.title);
    allmedByTitle.set(key, [...(allmedByTitle.get(key) ?? []), row.id]);
  }
  medications.close();
  const documents = new Map<string, readonly string[]>();
  for (const [title, target] of pointers) {
    documents.set(title, [target, ...(allmedByTitle.get(normalizeWord(title)) ?? [])]);
  }
  return { names, documents };
}

/**
 * Registry names that are ordinary words in a forum question (infections, tonsils, calcium, the
 * word «противопоказания», ...). Found by reviewing the 120 most frequent matches in the forum
 * sample; matching them would label questions about the thing, not the product.
 */
const NOT_A_DRUG_NAME = new Set([
  'инфекции',
  'миндалин',
  'противопоказания',
  'миокард',
  'баланс',
  'столбняка',
  'железо',
  'кальций',
  'магний',
  'калий',
  'кислород',
  'желчь',
  'мочевина',
  'глюкоза',
  'кандид',
  'амилаза',
  'фибриноген',
  // Hormones, caffeine and flora are mostly laboratory or lifestyle topics in these questions.
  'прогестерон',
  'тестостерон',
  'эстрадиол',
  'кофеин',
  'никотин',
  'лактобактерии',
  // A trade name that is a prefix of the first name «Александр».
  'алексан',
]);

interface DrugMatch {
  readonly titles: ReadonlySet<string>;
  /** A registered name that points at several products (a trade name shared by many combinations). */
  readonly ambiguous: boolean;
}

function matchDrugs(text: string, dictionary: DrugDictionary): DrugMatch {
  const titles = new Set<string>();
  let ambiguous = false;
  for (const word of text.match(/[\p{L}-]{5,}/gu) ?? []) {
    const token = normalizeWord(word);
    // Russian inflection: «Ларипронта», «Мезима» — the registered name plus up to 3 letters.
    for (let length = token.length; length >= Math.max(5, token.length - 3); length -= 1) {
      const key = token.slice(0, length);
      if (NOT_A_DRUG_NAME.has(key)) break;
      const canonical = dictionary.names.get(key);
      if (!canonical) continue;
      // «парацетамол» is the МНН itself even though 55 combinations carry it as a component.
      const exact = [...canonical].filter((title) => normalizeWord(title) === key);
      if (exact.length === 1) titles.add(exact[0] as string);
      else if (canonical.size <= 2) for (const title of canonical) titles.add(title);
      else ambiguous = true;
    }
  }
  return { titles, ambiguous };
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  // The head slice ends mid-row: the unfinished last row is dropped on purpose.
  return rows;
}

function forumDrugQueries(): RetrievalQuery[] {
  const dictionary = loadDrugDictionary();
  const rows = parseCsv(readFileSync(resolve(RAW, 'forum/medical_qa_ru_data.head.csv'), 'utf8'));
  const header = rows[0] ?? [];
  const themeIndex = header.indexOf('theme');
  const descIndex = header.indexOf('desc');
  const answerIndex = header.indexOf('ans');
  if (themeIndex < 0 || descIndex < 0 || answerIndex < 0)
    throw new Error('Unexpected forum CSV header.');
  const candidates: (Candidate & { names: string[]; style: RetrievalQuery['style'] })[] = [];
  const seen = new Set<string>();
  for (const [index, row] of rows.slice(1).entries()) {
    if (row.length !== header.length) continue;
    const theme = clean(row[themeIndex] ?? '');
    const description = clean(row[descIndex] ?? '');
    const answer = clean(row[answerIndex] ?? '');
    // The post must have been answered (a real question) and be neither empty nor a wall of text.
    if (answer.length < 20 || description.length < 20) continue;
    const themeMatch = matchDrugs(theme, dictionary);
    const titleStyle = themeMatch.titles.size > 0 && !themeMatch.ambiguous;
    const query = titleStyle ? theme : truncate(description, 300);
    const style = titleStyle ? 'drug-question-title' : 'drug-question-text';
    const match = titleStyle ? themeMatch : matchDrugs(query, dictionary);
    if (match.ambiguous || match.titles.size !== 1 || query.length < 8) continue;
    if (seen.has(query.toLowerCase())) continue;
    seen.add(query.toLowerCase());
    const [title] = [...match.titles] as [string];
    const documents = dictionary.documents.get(title) ?? [];
    candidates.push({
      recordId: `row-${index + 1}`,
      query,
      split: parseInt(order(`row-${index + 1}`).slice(0, 4), 16) % 2 === 0 ? 'dev' : 'test',
      goldCodes: [],
      relevant: documents.map((documentId) => ({
        documentId,
        grade: 3 as const,
        kind: 'medication' as const,
      })),
      hasRecommendation: false,
      names: [title],
      style,
    });
  }
  // Half of the rows come from title-style questions («Применение Ларипронта»), half from the text.
  const chosen: RetrievalQuery[] = [];
  for (const style of ['drug-question-title', 'drug-question-text'] as const) {
    for (const split of ['dev', 'test'] as const) {
      const pool = candidates
        .filter((candidate) => candidate.style === style && candidate.split === split)
        .toSorted((left, right) => order(left.recordId).localeCompare(order(right.recordId)));
      const perMedication = new Map<string, number>();
      const taken: typeof pool = [];
      for (const candidate of pool) {
        const name = candidate.names[0] ?? '';
        if ((perMedication.get(name) ?? 0) >= 2) continue;
        perMedication.set(name, (perMedication.get(name) ?? 0) + 1);
        taken.push(candidate);
        if (taken.length === 25) break;
      }
      for (const candidate of taken) {
        chosen.push({
          id: `forum-drug-${candidate.recordId}`,
          query: candidate.query,
          source: 'forum-drug',
          sourceRecordId: candidate.recordId,
          split,
          style,
          machineTranslated: false,
          goldCodes: [],
          goldNames: candidate.names,
          relevant: candidate.relevant,
        });
      }
    }
  }
  return chosen;
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), 1)).trim();
}

// ---------------------------------------------------------------------------------------------

function sourceFiles(directory: string) {
  const files: { path: string; sha256: string; bytes: number }[] = [];
  for (const item of DOWNLOADS) {
    const full = resolve(RAW, item.path);
    if (!existsSync(full) || !item.path.startsWith(directory)) continue;
    const bytes = readFileSync(full);
    files.push({
      path: `data/raw/query-datasets/${item.path}`,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
    });
  }
  return files;
}

function write(path: string, benchmark: RetrievalBenchmark): void {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(benchmark, null, 1)}\n`);
  // Tracked output must already match `biome check`; data/ is ignored by Biome.
  if (!path.startsWith(resolve(ROOT, 'data'))) {
    const formatted = spawnSync('bunx', ['biome', 'format', '--write', path], { cwd: ROOT });
    if (formatted.status !== 0) throw new Error(`biome format: ${formatted.stderr.toString()}`);
  }
  const counts = new Map<string, number>();
  for (const query of benchmark.queries) {
    const key = `${query.source}/${query.split}/${query.style}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  console.log(`[build] ${benchmark.queries.length} queries → ${path}`);
  for (const [key, count] of [...counts].toSorted()) console.log(`        ${key}: ${count}`);
}

if (process.argv.includes('--fetch')) await fetchSources();

const corpus = loadCorpus();
const corpusFacts = {
  clinicalRecommendations: corpus.recommendations.size,
  mkbCards: corpus.mkbCards.size,
  note: 'Relevance is frozen against the databases of 2026-10-02: every КР module of data/build/release-clinical plus the 30 new editions of data/build/core-clinical-new-editions, with ICD codes from the registry snapshot data/raw/official-clinical-registry/2026-10-02; МКБ cards of apps/app/public/content/mkb.db.',
};
const builtAt = new Date().toISOString();

const icdQueries = [
  ...sample(rumedprimeCandidates(corpus), 100, 0.7, 4).map((candidate) =>
    toQuery('rumedprime', 'complaint', candidate),
  ),
  ...sample(ruccodCandidates(corpus), 100, 0.7, 4).map((candidate) =>
    toQuery('ruccod', 'diagnosis-phrase', candidate),
  ),
];
write(resolve(ROOT, 'tools/benchmarks/retrieval-icd-queries.json'), {
  schemaVersion: 1,
  id: 'minimed-retrieval-icd-v1',
  description:
    'Patient complaints and doctor diagnosis phrases (native Russian, real clinical text) → ICD-10 code → relevant clinical recommendations and МКБ cards. Dev/test split from the sources; test is not for tuning.',
  builtAt,
  corpus: corpusFacts,
  sources: [SOURCES.rumedprime, SOURCES.ruccod],
  sourceFiles: [...sourceFiles('rumedprime'), ...sourceFiles('ruccod')],
  queries: icdQueries,
});
if (existsSync(resolve(RAW, 'forum/medical_qa_ru_data.head.csv'))) {
  write(resolve(ROOT, 'data/build/retrieval-drug-forum-queries.json'), {
    schemaVersion: 1,
    id: 'minimed-retrieval-drug-forum-v1',
    description:
      'Forum questions that name one registered medication (trade name or МНН) → its ЕСКЛП МНН document and Allmed instruction. Dataset licence unknown: local only, never committed.',
    builtAt,
    corpus: corpusFacts,
    sources: [SOURCES['forum-drug']],
    sourceFiles: sourceFiles('forum'),
    queries: forumDrugQueries(),
  });
}
