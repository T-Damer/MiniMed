/** Wikidata SPARQL (CC0) through the cached client. */
import { cachedFetch } from './http-cache';

const ENDPOINT = 'https://query.wikidata.org/sparql';

/** The variables the queries of this directory select; any of them may be unbound. */
export type Binding = Partial<
  Record<
    | 'item'
    | 'value'
    | 'name'
    | 'kind'
    | 'smiles'
    | 'iso'
    | 'formula'
    | 'chebi'
    | 'cid'
    | 'chembl'
    | 'atc'
    | 'ru'
    | 'en'
    | 'gene',
    string
  >
>;

export async function sparql(query: string): Promise<Binding[]> {
  const text = await cachedFetch({
    url: ENDPOINT,
    body: `query=${encodeURIComponent(query)}`,
    accept: 'application/sparql-results+json',
    contentType: 'application/x-www-form-urlencoded',
  });
  if (!text) return [];
  const parsed = JSON.parse(text) as {
    results: { bindings: Record<string, { value: string }>[] };
  };
  return parsed.results.bindings.map(
    (row) =>
      Object.fromEntries(Object.entries(row).map(([key, cell]) => [key, cell.value])) as Binding,
  );
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    result.push(items.slice(index, index + size));
  return result;
}

export const quote = (value: string) =>
  `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
export const qid = (uri: string) => uri.slice(uri.lastIndexOf('/') + 1);
