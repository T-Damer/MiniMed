/**
 * Structure and pharmacology of active substances, and the function of excipients, as one lazy
 * chunk (`compound-facts.json`, built by `tools/compounds/build.ts` from Wikidata, ChEBI, ChEMBL
 * and a reviewed excipient list; see docs/DRUG_KNOWLEDGE_PIPELINE.md «Compound facts»).
 *
 * The chunk is validated once where it enters the app. Lookups work on the normalized name
 * (`normalizeCompoundName`) or on a level-5 ATC code. Nothing here imports the UI.
 */
import {
  dropHydration,
  dropSalt,
  normalizeCompoundName,
  parentheticalAlternatives,
} from './compound-name';

export { normalizeCompoundName } from './compound-name';

export const COMPOUND_FACTS_SCHEMA_VERSION = 1;

/** `both`: an active substance that instructions also list as an excipient (glycerol, sodium chloride). */
export type CompoundKind = 'active' | 'excipient' | 'both';

/**
 * Where the roles, targets or functions of a record come from. `curated` means a reviewed
 * glossary of MiniMed, not a source database: the reader shows it differently.
 */
export type CompoundBasis = 'wikidata' | 'chebi' | 'chembl' | 'curated';

export interface CompoundRecord {
  readonly ru: string;
  readonly en?: string;
  readonly kind: CompoundKind;
  /** SMILES for smiles-drawer; the structure of the active moiety when the source gives a salt. */
  readonly smiles?: string;
  /** Plain ASCII formula: «C24H34N4O5S». */
  readonly formula?: string;
  /** Level-5 ATC codes (actives). */
  readonly atc?: readonly string[];
  /** Pharmacological roles, Russian, most informative first. */
  readonly roles?: readonly string[];
  /**
   * Molecular targets, one line each: «блокатор: Sulfonylurea receptor 1, Kir6.2 (KCNJ11/ABCC8)» —
   * the action in Russian when a source gives one, the protein as the source names it, its gene.
   */
  readonly targets?: readonly string[];
  /** Excipient functions, Russian. */
  readonly functions?: readonly string[];
  readonly basis: CompoundBasis;
  readonly wd?: string;
  readonly chebi?: string;
  readonly cid?: number;
  readonly chembl?: string;
}

/** A record with its key: what a lookup returns. */
export type CompoundFact = CompoundRecord & { readonly key: string };

export interface CompoundSource {
  readonly id: string;
  readonly label: string;
  readonly licence: string;
  readonly url: string;
}

export interface CompoundFacts {
  readonly schemaVersion: typeof COMPOUND_FACTS_SCHEMA_VERSION;
  /** Date of the last network retrieval, YYYY-MM-DD. */
  readonly retrieved: string;
  readonly sources: readonly CompoundSource[];
  readonly compounds: Readonly<Record<string, CompoundRecord>>;
  /** Normalized name → compound key, only for spellings that the record itself does not give. */
  readonly aliases: Readonly<Record<string, string>>;
  /**
   * Word stem → compound key, for families that are named by one word and a variety: any
   * «ароматизатор …» is a flavouring, any «Опадрай …» a film coating.
   */
  readonly tokenAliases: Readonly<Record<string, string>>;
}

/**
 * The chunk on disk is compact: label tables instead of repeated Russian strings, bare numbers
 * for Wikidata/ChEBI/ChEMBL ids, and defaults left out (`kind` active, `basis` wikidata, `en`
 * equal to the key with spaces). `parseCompoundFacts` validates it and expands it into
 * `CompoundFacts`.
 */
type Rec = Record<string, unknown>;

/** One compound as the chunk stores it; every field is untrusted until `parseRecord` has read it. */
interface RawRecord {
  readonly ru?: unknown;
  readonly en?: unknown;
  readonly kind?: unknown;
  readonly smiles?: unknown;
  readonly formula?: unknown;
  readonly atc?: unknown;
  readonly roles?: unknown;
  readonly targets?: unknown;
  readonly functions?: unknown;
  readonly basis?: unknown;
  readonly wd?: unknown;
  readonly chebi?: unknown;
  readonly cid?: unknown;
  readonly chembl?: unknown;
}

/** The chunk's top level. */
interface RawChunk {
  readonly schemaVersion?: unknown;
  readonly retrieved?: unknown;
  readonly sources?: unknown;
  readonly roleLabels?: unknown;
  readonly functionLabels?: unknown;
  readonly actionLabels?: unknown;
  readonly targetTable?: unknown;
  readonly compounds?: unknown;
  readonly aliases?: unknown;
  readonly tokenAliases?: unknown;
}

function fail(path: string, expected: string): never {
  throw new Error(`Compound facts: ${path} must be ${expected}`);
}

function isRecord(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, path: string): string {
  if (typeof value !== 'string' || value === '') return fail(path, 'a non-empty string');
  return value;
}

function strings(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) return fail(path, 'an array of strings');
  return value.map((entry, index) => str(entry, `${path}[${index}]`));
}

function whole(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return fail(path, 'a non-negative integer');
  }
  return value;
}

/** Entries of a label table by index; an index outside the table is an error. */
function pick<T>(table: readonly T[], value: unknown, path: string): T {
  const index = whole(value, path);
  const found = table[index];
  return found === undefined ? fail(path, 'an index into its label table') : found;
}

/** The basis a record has when the chunk leaves it out: ChEBI roles for actives, the glossary for excipients. */
export function defaultBasisCode(kind: string): string {
  return kind === 'active' ? 'c' : 'u';
}

const KINDS: readonly CompoundKind[] = ['active', 'excipient', 'both'];
/** One-letter codes of `CompoundBasis` in the chunk. */
export const BASIS_OF_CODE: Readonly<Record<string, CompoundBasis>> = {
  w: 'wikidata',
  c: 'chebi',
  m: 'chembl',
  u: 'curated',
};

interface Tables {
  readonly roles: readonly string[];
  readonly functions: readonly string[];
  readonly actions: readonly string[];
  readonly targets: readonly (readonly [string, string])[];
}

function parseTarget(value: unknown, tables: Tables, path: string): string {
  if (!Array.isArray(value)) return fail(path, 'a [target, action?] pair');
  const [name, gene] = pick(tables.targets, value[0], `${path}[0]`);
  const action = value[1] === undefined ? undefined : pick(tables.actions, value[1], `${path}[1]`);
  return `${action ? `${action}: ` : ''}${name}${gene ? ` (${gene})` : ''}`;
}

function parseRecord(key: string, input: unknown, tables: Tables): CompoundRecord {
  const path = `compounds.${key}`;
  if (!isRecord(input)) return fail(path, 'an object');
  const value: RawRecord = input;
  const kind = value.kind === undefined ? 'active' : value.kind;
  if (!KINDS.includes(kind as CompoundKind))
    return fail(`${path}.kind`, 'active, excipient or both');
  const basis =
    BASIS_OF_CODE[
      value.basis === undefined ? defaultBasisCode(kind as string) : String(value.basis)
    ];
  if (basis === undefined) return fail(`${path}.basis`, 'one of w, c, m, u');
  const en =
    value.en === undefined
      ? /^q\d+$/u.test(key)
        ? undefined
        : key.replaceAll('-', ' ')
      : str(value.en, `${path}.en`);
  const smiles = value.smiles === undefined ? undefined : str(value.smiles, `${path}.smiles`);
  if (smiles !== undefined && /\s/u.test(smiles))
    return fail(`${path}.smiles`, 'a SMILES without spaces');
  const formula = value.formula === undefined ? undefined : str(value.formula, `${path}.formula`);
  const atc = value.atc === undefined ? undefined : strings(value.atc, `${path}.atc`);
  if (atc?.some((code) => !/^[A-Z]\d{2}[A-Z]{2}\d{2}$/u.test(code))) {
    return fail(`${path}.atc`, 'level-5 ATC codes');
  }
  const list = (field: unknown, table: readonly string[], name: string) =>
    field === undefined
      ? undefined
      : Array.isArray(field)
        ? field.map((entry, index) => pick(table, entry, `${path}.${name}[${index}]`))
        : fail(`${path}.${name}`, 'an array of indexes');
  const roles = list(value.roles, tables.roles, 'roles');
  const functions = list(value.functions, tables.functions, 'functions');
  const targets =
    value.targets === undefined
      ? undefined
      : Array.isArray(value.targets)
        ? value.targets.map((entry, index) =>
            parseTarget(entry, tables, `${path}.targets[${index}]`),
          )
        : fail(`${path}.targets`, 'an array');
  const id = (field: unknown, name: string) =>
    field === undefined ? undefined : whole(field, `${path}.${name}`);
  const wd = id(value.wd, 'wd');
  const chebi = id(value.chebi, 'chebi');
  const chembl = id(value.chembl, 'chembl');
  const cid = id(value.cid, 'cid');
  return {
    ru: str(value.ru, `${path}.ru`),
    kind: kind as CompoundKind,
    basis,
    ...(en === undefined ? {} : { en }),
    ...(smiles === undefined ? {} : { smiles }),
    ...(formula === undefined ? {} : { formula }),
    ...(atc === undefined ? {} : { atc }),
    ...(roles === undefined ? {} : { roles }),
    ...(targets === undefined ? {} : { targets }),
    ...(functions === undefined ? {} : { functions }),
    ...(wd === undefined ? {} : { wd: `Q${wd}` }),
    ...(chebi === undefined ? {} : { chebi: `CHEBI:${chebi}` }),
    ...(cid === undefined ? {} : { cid }),
    ...(chembl === undefined ? {} : { chembl: `CHEMBL${chembl}` }),
  };
}

/** Checks the chunk's shape and expands it; a malformed chunk is an error, never an empty result. */
export function parseCompoundFacts(input: unknown): CompoundFacts {
  if (!isRecord(input)) return fail('the chunk', 'an object');
  const value: RawChunk = input;
  if (value.schemaVersion !== COMPOUND_FACTS_SCHEMA_VERSION) {
    return fail('schemaVersion', String(COMPOUND_FACTS_SCHEMA_VERSION));
  }
  const retrieved = str(value.retrieved, 'retrieved');
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(retrieved)) return fail('retrieved', 'YYYY-MM-DD');
  if (!Array.isArray(value.sources)) return fail('sources', 'an array');
  const sources = value.sources.map((entry: unknown, index): CompoundSource => {
    if (!isRecord(entry)) return fail(`sources[${index}]`, 'an object');
    const source: Partial<Record<keyof CompoundSource, unknown>> = entry;
    return {
      id: str(source.id, `sources[${index}].id`),
      label: str(source.label, `sources[${index}].label`),
      licence: str(source.licence, `sources[${index}].licence`),
      url: str(source.url, `sources[${index}].url`),
    };
  });
  if (!Array.isArray(value.targetTable)) return fail('targetTable', 'an array');
  const tables: Tables = {
    roles: strings(value.roleLabels, 'roleLabels'),
    functions: strings(value.functionLabels, 'functionLabels'),
    actions: strings(value.actionLabels, 'actionLabels'),
    targets: value.targetTable.map((entry: unknown, index): readonly [string, string] => {
      if (!Array.isArray(entry)) return fail(`targetTable[${index}]`, 'a [name, gene] pair');
      return [
        str(entry[0], `targetTable[${index}][0]`),
        typeof entry[1] === 'string' ? entry[1] : '',
      ];
    }),
  };
  if (!isRecord(value.compounds)) return fail('compounds', 'an object');
  const compounds: Record<string, CompoundRecord> = {};
  for (const [key, entry] of Object.entries(value.compounds)) {
    compounds[key] = parseRecord(key, entry, tables);
  }
  if (!isRecord(value.aliases)) return fail('aliases', 'an object');
  const aliases: Record<string, string> = {};
  for (const [alias, key] of Object.entries(value.aliases)) {
    const target = str(key, `aliases.${alias}`);
    if (!(target in compounds)) return fail(`aliases.${alias}`, 'the key of a compound');
    aliases[alias] = target;
  }
  if (!isRecord(value.tokenAliases)) return fail('tokenAliases', 'an object');
  const tokenAliases: Record<string, string> = {};
  for (const [token, key] of Object.entries(value.tokenAliases)) {
    const target = str(key, `tokenAliases.${token}`);
    if (!(target in compounds)) return fail(`tokenAliases.${token}`, 'the key of a compound');
    tokenAliases[token] = target;
  }
  return {
    schemaVersion: COMPOUND_FACTS_SCHEMA_VERSION,
    retrieved,
    sources,
    compounds,
    aliases,
    tokenAliases,
  };
}

export interface CompoundIndex {
  readonly facts: CompoundFacts;
  readonly byName: ReadonlyMap<string, string>;
  readonly byLooseName: ReadonlyMap<string, string>;
  readonly bySaltlessName: ReadonlyMap<string, string>;
  readonly byAtc: ReadonlyMap<string, readonly string[]>;
}

/** Lookup structures of a validated chunk. The first compound to claim a name keeps it. */
export function buildCompoundIndex(facts: CompoundFacts): CompoundIndex {
  const byName = new Map<string, string>();
  const claim = (map: Map<string, string>, name: string, key: string) => {
    if (name && !map.has(name)) map.set(name, key);
  };
  const entries = Object.entries(facts.compounds);
  for (const [key, record] of entries) {
    claim(byName, normalizeCompoundName(record.ru), key);
    if (record.en) claim(byName, normalizeCompoundName(record.en), key);
  }
  for (const [alias, key] of Object.entries(facts.aliases)) claim(byName, alias, key);
  const byLooseName = new Map<string, string>();
  const bySaltlessName = new Map<string, string>();
  const byAtc = new Map<string, string[]>();
  for (const [name, key] of byName) {
    claim(byLooseName, dropHydration(name), key);
    if (facts.compounds[key]?.kind !== 'excipient') claim(bySaltlessName, dropSalt(name), key);
  }
  for (const [key, record] of entries) {
    for (const code of record.atc ?? []) byAtc.set(code, [...(byAtc.get(code) ?? []), key]);
  }
  return { facts, byName, byLooseName, bySaltlessName, byAtc };
}

function hit(index: CompoundIndex, key: string | undefined): CompoundFact | undefined {
  const record = key === undefined ? undefined : index.facts.compounds[key];
  return key !== undefined && record ? { ...record, key } : undefined;
}

/** `lookupCompound` for a key that `normalizeCompoundName` already produced. */
export function lookupNormalizedCompound(
  index: CompoundIndex,
  normalized: string,
): CompoundFact | undefined {
  if (!normalized) return undefined;
  const exact = hit(index, index.byName.get(normalized));
  if (exact) return exact;
  const loose = dropHydration(normalized);
  const hydrated = hit(index, index.byName.get(loose) ?? index.byLooseName.get(loose));
  if (hydrated) return hydrated;
  const saltless = dropSalt(normalized);
  const salt = saltless ? hit(index, index.bySaltlessName.get(saltless)) : undefined;
  if (salt) return salt;
  for (const token of normalized.split(' ')) {
    const family = hit(index, index.facts.tokenAliases[token]);
    if (family) return family;
  }
  return undefined;
}

/**
 * The compound a name stands for. Tries the exact normalized name, the same without hydration
 * words («моногидрат», «безводный») and, for active substances only, without salt words
 * («гидрохлорид», «натрия»).
 */
export function lookupCompound(index: CompoundIndex, name: string): CompoundFact | undefined {
  return lookupNormalizedCompound(index, normalizeCompoundName(name));
}

/**
 * Like `lookupCompound` for a piece of instruction text: «гипромеллоза (гидроксипропилметилцеллюлоза)»
 * also tries each bracket as a name of its own.
 */
export function lookupCompoundByText(index: CompoundIndex, text: string): CompoundFact | undefined {
  return (
    lookupCompound(index, text) ??
    parentheticalAlternatives(text)
      .map((alternative) => lookupCompound(index, alternative))
      .find((found) => found !== undefined)
  );
}

/** Compounds that carry a level-5 ATC code (several when the code is shared by one substance's forms). */
export function lookupCompoundsByAtc(index: CompoundIndex, atc: string): CompoundFact[] {
  const code = atc.trim().toUpperCase();
  return (index.byAtc.get(code) ?? []).flatMap((key) => hit(index, key) ?? []);
}

let pending: Promise<CompoundIndex> | undefined;

/** The chunk is its own lazy import: fetched the first time a drug card needs it. */
export function loadCompoundFacts(): Promise<CompoundIndex> {
  pending ??= import('./compound-facts.json')
    .then((module) => buildCompoundIndex(parseCompoundFacts(module.default)))
    .catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
  return pending;
}
