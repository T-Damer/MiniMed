/** Shared item collection for the Wikidata fetchers: one record per item id, rows merged. */
import { type Binding, qid } from './wikidata';

export interface WdItem {
  id: string;
  ru?: string;
  en?: string;
  smiles: string[];
  isomeric: string[];
  formula?: string;
  atc: string[];
  chebi?: string;
  cid?: number;
  chembl?: string;
}

export const DETAILS = `
  OPTIONAL { ?item wdt:P233 ?smiles }
  OPTIONAL { ?item wdt:P2017 ?iso }
  OPTIONAL { ?item wdt:P274 ?formula }
  OPTIONAL { ?item wdt:P683 ?chebi }
  OPTIONAL { ?item wdt:P662 ?cid }
  OPTIONAL { ?item wdt:P592 ?chembl }
  OPTIONAL { ?item wdt:P267 ?atc }
  OPTIONAL { ?item rdfs:label ?ru FILTER(lang(?ru) = "ru") }
  OPTIONAL { ?item rdfs:label ?en FILTER(lang(?en) = "en") }`;

export const SELECT = 'SELECT ?item ?smiles ?iso ?formula ?chebi ?cid ?chembl ?atc ?ru ?en';

export class ItemStore {
  readonly items = new Map<string, WdItem>();

  add(row: Binding): WdItem | undefined {
    if (!row.item) return undefined;
    const id = qid(row.item);
    const item = this.items.get(id) ?? { id, smiles: [], isomeric: [], atc: [] };
    this.items.set(id, item);
    if (row.ru) item.ru = row.ru;
    if (row.en) item.en = row.en;
    if (row.smiles && !item.smiles.includes(row.smiles)) item.smiles.push(row.smiles);
    if (row.iso && !item.isomeric.includes(row.iso)) item.isomeric.push(row.iso);
    if (row.formula) item.formula = row.formula;
    if (row.atc && !item.atc.includes(row.atc)) item.atc.push(row.atc);
    if (row.chebi) item.chebi = `CHEBI:${row.chebi.replace(/^CHEBI:/u, '')}`;
    if (row.cid && (!item.cid || Number(row.cid) < item.cid)) item.cid = Number(row.cid);
    if (row.chembl) item.chembl = row.chembl;
    return item;
  }
}
