import type { MedicalDocument } from '@localmed/contracts';

import type { Icd10Icd11Result, Icd11Target } from '@/features/icd11/icd10-icd11-map';
import { isIcd11Document } from '@/features/icd11/icd11-document';
import { pluralRu } from '@/i18n/labels';

/** Text and selection rules of the «В МКБ-11» panel of an ICD-10 card; the component only renders. */

/** How many codes of one document get their own entry (a clinical recommendation can carry dozens). */
export const MAX_CODE_ENTRIES = 30;
/** How many other ICD-10 codes of a merge are listed before «и ещё N». */
export const MAX_MERGED_CODES = 10;

export const ENGLISH_TITLE_MARK = 'англ., перевода ВОЗ нет';
export const MODULE_NOTE = 'Полное описание — в модуле МКБ-11.';
export const TABLES_NOTE =
  'Таблицы ВОЗ показаны без изменений, русские названия — из русской версии МКБ-11 ВОЗ. ' +
  'Это не перевод и не замена кода МКБ-10.';

function stringValues(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  const items: readonly unknown[] = value;
  return items.filter((item): item is string => typeof item === 'string');
}

/**
 * The ICD-10 codes a card carries: `mkbCode` of an ICD-10 reference card, `icd10Codes` of a card that
 * only mentions codes (a clinical recommendation). ICD-11 cards never carry either key.
 */
export function documentIcd10Codes(
  document: Pick<MedicalDocument, 'metadata' | 'sourceType'>,
): readonly string[] {
  if (isIcd11Document(document)) return [];
  const metadata: Readonly<Record<string, unknown>> = document.metadata ?? {};
  return [...stringValues(metadata['mkbCode']), ...stringValues(metadata['icd10Codes'])];
}

/** The target the compact row names: the «одна категория» answer, else the first of the other table. */
export function leadTarget(result: Icd10Icd11Result): Icd11Target {
  const lead = result.oneCategory ?? result.multipleCategories[0];
  if (!lead) throw new Error(`No ICD-11 target for ${result.icd10Code}`);
  return lead;
}

/** «8A6Z», «1A00&XN8P1», or «блок МКБ-11» for a target without a code. */
export function targetCodeText(target: Icd11Target): string {
  return target.cluster ?? target.code ?? 'блок МКБ-11';
}

/** Targets of the result beyond the lead one. */
export function moreTargets(result: Icd10Icd11Result): number {
  return Math.max(0, result.all.length - 1);
}

export function moreTargetsText(count: number): string {
  return `ещё ${String(count)}`;
}

/** The first other codes of a merge, and how many were left out. */
export function mergedPreview(result: Icd10Icd11Result): {
  readonly codes: readonly string[];
  readonly rest: number;
} {
  return {
    codes: result.mergedWith.slice(0, MAX_MERGED_CODES),
    rest: Math.max(0, result.mergedWith.length - MAX_MERGED_CODES),
  };
}

/** «Глава МКБ-11: 08 · Болезни нервной системы». */
export function chapterLine(target: Icd11Target): string {
  const title = target.chapterTitle ? ` · ${target.chapterTitle}` : '';
  return `Глава МКБ-11: ${target.chapter}${title}`;
}

/** Title of the row for a card with several ICD-10 codes: «для 5 кодов МКБ-10». */
export function manyCodesHeading(count: number): string {
  return `В МКБ-11: соответствия для ${String(count)} ${pluralRu(count, 'кода', 'кодов', 'кодов')} МКБ-10`;
}
