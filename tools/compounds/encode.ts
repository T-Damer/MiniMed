/**
 * Writes `CompoundFacts` in the compact on-disk form that `parseCompoundFacts` reads: label tables
 * ordered by use, numeric ids, defaults left out, one compound per line so diffs stay readable.
 */
import {
  BASIS_OF_CODE,
  type CompoundBasis,
  type CompoundFacts,
  type CompoundRecord,
  defaultBasisCode,
} from '../../apps/app/src/features/medications/compounds/compound-facts';

const CODE_OF_BASIS = Object.fromEntries(
  Object.entries(BASIS_OF_CODE).map(([code, basis]) => [basis, code]),
) as Record<CompoundBasis, string>;

/** A molecular target before it is flattened into a line of text. */
export interface BuildTarget {
  /** Protein or other target, as the source names it. */
  n: string;
  /** Gene symbol. */
  g?: string;
  /** Action in Russian: «ингибитор», «агонист». */
  a?: string;
}

export type BuildRecord = Omit<CompoundRecord, 'targets'> & { targets?: BuildTarget[] };
export type BuildFacts = Omit<CompoundFacts, 'compounds'> & {
  compounds: Record<string, BuildRecord>;
};

function table(values: Iterable<string>): string[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'))
    .map(([value]) => value);
}

const numeric = (id: string | undefined, prefix: string): number | undefined =>
  id === undefined ? undefined : Number(id.slice(prefix.length));

export function encodeCompoundFacts(facts: BuildFacts): string {
  const records = Object.entries(facts.compounds);
  const roleLabels = table(records.flatMap(([, record]) => record.roles ?? []));
  const functionLabels = table(records.flatMap(([, record]) => record.functions ?? []));
  const actionLabels = table(
    records.flatMap(([, record]) => (record.targets ?? []).flatMap((target) => target.a ?? [])),
  );
  const targetKeys = table(
    records.flatMap(([, record]) =>
      (record.targets ?? []).map((target) => JSON.stringify([target.n, target.g ?? ''])),
    ),
  );
  const targetTable = targetKeys.map((entry) => JSON.parse(entry) as [string, string]);
  const index = (labels: string[], value: string) => labels.indexOf(value);

  const encodeRecord = (key: string, record: BuildRecord) => ({
    ru: record.ru,
    ...(record.en !== undefined && record.en !== key.replaceAll('-', ' ') ? { en: record.en } : {}),
    ...(record.kind === 'active' ? {} : { kind: record.kind }),
    ...(record.smiles ? { smiles: record.smiles } : {}),
    ...(record.formula ? { formula: record.formula } : {}),
    ...(record.atc?.length ? { atc: record.atc } : {}),
    ...(record.roles?.length ? { roles: record.roles.map((role) => index(roleLabels, role)) } : {}),
    ...(record.targets?.length
      ? {
          targets: record.targets.map((target) => {
            const at = index(targetKeys, JSON.stringify([target.n, target.g ?? '']));
            return target.a ? [at, index(actionLabels, target.a)] : [at];
          }),
        }
      : {}),
    ...(record.functions?.length
      ? { functions: record.functions.map((label) => index(functionLabels, label)) }
      : {}),
    ...(CODE_OF_BASIS[record.basis] === defaultBasisCode(record.kind)
      ? {}
      : { basis: CODE_OF_BASIS[record.basis] }),
    ...(record.wd ? { wd: numeric(record.wd, 'Q') } : {}),
    ...(record.chebi ? { chebi: numeric(record.chebi, 'CHEBI:') } : {}),
    ...(record.cid ? { cid: record.cid } : {}),
    ...(record.chembl ? { chembl: numeric(record.chembl, 'CHEMBL') } : {}),
  });

  return `${[
    '{',
    `"schemaVersion":${facts.schemaVersion},"retrieved":${JSON.stringify(facts.retrieved)},`,
    `"sources":${JSON.stringify(facts.sources)},`,
    `"roleLabels":${JSON.stringify(roleLabels)},`,
    `"functionLabels":${JSON.stringify(functionLabels)},`,
    `"actionLabels":${JSON.stringify(actionLabels)},`,
    `"targetTable":${JSON.stringify(targetTable)},`,
    '"compounds":{',
    records
      .map(([key, record]) => `${JSON.stringify(key)}:${JSON.stringify(encodeRecord(key, record))}`)
      .join(',\n'),
    '},',
    `"tokenAliases":${JSON.stringify(facts.tokenAliases)},`,
    '"aliases":{',
    Object.entries(facts.aliases)
      .map(([alias, key]) => `${JSON.stringify(alias)}:${JSON.stringify(key)}`)
      .join(',\n'),
    '}',
    '}',
  ].join('\n')}\n`;
}
