import type { ResolvedRule } from './dose-document';
import type { ItemAnalysis, RuleOption } from './prescription-model';

/** Why a sentence sits in the fold and not in the answer. */
export type FragmentKind = 'option' | 'pending' | 'cap' | 'quoted' | 'restricted';

export interface Fragment {
  readonly key: string;
  readonly kind: FragmentKind;
  readonly resolved: ResolvedRule;
  /** The computable rule this fragment can be picked as (kind `option`). */
  readonly option: RuleOption | null;
  /** What is missing for the patient («нужен возраст»), or null. */
  readonly note: string | null;
  /** The sentence is the patient's own: why («по возрасту и массе»), when it is only quoted. */
  readonly fitMark?: string | undefined;
}

export interface FragmentGroup {
  readonly title: string;
  readonly fragments: readonly Fragment[];
}

/** Fragments shown in the fold at most: the rest is one «Открыть в инструкции» away. */
export const MAX_FRAGMENTS = 40;

function missingText(option: RuleOption): string {
  return `нужен ${option.match.missing.map((what) => (what === 'age' ? 'возраст' : 'вес')).join(' и ')}`;
}

/**
 * The dose sentences of the instruction that are not the answer on the page: other rules that fit the
 * patient (pick one to switch), rules waiting for a number, ceilings, sentences the gate only quotes
 * and sentences with conditions. Each sentence once, grouped by the section it is printed in.
 * With no computable rule the first quoted sentence is the answer, and stays out of the fold.
 */
export function foldedFragments(analysis: ItemAnalysis): readonly FragmentGroup[] {
  const seen = new Set<string>();
  const chosen = analysis.chosen?.resolved.quote;
  if (chosen !== undefined) seen.add(chosen);
  if (analysis.options.length === 0) {
    const lead = analysis.quoted[0]?.quote;
    if (lead !== undefined) seen.add(lead);
  }
  const fragments: Fragment[] = [];
  const add = (
    kind: FragmentKind,
    resolved: ResolvedRule,
    option: RuleOption | null,
    note: string | null,
    key: string,
  ): void => {
    if (seen.has(resolved.quote) || fragments.length >= MAX_FRAGMENTS) return;
    seen.add(resolved.quote);
    const fitMark = kind === 'quoted' ? analysis.quotedMarks.get(resolved) : undefined;
    fragments.push({ key, kind, resolved, option, note, ...(fitMark ? { fitMark } : {}) });
  };
  for (const option of analysis.options) {
    if (option.key !== analysis.chosen?.key)
      add('option', option.resolved, option, null, option.key);
  }
  for (const option of analysis.pending) {
    add('pending', option.resolved, null, missingText(option), `pending:${option.key}`);
  }
  for (const cap of analysis.caps) {
    add('cap', cap.resolved, null, null, `cap:${cap.resolved.quote.slice(0, 24)}`);
  }
  analysis.quoted.forEach((resolved, at) => {
    add('quoted', resolved, null, null, `quoted:${at}`);
  });
  analysis.restricted.forEach((resolved, at) => {
    add('restricted', resolved, null, null, `restricted:${at}`);
  });
  const groups = new Map<string, Fragment[]>();
  for (const fragment of fragments) {
    const title = fragment.resolved.sectionTitle;
    const list = groups.get(title);
    if (list) list.push(fragment);
    else groups.set(title, [fragment]);
  }
  return [...groups].map(([title, list]) => ({ title, fragments: list }));
}

export function fragmentCount(groups: readonly FragmentGroup[]): number {
  return groups.reduce((sum, group) => sum + group.fragments.length, 0);
}
