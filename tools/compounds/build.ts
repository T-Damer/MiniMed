/**
 * Assembles `apps/app/src/features/medications/compounds/compound-facts.json` from the cached raw
 * data under `data/raw/compounds/` (see README in docs/DRUG_KNOWLEDGE_PIPELINE.md «Compound facts»).
 *
 *   bun tools/compounds/extract-actives.ts && bun tools/compounds/extract-excipients.ts
 *   bun tools/compounds/fetch-wikidata-actives.ts && bun tools/compounds/fetch-chembl.ts
 *   bun tools/compounds/fetch-wikidata-excipients.ts
 *   bun tools/compounds/build.ts [--report [--limit N]]
 *
 * Deterministic: the same raw files give the same output. `--report` prints coverage and the
 * worklists (untranslated roles, unmatched frequent excipient names).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildCompoundIndex,
  type CompoundBasis,
  lookupNormalizedCompound,
  normalizeCompoundName,
  parseCompoundFacts,
} from '../../apps/app/src/features/medications/compounds/compound-facts';
import {
  dropHydration,
  dropSalt,
} from '../../apps/app/src/features/medications/compounds/compound-name';
import { agrees, loadNsiNames } from './atc-trust';
import { type Chebi, loadChebi, roleNames } from './chebi';
import { readCuratedExcipients, readExtraActives } from './curated';
import { type BuildFacts, type BuildRecord, type BuildTarget, encodeCompoundFacts } from './encode';
import type { WdItem } from './wikidata-items';

const ROOT = join(import.meta.dirname, '..', '..');
const RAW = join(ROOT, 'data/raw/compounds');
const OUT = join(ROOT, 'apps/app/src/features/medications/compounds/compound-facts.json');
const REPORT = process.argv.includes('--report');
const limitFlag = process.argv.indexOf('--limit');
const REPORT_LIMIT = limitFlag >= 0 ? Number(process.argv[limitFlag + 1]) : 150;

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const lower = (text: string) =>
  text.toLowerCase().replaceAll('ё', 'е').replace(/\s+/gu, ' ').trim();
const qNumber = (id: string) => Number(id.slice(1));

interface Relation {
  item: string;
  property?: 'role' | 'use';
  value: string;
  ru?: string | undefined;
  en?: string | undefined;
  gene?: string | undefined;
}
interface Universe {
  substances: {
    ru: string;
    key: string;
    cards: number;
    singleCards: number;
    atcFromCards: string[];
    atcFromNames: string[];
    en: string[];
    synonyms: string[];
  }[];
}
interface WikidataActives {
  retrieved: string;
  items: WdItem[];
  byAtc: Record<string, string[]>;
  byName: Record<string, string[]>;
  roles: Relation[];
  targets: Relation[];
}
interface WikidataExcipients {
  retrieved: string;
  items: WdItem[];
  byName: Record<string, { label: string[]; alias: string[] }>;
  relations: Relation[];
}
interface Chembl {
  retrieved: string;
  parentOf: Record<string, string>;
  mechanisms: { molecule: string; moa: string; action: string; target: string | null }[];
  targets: Record<string, { name: string; organism: string; type: string; genes: string[] }>;
}

const universe = readJson<Universe>(join(RAW, 'actives-universe.json'));
const wdActives = readJson<WikidataActives>(join(RAW, 'wikidata-actives.json'));
const wdExcipients = readJson<WikidataExcipients>(join(RAW, 'wikidata-excipients.json'));
const chembl = readJson<Chembl>(join(RAW, 'chembl-mechanisms.json'));
const chebi: Chebi = await loadChebi();
const excipientItems = readJson<{
  totalOccurrences: number;
  items: {
    key: string;
    documents: number;
    roles: Record<string, number>;
    spellings: { text: string }[];
  }[];
}>(join(RAW, 'excipient-items.json'));

const roleGlossary = readJson<[string, string][]>(join(import.meta.dirname, 'role-glossary.json'));
const functionLabels = readJson<Record<string, string>>(
  join(import.meta.dirname, 'excipient-functions.json'),
);
const functionSources = readJson<Record<string, string[]>>(
  join(import.meta.dirname, 'function-sources.json'),
);
const actionRu = readJson<Record<string, string>>(join(import.meta.dirname, 'action-types.json'));
const moaTexts = readJson<Record<string, string>>(join(import.meta.dirname, 'moa-texts.json'));
const nsi = loadNsiNames();

const items = new Map<string, WdItem>();
for (const item of [...wdActives.items, ...wdExcipients.items]) {
  const known = items.get(item.id);
  items.set(item.id, known ? { ...known, ...item } : item);
}

const atcHints = readJson<Record<string, string[]>>(
  join(import.meta.dirname, 'atc-role-hints.json'),
);
const roleRank = new Map(roleGlossary.map(([en], index) => [lower(en), index]));
const roleRu = new Map(roleGlossary.map(([en, ru]) => [lower(en), ru]));
const missingRoles = new Map<string, number>();

function score(item: WdItem, nsiEn?: string): number {
  return (
    (nsiEn && item.en && lower(item.en) === nsiEn ? 8 : 0) +
    (item.smiles.length || item.isomeric.length ? 4 : 0) +
    (item.chebi ? 2 : 0) +
    (item.en ? 1 : 0)
  );
}

function best(ids: Iterable<string>, nsiEn?: string): WdItem | undefined {
  let chosen: WdItem | undefined;
  let chosenScore = -1;
  for (const id of [...new Set(ids)].sort((a, b) => qNumber(a) - qNumber(b))) {
    const item = items.get(id);
    if (!item) continue;
    const value = score(item, nsiEn);
    if (value > chosenScore) {
      chosen = item;
      chosenScore = value;
    }
  }
  return chosen;
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');

const SUBSCRIPTS = '₀₁₂₃₄₅₆₇₈₉';
const asciiFormula = (formula: string) =>
  [...formula]
    .map((char) => (SUBSCRIPTS.includes(char) ? String(SUBSCRIPTS.indexOf(char)) : char))
    .join('')
    .replaceAll('·', '.');

const MAX_SMILES = 250;
let smilesTooLong = 0;
function structure(item: WdItem): { smiles?: string; formula?: string } {
  const smiles = item.smiles[0] ?? item.isomeric[0];
  if (smiles && smiles.length > MAX_SMILES) smilesTooLong += 1;
  return {
    ...(smiles && smiles.length <= MAX_SMILES ? { smiles } : {}),
    ...(item.formula ? { formula: asciiFormula(item.formula) } : {}),
  };
}

// --- roles ------------------------------------------------------------------------------------

function pharmacologicalRoles(
  item: WdItem,
  atcCodes: readonly string[],
  moaRoles: readonly string[],
): { roles: string[]; basis?: CompoundBasis } {
  const found = new Map<string, { rank: number; basis: CompoundBasis }>();
  const add = (en: string, basis: CompoundBasis) => {
    // Only roles of the reviewed glossary are shown: ChEBI and Wikidata also hold metabolite,
    // toxicity and industrial roles that do not belong on a drug card.
    const key = lower(en);
    const label = roleRu.get(key);
    if (!label) {
      missingRoles.set(en, (missingRoles.get(en) ?? 0) + 1);
      return;
    }
    const rank = roleRank.get(key) ?? 10_000;
    const known = found.get(label);
    if (!known || rank < known.rank) found.set(label, { rank, basis: known?.basis ?? basis });
  };
  for (const name of roleNames(chebi, item.chebi)) add(name, 'chebi');
  for (const label of moaRoles)
    if (!found.has(label)) found.set(label, { rank: 5000, basis: 'chembl' });
  for (const role of wdActives.roles) {
    if (role.item === item.id) add(role.en ?? '', 'wikidata');
  }
  // Roles that fit the substance's own ATC group come first, then the glossary order.
  const hinted = new Set(
    atcCodes.flatMap((code) =>
      (atcHints[code.slice(0, 3)] ?? []).map((role) => roleRu.get(lower(role))),
    ),
  );
  const ordered = [...found.entries()].sort(
    (a, b) =>
      Number(hinted.has(b[0])) - Number(hinted.has(a[0])) ||
      a[1].rank - b[1].rank ||
      a[0].localeCompare(b[0], 'ru'),
  );
  const top = ordered.slice(0, 3);
  const basis = top.some(([, value]) => value.basis === 'chebi')
    ? 'chebi'
    : top.length
      ? 'wikidata'
      : undefined;
  return { roles: top.map(([label]) => label), ...(basis ? { basis } : {}) };
}

// --- targets ----------------------------------------------------------------------------------

const mechanismsByParent = new Map<string, typeof chembl.mechanisms>();
for (const mechanism of chembl.mechanisms) {
  mechanismsByParent.set(mechanism.molecule, [
    ...(mechanismsByParent.get(mechanism.molecule) ?? []),
    mechanism,
  ]);
}
const unknownActions = new Set<string>();

function targetsOf(item: WdItem): { targets: BuildTarget[]; moaRoles: string[] } {
  const result: BuildTarget[] = [];
  const moaRoles: string[] = [];
  const seen = new Set<string>();
  const push = (target: BuildTarget) => {
    // A target is the same when all its genes (or, without genes, its name) were already listed.
    const keys = (target.g ? target.g.split('/') : [target.n]).map((key) => key.toLowerCase());
    if (keys.every((key) => seen.has(key))) return;
    for (const key of keys) seen.add(key);
    result.push(target);
  };
  const parent = item.chembl ? (chembl.parentOf[item.chembl] ?? item.chembl) : undefined;
  for (const mechanism of parent ? (mechanismsByParent.get(parent) ?? []) : []) {
    const target = mechanism.target ? chembl.targets[mechanism.target] : undefined;
    const action = actionRu[mechanism.action];
    if (mechanism.action && !action) unknownActions.add(mechanism.action);
    if (!target) {
      // A mechanism without a target («Laxative», «Supplement») is a role, not a target.
      const role = moaTexts[mechanism.moa];
      if (role && !moaRoles.includes(role)) moaRoles.push(role);
      continue;
    }
    push({
      n: target.name,
      ...(target.genes.length ? { g: target.genes.slice(0, 2).join('/') } : {}),
      ...(action ? { a: action } : {}),
    });
  }
  for (const row of wdActives.targets) {
    if (row.item !== item.id) continue;
    push({ n: row.ru ?? row.en ?? row.value, ...(row.gene ? { g: row.gene } : {}) });
  }
  return { targets: result.slice(0, 3), moaRoles };
}

// --- actives ----------------------------------------------------------------------------------

interface Group {
  item: WdItem;
  names: Set<string>;
  synonyms: Set<string>;
  atcFromCards: Set<string>;
  atcFromNames: Set<string>;
  cards: number;
}
const groups = new Map<string, Group>();
const extraActives = new Map(readExtraActives().map((entry) => [lower(entry.ru), entry]));
const unmatchedActives: string[] = [];

let rejectedCodes = 0;

for (const substance of universe.substances) {
  // An item found by ATC code is used only when a name confirms it (see atc-trust.ts).
  const candidates: string[] = [];
  const trusted = new Set<string>();
  for (const code of new Set([...substance.atcFromNames, ...substance.atcFromCards])) {
    const nsiAgrees =
      substance.atcFromNames.includes(code) || agrees(nsi.get(code)?.ru, substance.ru);
    for (const id of wdActives.byAtc[code] ?? []) {
      if (nsiAgrees || agrees(items.get(id)?.ru, substance.ru)) {
        candidates.push(id);
        trusted.add(code);
      }
    }
    if (!trusted.has(code)) rejectedCodes += 1;
  }
  const codes = [...trusted];
  const nsiEn = codes.map((code) => nsi.get(code)?.en).find(Boolean);
  if (!candidates.length) {
    for (const en of substance.en) candidates.push(...(wdActives.byName[`en:${en}`] ?? []));
  }
  if (!candidates.length) candidates.push(...(wdActives.byName[`ru:${substance.ru}`] ?? []));
  const extra = extraActives.get(substance.ru);
  if (!candidates.length && extra) {
    for (const name of extra.en.split('/')) {
      const named = wdExcipients.byName[name.trim().toLowerCase()];
      candidates.push(...(named?.label ?? []), ...(named?.alias ?? []));
    }
  }
  const item = best(candidates, nsiEn);
  if (!item) {
    if (substance.singleCards) unmatchedActives.push(substance.ru);
    continue;
  }
  const group = groups.get(item.id) ?? {
    item,
    names: new Set<string>(),
    synonyms: new Set<string>(),
    atcFromCards: new Set<string>(),
    atcFromNames: new Set<string>(),
    cards: 0,
  };
  groups.set(item.id, group);
  group.names.add(substance.ru);
  for (const synonym of substance.synonyms) group.synonyms.add(synonym);
  for (const code of codes) group.atcFromCards.add(code);
  group.cards += substance.cards;
}

const compounds = new Map<string, BuildRecord>();
/** Wikidata item → key of an active substance, so that an excipient of the same item joins it. */
const aliasCandidates: { alias: string; key: string; curated: boolean }[] = [];
const usedKeys = new Set<string>();

function uniqueKey(base: string): string {
  let key = base || 'compound';
  for (let n = 2; usedKeys.has(key); n += 1) key = `${base}-${n}`;
  usedKeys.add(key);
  return key;
}

/** Wikidata capitalizes some labels («Diclofenac»); acronyms and proper nouns inside stay. */
function lowerFirst(text: string | undefined): string | undefined {
  return text && /^\p{Lu}\p{Ll}/u.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

const shortest = (names: Iterable<string>) =>
  [...names].sort((a, b) => a.length - b.length || a.localeCompare(b, 'ru'))[0] ?? '';

for (const group of [...groups.values()].sort((a, b) => qNumber(a.item.id) - qNumber(b.item.id))) {
  const { item } = group;
  const atcCodes = [...group.atcFromCards].sort();
  const nsiNames = atcCodes.flatMap((code) => nsi.get(code)?.ru ?? []);
  const ru = shortest(nsiNames.length ? nsiNames : group.names);
  const en = lowerFirst(item.en) ?? atcCodes.map((code) => nsi.get(code)?.en).find(Boolean);
  const mechanisms = targetsOf(item);
  const { targets } = mechanisms;
  const { roles, basis: roleBasis } = pharmacologicalRoles(item, atcCodes, mechanisms.moaRoles);
  const functionBasis: CompoundBasis | undefined =
    roleBasis ?? (targets.length ? 'chembl' : undefined);
  const hasData = Boolean(
    item.smiles.length || item.isomeric.length || roles.length || targets.length,
  );
  if (!hasData) continue;
  const key = uniqueKey(slug(en ?? item.id.toLowerCase()));
  compounds.set(key, {
    ru,
    ...(en ? { en } : {}),
    kind: 'active',
    ...structure(item),
    ...(atcCodes.length ? { atc: atcCodes.slice(0, 4) } : {}),
    ...(roles.length ? { roles } : {}),
    ...(targets.length ? { targets } : {}),
    basis: functionBasis ?? 'wikidata',
    wd: item.id,
    ...(item.chebi ? { chebi: item.chebi } : {}),
    ...(item.cid ? { cid: item.cid } : {}),
    ...(item.chembl ? { chembl: item.chembl } : {}),
  });
  for (const name of [...group.names, ...nsiNames, ...(item.ru ? [item.ru] : [])]) {
    aliasCandidates.push({ alias: name, key, curated: false });
  }
  for (const synonym of group.synonyms)
    aliasCandidates.push({ alias: synonym, key, curated: false });
}

// --- excipients -------------------------------------------------------------------------------

const excipientRelations = new Map<string, Relation[]>();
for (const relation of wdExcipients.relations) {
  excipientRelations.set(relation.item, [
    ...(excipientRelations.get(relation.item) ?? []),
    relation,
  ]);
}
const pins = (() => {
  try {
    return readJson<Record<string, string>>(join(import.meta.dirname, 'wikidata-pins.json'));
  } catch {
    return {} as Record<string, string>;
  }
})();

function sourceFunctions(item: WdItem | undefined): {
  ids: Set<string>;
  basis?: CompoundBasis | undefined;
} {
  const ids = new Set<string>();
  let basis: CompoundBasis | undefined;
  if (!item) return { ids };
  const take = (label: string | undefined, from: CompoundBasis) => {
    for (const id of functionSources[lower(label ?? '')] ?? []) {
      ids.add(id);
      basis ??= from;
    }
  };
  for (const name of roleNames(chebi, item.chebi)) take(name, 'chebi');
  for (const relation of excipientRelations.get(item.id) ?? []) take(relation.en, 'wikidata');
  return { ids, basis };
}

let functionsFromSource = 0;
let functionsCurated = 0;
const unresolvedExcipients: string[] = [];

const activeNames = new Map<string, string>();
for (const { alias, key } of aliasCandidates) {
  const normalized = normalizeCompoundName(alias);
  if (normalized && !activeNames.has(normalized)) activeNames.set(normalized, key);
}
for (const [key, record] of compounds) {
  for (const name of [record.ru, record.en]) {
    const normalized = name ? normalizeCompoundName(name) : '';
    if (normalized && !activeNames.has(normalized)) activeNames.set(normalized, key);
  }
}

for (const entry of readCuratedExcipients()) {
  const names = entry.en.split('/').map((name) => name.trim().toLowerCase());
  const candidates = names.flatMap((name) => {
    const bucket = wdExcipients.byName[name];
    return bucket ? [...bucket.label, ...bucket.alias] : [];
  });
  const pinned = pins[entry.id];
  const item = pinned ? items.get(pinned) : best(candidates);
  if (!item) unresolvedExcipients.push(entry.id);
  const curatedIds = entry.functions.map((id) => {
    if (!functionLabels[id]) throw new Error(`excipients.curated.tsv: unknown function ${id}`);
    return id;
  });
  const fromSource = sourceFunctions(item);
  const allIds = [...new Set([...fromSource.ids, ...curatedIds])];
  const curatedOnly = allIds.filter((id) => !fromSource.ids.has(id));
  functionsFromSource += allIds.length - curatedOnly.length;
  functionsCurated += curatedOnly.length;
  const functions = allIds.map((id) => functionLabels[id] as string);
  const basis: CompoundBasis = curatedOnly.length ? 'curated' : (fromSource.basis ?? 'curated');
  // An excipient joins an active substance only when they share a name: «глицерин» is both, while
  // «полиэтиленоксид» stays apart from «макрогол» although Wikidata gives them one item.
  const existingKey =
    [entry.ru, ...entry.aliases]
      .map((name) => activeNames.get(normalizeCompoundName(name)))
      .find((key) => key !== undefined) ?? (compounds.has(entry.id) ? entry.id : undefined);
  if (existingKey) {
    const existing = compounds.get(existingKey) as BuildRecord;
    compounds.set(existingKey, {
      ...existing,
      kind: 'both',
      functions,
      basis: existing.roles || existing.targets ? existing.basis : basis,
    });
    for (const alias of [entry.ru, ...entry.aliases]) {
      aliasCandidates.push({ alias, key: existingKey, curated: true });
    }
    continue;
  }
  const key = uniqueKey(entry.id);
  compounds.set(key, {
    ru: entry.ru,
    en: names[0] as string,
    kind: 'excipient',
    ...(item ? structure(item) : {}),
    functions,
    basis,
    ...(item ? { wd: item.id } : {}),
    ...(item?.chebi ? { chebi: item.chebi } : {}),
    ...(item?.cid ? { cid: item.cid } : {}),
  });
  for (const alias of [entry.ru, ...entry.aliases])
    aliasCandidates.push({ alias, key, curated: true });
}

// --- aliases ----------------------------------------------------------------------------------

const owners = new Map<string, string>();
for (const [key, record] of [...compounds].sort((a, b) => a[0].localeCompare(b[0]))) {
  for (const name of [record.ru, record.en]) {
    const normalized = name ? normalizeCompoundName(name) : '';
    if (normalized && !owners.has(normalized)) owners.set(normalized, key);
  }
}
const aliases = new Map<string, string>();
const conflicts: string[] = [];
const GENERIC = new Set(['витамин', 'кислот', 'соль', 'масл', 'экстракт', 'вод']);
for (const candidate of [...aliasCandidates].sort(
  (a, b) => Number(b.curated) - Number(a.curated),
)) {
  const normalized = normalizeCompoundName(candidate.alias);
  if (!normalized || (!candidate.curated && GENERIC.has(normalized))) continue;
  if (!candidate.curated && normalized.split(' ').length === 1 && normalized.length < 5) continue;
  const owner = owners.get(normalized) ?? aliases.get(normalized);
  if (owner === candidate.key) continue;
  if (owner) {
    conflicts.push(`${normalized}: ${owner} vs ${candidate.key}`);
    continue;
  }
  // Hydration words are ignored by the runtime lookup, so such spellings need no entry.
  if (owners.get(dropHydration(normalized)) === candidate.key) continue;
  const record = compounds.get(candidate.key) as BuildRecord;
  // The runtime already strips salt words for active substances.
  if (
    record.kind !== 'excipient' &&
    dropSalt(normalized) === dropSalt(normalizeCompoundName(record.ru))
  ) {
    continue;
  }
  aliases.set(normalized, candidate.key);
}

// Entries of the reviewed list that no instruction of the corpus mentions are left out, to keep the
// chunk small; the list stays in excipients.curated.tsv and returns with the next corpus.
const tokenAliasesData = readJson<Record<string, string>>(
  join(import.meta.dirname, 'token-aliases.json'),
);
const preliminary = buildCompoundIndex(
  parseCompoundFacts(
    JSON.parse(
      encodeCompoundFacts({
        schemaVersion: 1,
        retrieved: '2000-01-01',
        sources: [],
        compounds: Object.fromEntries(compounds),
        aliases: Object.fromEntries(aliases),
        tokenAliases: tokenAliasesData,
      }),
    ),
  ),
);
const occurrences = new Map<string, number>();
for (const item of excipientItems.items) {
  const found = lookupNormalizedCompound(preliminary, item.key);
  if (found) occurrences.set(found.key, (occurrences.get(found.key) ?? 0) + item.documents);
}
const unseen = [...compounds]
  .filter(([key, record]) => record.kind === 'excipient' && !occurrences.has(key))
  .map(([key]) => key);
const protectedKeys = new Set(Object.values(tokenAliasesData));
for (const key of unseen) {
  if (protectedKeys.has(key)) continue;
  compounds.delete(key);
}
for (const [alias, key] of [...aliases]) if (!compounds.has(key)) aliases.delete(alias);
console.error(
  `excipient entries without a mention in the corpus, left out: ${unseen.filter((key) => !protectedKeys.has(key)).length}`,
);

const SOURCES: BuildFacts['sources'] = [
  {
    id: 'wikidata',
    label: 'Wikidata: SMILES, formula, identifiers, roles, protein targets',
    licence: 'CC0 1.0',
    url: 'https://www.wikidata.org/wiki/Wikidata:Licensing',
  },
  {
    id: 'chebi',
    label: `ChEBI ${chebi.version}: roles`,
    licence: 'CC BY 4.0',
    url: 'https://www.ebi.ac.uk/chebi/',
  },
  {
    id: 'chembl',
    label: 'ChEMBL: mechanisms of action and targets',
    licence: 'CC BY-SA 3.0',
    url: 'https://www.ebi.ac.uk/chembl/',
  },
  {
    id: 'nsi-atc',
    label: 'НСИ Минздрава, справочник АТХ: names of level-5 codes',
    licence: 'public registry',
    url: 'https://nsi.rosminzdrav.ru/',
  },
  {
    id: 'curated',
    label:
      'MiniMed reviewed excipient list: names, synonyms and functions not stated by the sources',
    licence: 'project',
    url: 'tools/compounds/excipients.curated.tsv',
  },
];

const retrieved = [wdActives.retrieved, wdExcipients.retrieved, chembl.retrieved]
  .sort()
  .at(-1) as string;
const facts: BuildFacts = {
  schemaVersion: 1,
  retrieved,
  sources: SOURCES,
  compounds: Object.fromEntries([...compounds].sort((a, b) => a[0].localeCompare(b[0]))),
  aliases: Object.fromEntries([...aliases].sort((a, b) => a[0].localeCompare(b[0], 'ru'))),
  tokenAliases: readJson<Record<string, string>>(join(import.meta.dirname, 'token-aliases.json')),
};
for (const [token, key] of Object.entries(facts.tokenAliases)) {
  if (!(key in facts.compounds))
    throw new Error(`token-aliases.json: ${token} → unknown compound ${key}`);
}
writeFileSync(OUT, encodeCompoundFacts(facts));

// --- report -----------------------------------------------------------------------------------

const index = buildCompoundIndex(parseCompoundFacts(JSON.parse(readFileSync(OUT, 'utf8'))));
const records = Object.values(facts.compounds);
const actives = records.filter((record) => record.kind !== 'excipient');
const excipients = records.filter((record) => record.kind !== 'active');
const bytes = Buffer.byteLength(readFileSync(OUT));
console.error(
  `compounds ${records.length} (actives ${actives.length}, excipients ${excipients.length}), aliases ${aliases.size}, ${bytes} bytes`,
);
console.error(
  `actives: smiles ${actives.filter((r) => r.smiles).length}, roles ${actives.filter((r) => r.roles?.length).length}, targets ${actives.filter((r) => r.targets?.length).length}; smiles dropped as too long: ${smilesTooLong}`,
);
console.error(
  `excipients: with smiles ${excipients.filter((r) => r.smiles).length}, with wd ${excipients.filter((r) => r.wd).length}; function labels from sources ${functionsFromSource}, curated ${functionsCurated}; basis ${JSON.stringify(
    Object.fromEntries(
      ['wikidata', 'chebi', 'chembl', 'curated'].map((basis) => [
        basis,
        excipients.filter((r) => r.basis === basis).length,
      ]),
    ),
  )}`,
);

const single = universe.substances.filter((substance) => substance.singleCards);
const found = single.filter((substance) => lookupNormalizedCompound(index, substance.key));
console.error(
  `single-substance cards: ${single.length}; found in the chunk ${found.length}; with smiles ${found.filter((s) => lookupNormalizedCompound(index, s.key)?.smiles).length}; roles ${found.filter((s) => lookupNormalizedCompound(index, s.key)?.roles?.length).length}; targets ${found.filter((s) => lookupNormalizedCompound(index, s.key)?.targets?.length).length}`,
);

// Section labels and phrases that the splitter picks up from a «Состав» text but that name no component.
const LABEL_STEMS = new Set(
  `оболочк пленочн состав капсул ядр дозировк таблетк корпус содерж крышечк крышк том числ эквивалентн
   пересчет осмолярност теоретическ мосм ионн веществ вспомогательн вешеств соответствует что дисперс
   примечан покрыт котор лекарственн над налич препарат учитыват получен масс одн дозе мл мг г
   действующ активн компонент ингредиент проч масса суммарн количеств различн на`.split(/\s+/u),
);
let covered = 0;
let coveredRecurring = 0;
let recurring = 0;
let activeOnly = 0;
let noise = 0;
const missed: { key: string; documents: number; sample: string }[] = [];
for (const item of excipientItems.items) {
  const found = lookupNormalizedCompound(index, item.key);
  if (found && found.kind !== 'active') covered += item.documents;
  const isLabel = item.key.split(' ').every((token) => LABEL_STEMS.has(token));
  if (item.documents >= 2 && !isLabel && !(found && found.kind === 'active')) {
    recurring += item.documents;
    if (found) coveredRecurring += item.documents;
  } else if (found) activeOnly += item.documents;
  else if (item.key.split(' ').every((token) => LABEL_STEMS.has(token))) noise += item.documents;
  else
    missed.push({
      key: item.key,
      documents: item.documents,
      sample: item.spellings[0]?.text ?? '',
    });
}
const total = excipientItems.totalOccurrences;
console.error(
  `excipient occurrences: total ${total}; covered ${covered} (${((100 * covered) / total).toFixed(1)}%); active substances listed in «Состав» ${activeOnly}; section labels ${noise}; share of components (without actives and labels) ${((100 * covered) / (total - activeOnly - noise)).toFixed(1)}%`,
);
console.error(
  `components named in at least two instructions (without actives and labels): ${recurring} occurrences, covered ${coveredRecurring} (${((100 * coveredRecurring) / recurring).toFixed(1)}%)`,
);
console.error(
  `aliases dropped as conflicts: ${conflicts.length}; card ATC codes rejected (НСИ name differs): ${rejectedCodes}`,
);

if (REPORT) {
  console.error(`unresolved excipients (no Wikidata item): ${unresolvedExcipients.join(', ')}`);
  console.error(
    `unmatched single-card actives (${unmatchedActives.length}): ${unmatchedActives.slice(0, 200).join('; ')}`,
  );
  console.error(`unknown ChEMBL action types: ${[...unknownActions].join(', ')}`);
  console.error('conflicts:', conflicts.slice(0, 40).join(' | '));
  console.error(
    'untranslated roles:',
    [...missingRoles]
      .sort((a, b) => b[1] - a[1])
      .slice(0, REPORT_LIMIT)
      .map(([role, n]) => `${role} (${n})`)
      .join('; '),
  );
  console.error('top unmatched excipient keys:');
  for (const row of missed.slice(0, 150))
    console.error(`${row.documents}\t${row.key}\t${row.sample.slice(0, 60).replace(/\n/gu, ' ')}`);
}
