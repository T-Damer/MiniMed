/**
 * Finds the drugs a typed name stands for (CMP1), with the app's own medication search (scope
 * «Препараты», lookup mode, so the keyboard-layout and transliteration fallback of S3 applies). The
 * search is not changed: this module only maps the groups it returns to a substance card (a
 * ЕСКЛП МНН card) and, when the search found a trade name, to the product. A group counts as the
 * answer to a typed name only when the typed words begin words of its names (or the search itself
 * rewrote the query to a name of the corpus), so a disease or a symptom finds no drug.
 */
import type { MedicalCore, SearchResultGroup } from '@localmed/contracts';

import {
  cardDisplayName,
  cardSlugOfDocumentId,
} from '@/features/drug-interactions/drug-candidates';
import { nameWordStem } from '@/features/drug-interactions/mention-matcher';
import { namesCoverTypedWords } from '@/features/medication-safety/safety-candidates';
import { displayDrugName } from '@/features/medications/drug-screen';
import { ScopedMedicalCore } from '@/features/search/ScopedMedicalCore';

/** A drug found for a name: the substance card, and the trade name when the search found one. */
export interface FoundDrug {
  /** ЕСКЛП МНН card slug. */
  readonly slug: string;
  /** «Нурофен · Ибупрофен» or «Ибупрофен», as the search titles it. */
  readonly label: string;
  readonly product: string | null;
}

const ALLMED_PREFIX = 'drug.allmed.';
const MNN_PREFIX = 'esklp.mnn.';
const CHECKED_GROUPS = 6;
const WORD = /[a-zа-яё]{2,}/gu;

function wordsOf(text: string): readonly string[] {
  return text.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').match(WORD) ?? [];
}

async function searchGroups(
  core: MedicalCore,
  text: string,
  limit: number,
): Promise<{ groups: readonly SearchResultGroup[]; rewritten: boolean } | null> {
  const result = await new ScopedMedicalCore(core, 'medications').search({
    query: text,
    mode: 'lexical',
    analysisMode: 'lookup',
    filters: {},
    limit,
    includeSuggestions: false,
  });
  if (!result.ok) return null;
  return { groups: result.value.groups, rewritten: result.value.queryRewrite !== undefined };
}

/** «Нурофен · ИБУПРОФЕН» → the product and the substance as the search titles them. */
function splitTitle(title: string): { product: string | null; substance: string } {
  const [first, second] = title.split(' · ');
  if (second === undefined) return { product: null, substance: displayDrugName(title) };
  return { product: displayDrugName(first ?? ''), substance: displayDrugName(second) };
}

async function drugOfGroup(
  core: MedicalCore,
  group: Pick<SearchResultGroup, 'documentId' | 'title'>,
): Promise<{ drug: FoundDrug; names: readonly string[] } | null> {
  const slug = cardSlugOfDocumentId(group.documentId);
  if (slug !== null) {
    const { product, substance } = splitTitle(group.title);
    return {
      drug: {
        slug,
        label: product ? `${product} · ${substance}` : substance,
        product,
      },
      names: [group.title, cardDisplayName(slug)],
    };
  }
  if (group.documentId.startsWith(ALLMED_PREFIX)) {
    const loaded = await core.getDocument(group.documentId);
    const linked = loaded.ok ? loaded.value.metadata['linkedMnnDocumentId'] : undefined;
    if (typeof linked !== 'string' || !linked.startsWith(MNN_PREFIX)) return null;
    const linkedSlug = linked.slice(MNN_PREFIX.length);
    const product = displayDrugName(group.title);
    return {
      drug: { slug: linkedSlug, label: `${product} · ${cardDisplayName(linkedSlug)}`, product },
      names: [group.title],
    };
  }
  return null;
}

function stemsOf(text: string): readonly string[] {
  return wordsOf(text).flatMap((word) => nameWordStem(word) ?? []);
}

/**
 * Every typed word is, as a whole word (the same light stem), a word of one of the names: «эналаприла»
 * is the substance «эналаприл», not the longer «эналаприлат» that merely begins with it.
 */
function namesMatchWholeWords(names: readonly string[], typed: readonly string[]): boolean {
  const nameStems = new Set(names.flatMap(stemsOf));
  const typedStems = typed.flatMap((word) => nameWordStem(word) ?? []);
  return typedStems.length > 0 && typedStems.every((stem) => nameStems.has(stem));
}

interface Picked {
  readonly exact: FoundDrug | null;
  readonly whole: FoundDrug | null;
  readonly loose: FoundDrug | null;
}

async function pick(
  core: MedicalCore,
  text: string,
  typed: readonly string[],
): Promise<Picked | null> {
  const searched = await searchGroups(core, text, 24);
  if (!searched) return null;
  const found = (
    await Promise.all(
      searched.groups.slice(0, CHECKED_GROUPS).map((group) => drugOfGroup(core, group)),
    )
  ).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  const whole = found.filter((entry) => namesMatchWholeWords(entry.names, typed));
  const exact = whole.find(
    (entry) => stemsOf(entry.names[entry.names.length - 1] ?? '').length === typed.length,
  );
  const loose = found.find(
    (entry) => searched.rewritten || namesCoverTypedWords(entry.names, typed),
  );
  return {
    exact: exact?.drug ?? null,
    whole: whole[0]?.drug ?? null,
    loose: loose?.drug ?? null,
  };
}

/**
 * The drug for a typed name, or null when no group of the search carries the typed words. Among the
 * first groups the one whose names hold the typed words as whole words and have no other words
 * wins («эналаприл», not «эналаприлат» that merely begins with it, and not a combination); then any
 * other group with the whole words; then a group whose names merely begin with the typed words
 * («нурофе»). A name in an oblique case («лизиноприла») that the search does not find as the
 * single substance is looked up again as its stem.
 */
export async function resolveDrugName(core: MedicalCore, name: string): Promise<FoundDrug | null> {
  const text = name.trim();
  if (text.length < 3) return null;
  const typed = wordsOf(text);
  const first = await pick(core, text, typed);
  if (first?.exact) return first.exact;
  const stems = typed.map((word) => nameWordStem(word) ?? word);
  if (stems.join(' ') !== typed.join(' ')) {
    const second = await pick(core, stems.join(' '), typed);
    if (second?.exact) return second.exact;
    return first?.whole ?? second?.whole ?? first?.loose ?? second?.loose ?? null;
  }
  return first?.whole ?? first?.loose ?? null;
}

/** Drugs for the picker: every distinct substance or product among the first groups, best first. */
export async function findDrugs(
  core: MedicalCore,
  query: string,
  limit = 8,
): Promise<readonly FoundDrug[]> {
  const text = query.trim();
  if (text.length < 2) return [];
  const searched = await searchGroups(core, text, 24);
  if (!searched) return [];
  const found = await Promise.all(
    searched.groups.slice(0, limit + 4).map((group) => drugOfGroup(core, group)),
  );
  const seen = new Set<string>();
  const drugs: FoundDrug[] = [];
  for (const entry of found) {
    if (!entry) continue;
    const key = `${entry.drug.slug}|${entry.drug.product ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    drugs.push(entry.drug);
    if (drugs.length >= limit) break;
  }
  return drugs;
}

/** `slug` or `slug|Trade name`: how the tool's address carries a drug (`c=`). */
export function encodeDrug(drug: Pick<FoundDrug, 'slug' | 'product'>): string {
  return drug.product ? `${drug.slug}|${drug.product}` : drug.slug;
}

export function decodeDrug(value: string): {
  readonly slug: string;
  readonly product: string | null;
} {
  const at = value.indexOf('|');
  if (at < 0) return { slug: value, product: null };
  const product = value.slice(at + 1).trim();
  return { slug: value.slice(0, at), product: product === '' ? null : product };
}
