/**
 * ChEBI (CC BY 4.0) from the `chebi_lite.obo.gz` ontology dump: names and `has role` statements.
 * The dump is downloaded once into `data/raw/compounds/` (gitignored) and reused afterwards.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const ROOT = join(import.meta.dirname, '..', '..');
const DUMP = join(ROOT, 'data/raw/compounds/chebi_lite.obo.gz');
const URL = 'https://ftp.ebi.ac.uk/pub/databases/chebi/ontology/chebi_lite.obo.gz';

export interface ChebiTerm {
  id: string;
  name: string;
  roles: string[];
  parents: string[];
}

export interface Chebi {
  version: string;
  terms: Map<string, ChebiTerm>;
}

async function ensureDump(): Promise<Buffer> {
  if (!existsSync(DUMP)) {
    mkdirSync(join(ROOT, 'data/raw/compounds'), { recursive: true });
    const response = await fetch(URL, {
      headers: { 'User-Agent': 'MiniMedCompoundFacts/1.0 (contact dpancov64@gmail.com)' },
    });
    if (!response.ok) throw new Error(`ChEBI dump: HTTP ${response.status}`);
    writeFileSync(DUMP, Buffer.from(await response.arrayBuffer()));
  }
  return readFileSync(DUMP);
}

export async function loadChebi(): Promise<Chebi> {
  const text = gunzipSync(await ensureDump()).toString('utf8');
  const terms = new Map<string, ChebiTerm>();
  let version = '';
  let current: ChebiTerm | undefined;
  let obsolete = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('data-version: ')) version = line.slice(14).trim();
    else if (line === '[Term]') {
      current = { id: '', name: '', roles: [], parents: [] };
      obsolete = false;
    } else if (!current) {
      continue;
    } else if (line.startsWith('id: ')) {
      current.id = line.slice(4).trim();
      terms.set(current.id, current);
    } else if (line.startsWith('name: ')) current.name = line.slice(6).trim();
    else if (line.startsWith('is_a: ')) current.parents.push(line.slice(6).split(' ')[0] ?? '');
    else if (line.startsWith('relationship: RO:0000087 ')) {
      current.roles.push(line.split(' ')[2] ?? '');
    } else if (line.startsWith('is_obsolete: true')) obsolete = true;
    if (current && obsolete && current.id) terms.delete(current.id);
  }
  return { version, terms };
}

/** Names of the roles ChEBI states directly for a compound. */
export function roleNames(chebi: Chebi, id: string | undefined): string[] {
  const term = id ? chebi.terms.get(id) : undefined;
  if (!term) return [];
  return term.roles.flatMap((role) => {
    const name = chebi.terms.get(role)?.name;
    return name ? [name] : [];
  });
}
