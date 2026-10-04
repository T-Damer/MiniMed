import type { MedicalDocument } from '@localmed/contracts';

import {
  ATC_ANATOMICAL_GROUPS,
  atcPrefixes,
  normalizeAtcCode,
} from '@/features/medications/atc-code';
import {
  displayDrugName,
  drugAtcCodes,
  isEsklpSubstanceDocument,
} from '@/features/medications/drug-screen';
import { ATC_NONE_CODE } from '@/features/medications/medication-routing';
import { pluralRu } from '@/i18n/labels';

/**
 * The «По группам АТХ» view of the drug catalog as data: installed ЕСКЛП substances (МНН) placed
 * under the levels of their ATC codes, with a count at every node. Pure: no DOM, no storage; the
 * names of levels 1-4 come from the NSI dictionary (`atc-names.ts`) and are passed in.
 */

/** Levels shown as groups; level 5 is the substance itself. */
export type AtcGroupLevel = 1 | 2 | 3 | 4;

export const ATC_NONE_NAME = 'Без кода АТХ';

/** One МНН document, reduced to what the tree needs. */
export interface AtcSubstance {
  readonly documentId: string;
  /** Ready for display. */
  readonly name: string;
  /** Normalised codes of level 1-5, once each, in code order; empty when the registry gives none. */
  readonly codes: readonly string[];
}

/** A substance as it sits in one node: with the full codes that lead it there. */
export interface AtcTreeEntry {
  readonly substance: AtcSubstance;
  /** Codes of this substance inside the node's subtree (level 5 where the registry gives it). */
  readonly codes: readonly string[];
}

export interface AtcTreeNode {
  /** `N`, `N06`, `N06B`, `N06BX`, or `none`. */
  readonly code: string;
  readonly level: AtcGroupLevel;
  /** NSI name; null when no source names this code. */
  readonly name: string | null;
  readonly parentCode: string | null;
  readonly children: readonly AtcTreeNode[];
  /** Substances whose code stops at this node (level 4, or shorter in the registry). */
  readonly entries: readonly AtcTreeEntry[];
  /** Distinct substances in the whole subtree. */
  readonly substanceCount: number;
}

export interface AtcTree {
  /** Top-level nodes that hold at least one installed substance, in code order. */
  readonly roots: readonly AtcTreeNode[];
  /** Every node by code, including the synthetic `none` group. */
  readonly nodes: ReadonlyMap<string, AtcTreeNode>;
}

function recordValue(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function nonEmptyText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * An ЕСКЛП МНН document as a tree leaf; null for any other document. Codes are normalised
 * (Cyrillic look-alikes, spacing) by the same rules the drug screen uses.
 */
export function atcSubstanceFromDocument(
  document: Pick<MedicalDocument, 'id' | 'title' | 'metadata'>,
): AtcSubstance | null {
  if (!isEsklpSubstanceDocument(document)) return null;
  const metadata = recordValue(document.metadata) ?? {};
  const name =
    nonEmptyText(metadata['standardizedInn']) ??
    nonEmptyText(document.title.split('—')[0]) ??
    nonEmptyText(document.title);
  if (!name) return null;
  return {
    documentId: document.id,
    name: displayDrugName(name),
    codes: drugAtcCodes(document, undefined).map((entry) => entry.code),
  };
}

interface NodeDraft {
  readonly code: string;
  readonly level: AtcGroupLevel;
  readonly children: Set<string>;
  readonly entries: Map<string, { substance: AtcSubstance; codes: Set<string> }>;
  readonly subtree: Set<string>;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, 'ru');
}

/**
 * Within a group the substance itself comes first: ATC level-5 codes order it so (N02BE01
 * paracetamol before N02BE51 paracetamol combinations); names break ties.
 */
function compareSubstanceEntries(
  left: { readonly substance: AtcSubstance; readonly codes: readonly string[] },
  right: { readonly substance: AtcSubstance; readonly codes: readonly string[] },
): number {
  const byCode = compareText(left.codes[0] ?? '\uffff', right.codes[0] ?? '\uffff');
  return byCode !== 0 ? byCode : compareText(left.substance.name, right.substance.name);
}

function validCodes(substance: AtcSubstance): readonly string[] {
  return [
    ...new Set(
      substance.codes.flatMap((code) => {
        const normalized = normalizeAtcCode(code);
        return normalized ? [normalized.code] : [];
      }),
    ),
  ];
}

function nodeName(code: string, level: AtcGroupLevel, names: Readonly<Record<string, string>>) {
  const fromCatalog = names[code]?.trim();
  if (fromCatalog) return fromCatalog;
  return level === 1 ? (ATC_ANATOMICAL_GROUPS[code] ?? null) : null;
}

/** Places the substances under the levels of their ATC codes and counts every node. */
export function buildAtcTree(
  substances: readonly AtcSubstance[],
  names: Readonly<Record<string, string>>,
): AtcTree {
  const drafts = new Map<string, NodeDraft>();
  const ensure = (code: string, level: AtcGroupLevel): NodeDraft => {
    let draft = drafts.get(code);
    if (!draft) {
      draft = { code, level, children: new Set(), entries: new Map(), subtree: new Set() };
      drafts.set(code, draft);
    }
    return draft;
  };

  for (const substance of substances) {
    const codes = validCodes(substance);
    if (codes.length === 0) {
      const draft = ensure(ATC_NONE_CODE, 1);
      draft.subtree.add(substance.documentId);
      draft.entries.set(substance.documentId, { substance, codes: new Set() });
      continue;
    }
    for (const code of codes) {
      const path = atcPrefixes(code).filter(
        (prefix): prefix is { level: AtcGroupLevel; code: string } => prefix.level <= 4,
      );
      let parent: NodeDraft | undefined;
      for (const prefix of path) {
        const draft = ensure(prefix.code, prefix.level);
        draft.subtree.add(substance.documentId);
        parent?.children.add(prefix.code);
        parent = draft;
      }
      if (!parent) continue;
      const entry = parent.entries.get(substance.documentId);
      if (entry) entry.codes.add(code);
      else parent.entries.set(substance.documentId, { substance, codes: new Set([code]) });
    }
  }

  const nodes = new Map<string, AtcTreeNode>();
  const freeze = (code: string, parentCode: string | null): AtcTreeNode => {
    const draft = drafts.get(code);
    if (!draft) throw new Error(`ATC tree: missing node ${code}`);
    const node: AtcTreeNode = {
      code,
      level: draft.level,
      name: code === ATC_NONE_CODE ? ATC_NONE_NAME : nodeName(code, draft.level, names),
      parentCode,
      children: [...draft.children].toSorted(compareText).map((child) => freeze(child, code)),
      entries: [...draft.entries.values()]
        .map((entry) => ({ substance: entry.substance, codes: [...entry.codes].toSorted() }))
        .toSorted(compareSubstanceEntries),
      substanceCount: draft.subtree.size,
    };
    nodes.set(code, node);
    return node;
  };

  const roots = [...drafts.values()]
    .filter((draft) => draft.level === 1)
    .map((draft) => draft.code)
    .toSorted((left, right) => {
      // The synthetic group closes the list.
      if (left === ATC_NONE_CODE) return 1;
      if (right === ATC_NONE_CODE) return -1;
      return compareText(left, right);
    })
    .map((code) => freeze(code, null));
  return { roots, nodes };
}

/* ------------------------------------------------------------------------------------------ */
/* Level-1 groups and their packages                                                           */
/* ------------------------------------------------------------------------------------------ */

/** The 14 anatomical groups, each with the ЕСКЛП module that carries its substances. */
const ATC_GROUP_MODULE_SLUGS: ReadonlyArray<readonly [string, string]> = [
  ['A', 'alimentary-metabolism'],
  ['B', 'blood'],
  ['C', 'cardiovascular'],
  ['D', 'dermatological'],
  ['G', 'genitourinary-hormones'],
  ['H', 'systemic-hormones'],
  ['J', 'antiinfectives'],
  ['L', 'antineoplastic-immunomodulating'],
  ['M', 'musculoskeletal'],
  ['N', 'nervous-system'],
  ['P', 'antiparasitic'],
  ['R', 'respiratory'],
  ['S', 'sensory-organs'],
  ['V', 'various'],
];

export interface AtcLevelOneGroup {
  readonly code: string;
  readonly name: string;
  /** The medication module whose installation brings this group's substances. */
  readonly moduleId: string;
}

/** Level 1 of the tree: always all 14 groups, installed or not. */
export function atcLevelOneGroups(
  names: Readonly<Record<string, string>>,
): readonly AtcLevelOneGroup[] {
  return ATC_GROUP_MODULE_SLUGS.map(([code, slug]) => ({
    code,
    name: nodeName(code, 1, names) ?? code,
    moduleId: `minimed.medications.${slug}.ru`,
  }));
}

/** The module id of a node's level-1 group; null for the synthetic `none` group. */
export function atcGroupModuleId(code: string): string | null {
  const letter = code.charAt(0);
  const entry = ATC_GROUP_MODULE_SLUGS.find(([candidate]) => candidate === letter);
  return entry ? `minimed.medications.${entry[1]}.ru` : null;
}

/* ------------------------------------------------------------------------------------------ */
/* Navigation and labels                                                                       */
/* ------------------------------------------------------------------------------------------ */

/** «1 вещество», «3 вещества», «12 веществ». */
export function substanceCountLabel(count: number): string {
  return `${String(count)} ${pluralRu(count, 'вещество', 'вещества', 'веществ')}`;
}

/** «1 подгруппа», «2 подгруппы», «5 подгрупп». */
export function subgroupCountLabel(count: number): string {
  return `${String(count)} ${pluralRu(count, 'подгруппа', 'подгруппы', 'подгрупп')}`;
}
