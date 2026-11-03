/**
 * Fetches curated mechanisms of action (ChEMBL, CC BY-SA 3.0) for the Wikidata items of
 * `wikidata-actives.json` that carry a ChEMBL id: action type and the target with its gene symbol.
 *
 *   bun tools/compounds/fetch-chembl.ts
 *
 * Output `data/raw/compounds/chembl-mechanisms.json` (gitignored); raw API pages are cached.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { cachedFetch } from './http-cache';
import { chunk } from './wikidata';

const ROOT = join(import.meta.dirname, '..', '..');
const API = 'https://www.ebi.ac.uk/chembl/api/data';

async function getJson<T>(path: string): Promise<T> {
  const text = await cachedFetch({ url: `${API}/${path}`, accept: 'application/json' });
  return JSON.parse(text || '{}') as T;
}

const wikidata = JSON.parse(
  readFileSync(join(ROOT, 'data/raw/compounds/wikidata-actives.json'), 'utf8'),
) as { items: { id: string; chembl?: string }[] };
const ids = [
  ...new Set(wikidata.items.flatMap((item) => (item.chembl ? [item.chembl] : []))),
].sort();

const parentOf: Record<string, string> = {};
for (const batch of chunk(ids, 50)) {
  const page = await getJson<{
    molecules?: {
      molecule_chembl_id: string;
      molecule_hierarchy: { parent_chembl_id: string } | null;
    }[];
  }>(
    `molecule.json?molecule_chembl_id__in=${batch.join(',')}&limit=100&only=molecule_chembl_id,molecule_hierarchy`,
  );
  for (const molecule of page.molecules ?? []) {
    parentOf[molecule.molecule_chembl_id] =
      molecule.molecule_hierarchy?.parent_chembl_id ?? molecule.molecule_chembl_id;
  }
}

interface Mechanism {
  molecule: string;
  moa: string;
  action: string;
  target: string | null;
}
const mechanisms: Mechanism[] = [];
const parents = [...new Set(Object.values(parentOf))].sort();
for (const batch of chunk(parents, 50)) {
  let offset = 0;
  for (;;) {
    const page = await getJson<{
      mechanisms?: {
        molecule_chembl_id: string;
        mechanism_of_action: string;
        action_type: string | null;
        target_chembl_id: string | null;
      }[];
      page_meta?: { next: string | null };
    }>(
      `mechanism.json?molecule_chembl_id__in=${batch.join(',')}&limit=200&offset=${offset}&only=molecule_chembl_id,mechanism_of_action,action_type,target_chembl_id`,
    );
    for (const row of page.mechanisms ?? []) {
      mechanisms.push({
        molecule: row.molecule_chembl_id,
        moa: row.mechanism_of_action,
        action: row.action_type ?? '',
        target: row.target_chembl_id,
      });
    }
    if (!page.page_meta?.next) break;
    offset += 200;
  }
  console.error(`mechanisms: ${mechanisms.length}`);
}

interface Target {
  name: string;
  organism: string;
  type: string;
  genes: string[];
}
const targets: Record<string, Target> = {};
const targetIds = [...new Set(mechanisms.flatMap((m) => (m.target ? [m.target] : [])))].sort();
for (const batch of chunk(targetIds, 40)) {
  const page = await getJson<{
    targets?: {
      target_chembl_id: string;
      pref_name: string;
      organism: string | null;
      target_type: string;
      target_components: {
        target_component_synonyms: { component_synonym: string; syn_type: string }[];
      }[];
    }[];
  }>(`target.json?target_chembl_id__in=${batch.join(',')}&limit=100`);
  for (const target of page.targets ?? []) {
    const genes = target.target_components.flatMap((component) =>
      component.target_component_synonyms
        .filter((synonym) => synonym.syn_type === 'GENE_SYMBOL')
        .map((synonym) => synonym.component_synonym),
    );
    targets[target.target_chembl_id] = {
      name: target.pref_name,
      organism: target.organism ?? '',
      type: target.target_type,
      genes: [...new Set(genes)],
    };
  }
}

mkdirSync(join(ROOT, 'data/raw/compounds'), { recursive: true });
writeFileSync(
  join(ROOT, 'data/raw/compounds/chembl-mechanisms.json'),
  `${JSON.stringify({ retrieved: new Date().toISOString().slice(0, 10), parentOf, mechanisms, targets })}\n`,
);
console.error(`${mechanisms.length} mechanisms, ${Object.keys(targets).length} targets`);
