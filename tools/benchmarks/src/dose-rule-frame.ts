// RX2: the frame the dose-rule precision tools draw from. It joins the build-time dose-rule index
// (rules = numbers + offsets, no text) with the decoded instruction modules (the text), so a rule can be
// shown next to the sentence it was read from, and judged. Used by the sampler and the runner; needs
// DOSE_DECODED_DIR (a directory of `<module id>.db`).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  type DoseRule,
  type DoseRuleDocument,
  GROUP_ADOLESCENT,
  GROUP_ADULT,
  GROUP_CHILD,
  GROUP_INFANT,
  GROUP_NEWBORN,
} from '@localmed/contracts';

import { SECTION_ID_PREFIX } from '../../../apps/app/src/features/drug-interactions/interaction-index';
import {
  canonicalSectionText,
  sectionChecksum,
} from '../../../apps/app/src/features/drug-interactions/interaction-text';
import {
  createDoseIndex,
  type DoseIndex,
  parseDoseRuleIndex,
} from '../../../apps/app/src/features/prescription/dose-index';
import { REPOSITORY_ROOT } from './real-corpus';

export const INDEX_PATH = resolve(
  REPOSITORY_ROOT,
  'apps/app/src/features/prescription/data/dose-rules-index.json',
);

export function loadIndex(path = INDEX_PATH): DoseIndex {
  return createDoseIndex(parseDoseRuleIndex(JSON.parse(readFileSync(path, 'utf8'))));
}

export type PopulationClass = 'adult' | 'child' | 'unstated' | 'condition' | 'other';

interface ModuleDatabase {
  query<Row, Params extends unknown[]>(
    sql: string,
  ): { all(...params: Params): Row[]; get(...params: Params): Row | null };
  close(): void;
}
const { Database } = (await import('bun:sqlite' as string)) as unknown as {
  Database: new (path: string, options: { readonly: boolean }) => ModuleDatabase;
};

const ADULT_DAYS = Math.round(18 * 365.25);
const CHILD_BITS = GROUP_CHILD | GROUP_NEWBORN | GROUP_INFANT | GROUP_ADOLESCENT;

export function populationClassOf(rule: DoseRule): PopulationClass {
  if ((rule.c ?? 0) !== 0) return 'condition';
  const group = rule.g ?? 0;
  const child = (group & CHILD_BITS) !== 0 || (rule.p1 !== undefined && rule.p1 <= ADULT_DAYS);
  const adult = (group & GROUP_ADULT) !== 0 || (rule.p0 !== undefined && rule.p0 >= ADULT_DAYS);
  if (child && !adult) return 'child';
  if (adult && !child) return 'adult';
  if (group === 0 && rule.p0 === undefined && rule.p1 === undefined && rule.w0 === undefined) {
    return rule.w1 === undefined ? 'unstated' : 'child';
  }
  return 'other';
}

export interface FrameRule {
  /** `<document id>#<section>:<start>:<kind>`: stable while the parser and the module stay the same. */
  readonly key: string;
  readonly documentId: string;
  readonly cardSlug: string;
  readonly essential: boolean;
  readonly module: string;
  readonly rule: DoseRule;
  readonly population: PopulationClass;
  /** The sentence as printed in the canonical text of its section. */
  readonly sentence: string;
  /** SHA-256 of the exact canonical slice. */
  readonly sentenceSha256: string;
  /** The heading or earlier sentence the rule took its population from. */
  readonly headingText: string | null;
  /** Printed lines around the sentence, the sentence marked with ⟦ ⟧. */
  readonly window: string;
  readonly sectionTitle: string;
}

export function ruleKeyOf(documentId: string, rule: DoseRule): string {
  return `${documentId}#${rule.s}:${rule.a}:${rule.k}`;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export interface SectionText {
  readonly text: string;
  readonly title: string;
}

/** Reads the canonical text of index sections from the decoded modules. */
export class ModuleTexts {
  private readonly databases = new Map<string, ModuleDatabase>();

  constructor(
    private readonly directory: string,
    private readonly index: DoseIndex,
  ) {
    if (!existsSync(directory)) throw new Error(`DOSE_DECODED_DIR ${directory} does not exist.`);
  }

  private database(moduleId: string): ModuleDatabase {
    let database = this.databases.get(moduleId);
    if (!database) {
      database = new Database(join(this.directory, `${moduleId}.db`), { readonly: true });
      this.databases.set(moduleId, database);
    }
    return database;
  }

  /** Canonical text of one section of an indexed document; the checksum is verified. */
  section(documentId: string, sectionIndex: number): SectionText {
    const document = this.index.asset.documents[documentId] as DoseRuleDocument;
    const entry = document.sec[sectionIndex];
    if (!entry) throw new Error(`${documentId}: no section ${sectionIndex}`);
    const moduleId = this.index.asset.modules[document.m] as string;
    const database = this.database(moduleId);
    const id = `${SECTION_ID_PREFIX}${entry[0]}`;
    const chunks = database
      .query<{ original_text: string }, [string]>(
        'select original_text from chunks where section_id = ? order by order_index',
      )
      .all(id)
      .map((row) => row.original_text);
    const title =
      database.query<{ title: string }, [string]>('select title from sections where id = ?').get(id)
        ?.title ?? '';
    const text = canonicalSectionText(chunks).text;
    if (sectionChecksum(text) !== entry[1]) {
      throw new Error(`${documentId}: section ${entry[0]} differs from the index (rebuild it)`);
    }
    return { text, title };
  }

  close(): void {
    for (const database of this.databases.values()) database.close();
    this.databases.clear();
  }
}

const LINE_CONTEXT_BEFORE = 3;
const LINE_CONTEXT_AFTER = 2;
const WINDOW_CHARS_BEFORE = 600;
const WINDOW_CHARS_AFTER = 400;

export function windowOf(text: string, start: number, end: number): string {
  let from = start;
  let lines = 0;
  while (from > 0 && start - from < WINDOW_CHARS_BEFORE) {
    from -= 1;
    if (text.charAt(from) === '\n') {
      lines += 1;
      if (lines > LINE_CONTEXT_BEFORE) {
        from += 1;
        break;
      }
    }
  }
  let to = end;
  lines = 0;
  while (to < text.length && to - end < WINDOW_CHARS_AFTER) {
    if (text.charAt(to) === '\n') {
      lines += 1;
      if (lines > LINE_CONTEXT_AFTER) break;
    }
    to += 1;
  }
  const flat = (value: string): string => value.replace(/\n/gu, ' ⏎ ').replace(/ +/gu, ' ');
  return `${flat(text.slice(from, start))}⟦${flat(text.slice(start, end))}⟧${flat(text.slice(end, to))}`;
}

export function frameRule(
  index: DoseIndex,
  texts: ModuleTexts,
  documentId: string,
  rule: DoseRule,
  cardSlug: string,
  essential: boolean,
): FrameRule {
  const document = index.asset.documents[documentId] as DoseRuleDocument;
  const section = texts.section(documentId, rule.s);
  const slice = section.text.slice(rule.a, rule.b);
  return {
    key: ruleKeyOf(documentId, rule),
    documentId,
    cardSlug,
    essential,
    module: (index.asset.modules[document.m] ?? '').replace(
      /^minimed\.medications\.instructions\.|\.ru$/gu,
      '',
    ),
    rule,
    population: populationClassOf(rule),
    sentence: slice.replace(/\s+/gu, ' ').trim(),
    sentenceSha256: sha256(slice),
    headingText: rule.h
      ? section.text.slice(rule.h[0], rule.h[1]).replace(/\s+/gu, ' ').trim()
      : null,
    window: windowOf(section.text, rule.a, rule.b),
    sectionTitle: section.title,
  };
}

/** Every rule of the indexed documents of the ЖНВЛП cards, one entry per rule (no text read yet). */
export function essentialRuleRefs(index: DoseIndex): readonly {
  readonly documentId: string;
  readonly rule: DoseRule;
  readonly cardSlug: string;
}[] {
  const refs: { documentId: string; rule: DoseRule; cardSlug: string }[] = [];
  for (const [documentId, document] of Object.entries(index.asset.documents)) {
    const card = document.c
      .map((cardIndex) => index.asset.cards[cardIndex])
      .find((candidate) => candidate?.e === 1);
    if (!card) continue;
    for (const rule of document.rules) refs.push({ documentId, rule, cardSlug: card.s });
  }
  return refs;
}

/** mulberry32 seeded from a string: the draws are reproducible from the recorded seed. */
export function seededRandom(seed: string): () => number {
  let state = 0;
  for (const character of createHash('sha256').update(seed).digest().subarray(0, 4)) {
    state = (state << 8) | character;
  }
  state >>>= 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let at = copy.length - 1; at > 0; at -= 1) {
    const other = Math.floor(random() * (at + 1));
    [copy[at], copy[other]] = [copy[other] as T, copy[at] as T];
  }
  return copy;
}
