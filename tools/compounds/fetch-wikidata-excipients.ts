/**
 * Resolves the English names of `excipients.curated.tsv` (and the optional extra active names of
 * `actives-extra.tsv`) to Wikidata items, with identifiers, structure and the roles/uses that
 * Wikidata states for them (CC0).
 *
 *   bun tools/compounds/fetch-wikidata-excipients.ts
 *
 * A name matches an item whose English label or alias equals it (any capitalization of the first
 * letter) and that has a SMILES, a PubChem CID or a ChEBI id. `wikidata-pins.json` (name → item)
 * pins an item when the label is ambiguous or missing. Output (gitignored):
 * `data/raw/compounds/wikidata-excipients.json`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { readCuratedExcipients, readExtraActives } from './curated';
import { chunk, qid, quote, sparql } from './wikidata';
import { DETAILS, ItemStore } from './wikidata-items';

const ROOT = join(import.meta.dirname, '..', '..');
const store = new ItemStore();
/** English name (lowercase) → ids whose label or alias equals it. */
const byName: Record<string, { label: string[]; alias: string[] }> = {};

const names = [
  ...new Set(
    [
      ...readCuratedExcipients().map((entry) => entry.en),
      ...readExtraActives().map((entry) => entry.en),
    ]
      .flatMap((name) => name.split('/'))
      .map((name) => name.trim().toLowerCase()),
  ),
]
  .filter(Boolean)
  .sort();

const pinsFile = join(import.meta.dirname, 'wikidata-pins.json');
const pins: Record<string, string> = existsSync(pinsFile)
  ? (JSON.parse(readFileSync(pinsFile, 'utf8')) as Record<string, string>)
  : {};

for (const batch of chunk(names, 40)) {
  const forms = batch.flatMap((name) => [name, name.charAt(0).toUpperCase() + name.slice(1)]);
  const values = [...new Set(forms)].map((name) => `${quote(name)}@en`).join(' ');
  const rows = await sparql(
    `SELECT ?item ?name ?kind ?smiles ?iso ?formula ?chebi ?cid ?chembl ?atc ?ru ?en WHERE {
      VALUES ?name { ${values} }
      { ?item rdfs:label ?name. BIND("label" AS ?kind) } UNION { ?item skos:altLabel ?name. BIND("alias" AS ?kind) }
      FILTER EXISTS { { ?item wdt:P233 [] } UNION { ?item wdt:P662 [] } UNION { ?item wdt:P683 [] } }
      ${DETAILS} }`,
  );
  for (const row of rows) {
    const item = store.add(row);
    if (!item || !row.name) continue;
    const key = row.name.toLowerCase();
    const bucket = byName[key] ?? { label: [], alias: [] };
    byName[key] = bucket;
    const list = row.kind === 'label' ? bucket.label : bucket.alias;
    if (!list.includes(item.id)) list.push(item.id);
  }
  console.error(`names: ${store.items.size} items`);
}

// Pinned items that name resolution cannot find.
const pinned = Object.values(pins).filter((id) => !store.items.has(id));
for (const batch of chunk(pinned, 60)) {
  const rows = await sparql(
    `SELECT ?item ?smiles ?iso ?formula ?chebi ?cid ?chembl ?atc ?ru ?en WHERE {
      VALUES ?item { ${batch.map((id) => `wd:${id}`).join(' ')} } ${DETAILS} }`,
  );
  for (const row of rows) store.add(row);
}

interface Relation {
  item: string;
  property: 'role' | 'use';
  value: string;
  ru?: string | undefined;
  en?: string | undefined;
}
const relations: Relation[] = [];
for (const batch of chunk([...store.items.keys()].sort(), 150)) {
  const values = batch.map((id) => `wd:${id}`).join(' ');
  for (const [property, code] of [
    ['role', 'P2868'],
    ['use', 'P366'],
  ] as const) {
    for (const row of await sparql(
      `SELECT ?item ?value ?ru ?en WHERE { VALUES ?item { ${values} } ?item wdt:${code} ?value.
        OPTIONAL { ?value rdfs:label ?ru FILTER(lang(?ru) = "ru") }
        OPTIONAL { ?value rdfs:label ?en FILTER(lang(?en) = "en") } }`,
    )) {
      relations.push({
        item: qid(row.item ?? ''),
        property,
        value: qid(row.value ?? ''),
        ru: row.ru,
        en: row.en,
      });
    }
  }
}

mkdirSync(join(ROOT, 'data/raw/compounds'), { recursive: true });
writeFileSync(
  join(ROOT, 'data/raw/compounds/wikidata-excipients.json'),
  `${JSON.stringify({
    retrieved: new Date().toISOString().slice(0, 10),
    items: [...store.items.values()],
    byName,
    relations,
  })}\n`,
);
console.error(`${store.items.size} items, ${relations.length} role/use statements`);
