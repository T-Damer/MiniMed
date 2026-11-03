/**
 * Matches the active substances of `actives-universe.json` to Wikidata items and collects their
 * identifiers, structure, roles and protein targets (Wikidata is CC0).
 *
 *   bun tools/compounds/fetch-wikidata-actives.ts
 *
 * Matching order: ATC code (`P267`, from the card or from the НСИ name), then the English ATC name
 * as an `en` label or alias, then the Russian name as an `ru` label or alias. Only items that look
 * like a compound (a SMILES, a PubChem CID or a ChEBI id) are accepted by name. Raw responses are
 * cached; output `data/raw/compounds/wikidata-actives.json` is gitignored.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { agrees, loadNsiNames } from './atc-trust';
import { type Binding, chunk, qid, quote, sparql } from './wikidata';
import { DETAILS, ItemStore, SELECT } from './wikidata-items';

const ROOT = join(import.meta.dirname, '..', '..');
const universe = JSON.parse(
  readFileSync(join(ROOT, 'data/raw/compounds/actives-universe.json'), 'utf8'),
) as {
  substances: {
    ru: string;
    singleCards: number;
    atcFromCards: string[];
    atcFromNames: string[];
    en: string[];
  }[];
};

const store = new ItemStore();
const items = store.items;
const addRow = (row: Binding) => store.add(row);

const codes = [
  ...new Set(universe.substances.flatMap((s) => [...s.atcFromCards, ...s.atcFromNames])),
].sort();
/** ATC code → item ids, used to pick the item of a substance. */
const byAtc = new Map<string, Set<string>>();
for (const batch of chunk(codes, 120)) {
  const rows = await sparql(
    `${SELECT} WHERE { VALUES ?atcq { ${batch.map(quote).join(' ')} } ?item wdt:P267 ?atcq. ${DETAILS} }`,
  );
  for (const row of rows) {
    const item = addRow(row);
    if (item && row.atc) byAtc.set(row.atc, (byAtc.get(row.atc) ?? new Set()).add(item.id));
  }
  console.error(`ATC batch: ${items.size} items`);
}

/** Label/alias matching for the substances that no ATC code led to an item. */
const nsiNames = loadNsiNames();
const unmatched = universe.substances.filter(
  (s) =>
    ![...new Set([...s.atcFromCards, ...s.atcFromNames])].some((code) => {
      if (!byAtc.has(code)) return false;
      // The НСИ name of the code must agree; without an НСИ name the item's own label decides.
      const named = nsiNames.get(code)?.ru;
      return (
        s.atcFromNames.includes(code) ||
        agrees(named, s.ru) ||
        [...(byAtc.get(code) ?? [])].some((id) => agrees(items.get(id)?.ru, s.ru))
      );
    }),
);
const byName = new Map<string, Set<string>>();
async function matchNames(names: string[], language: 'ru' | 'en'): Promise<void> {
  for (const batch of chunk(names, 60)) {
    const values = batch.map((name) => `${quote(name)}@${language}`).join(' ');
    const rows = await sparql(
      `SELECT ?item ?name ?smiles ?iso ?formula ?chebi ?cid ?chembl ?atc ?ru ?en WHERE {
        VALUES ?name { ${values} }
        { ?item rdfs:label ?name } UNION { ?item skos:altLabel ?name }
        FILTER EXISTS { { ?item wdt:P233 [] } UNION { ?item wdt:P662 [] } UNION { ?item wdt:P683 [] } }
        ${DETAILS} }`,
    );
    for (const row of rows) {
      const item = addRow(row);
      if (item && row.name) {
        const key = `${language}:${row.name.toLowerCase().replaceAll('ё', 'е')}`;
        byName.set(key, (byName.get(key) ?? new Set()).add(item.id));
      }
    }
    console.error(`${language} name batch: ${items.size} items`);
  }
}
await matchNames(
  [...new Set(unmatched.flatMap((s) => s.en))].filter((name) =>
    /^[\p{L}\d ,'()\-+[\]]+$/u.test(name),
  ),
  'en',
);
await matchNames(
  unmatched.filter((s) => !s.ru.includes('+')).map((s) => s.ru),
  'ru',
);

// Roles and protein targets of every accepted item.
const itemIds = [...items.keys()].sort();
export interface Relation {
  item: string;
  value: string;
  ru?: string | undefined;
  en?: string | undefined;
  gene?: string | undefined;
}
const roles: Relation[] = [];
const targets: Relation[] = [];
for (const batch of chunk(itemIds, 150)) {
  const values = batch.map((id) => `wd:${id}`).join(' ');
  for (const row of await sparql(
    `SELECT ?item ?value ?ru ?en WHERE { VALUES ?item { ${values} } ?item wdt:P2868 ?value.
      OPTIONAL { ?value rdfs:label ?ru FILTER(lang(?ru) = "ru") }
      OPTIONAL { ?value rdfs:label ?en FILTER(lang(?en) = "en") } }`,
  )) {
    roles.push({ item: qid(row.item ?? ''), value: qid(row.value ?? ''), ru: row.ru, en: row.en });
  }
  for (const row of await sparql(
    `SELECT ?item ?value ?ru ?en ?gene WHERE { VALUES ?item { ${values} } ?item wdt:P129 ?value.
      ?value wdt:P31 wd:Q8054.
      OPTIONAL { ?value rdfs:label ?ru FILTER(lang(?ru) = "ru") }
      OPTIONAL { ?value rdfs:label ?en FILTER(lang(?en) = "en") }
      OPTIONAL { ?value wdt:P702 ?g. ?g wdt:P353 ?gene } }`,
  )) {
    targets.push({
      item: qid(row.item ?? ''),
      value: qid(row.value ?? ''),
      ru: row.ru,
      en: row.en,
      gene: row.gene,
    });
  }
  console.error(`relations: ${roles.length} roles, ${targets.length} targets`);
}

mkdirSync(join(ROOT, 'data/raw/compounds'), { recursive: true });
writeFileSync(
  join(ROOT, 'data/raw/compounds/wikidata-actives.json'),
  `${JSON.stringify({
    retrieved: new Date().toISOString().slice(0, 10),
    items: [...items.values()],
    byAtc: Object.fromEntries([...byAtc].map(([code, ids]) => [code, [...ids].sort()])),
    byName: Object.fromEntries([...byName].map(([name, ids]) => [name, [...ids].sort()])),
    roles,
    targets,
  })}\n`,
);
console.error(`${items.size} items, ${roles.length} roles, ${targets.length} targets`);
