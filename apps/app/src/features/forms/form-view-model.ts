import type {
  FormField,
  FormRuleParagraph,
  FormSchema,
  FormScreenSection,
} from '@localmed/contracts';

import type { ClinicalEpisode, PatientVaultSnapshot } from '@/state/patient-domain';

type ChoiceOption = NonNullable<FormField['options']>[number];

/** Lists longer than this are a searchable dropdown of codes; shorter ones are shown whole. */
export const CODE_LIST_MIN_OPTIONS = 7;

export function capitalizeFirst(text: string): string {
  return text ? text.charAt(0).toLocaleUpperCase('ru-RU') + text.slice(1) : text;
}

export function isCodeList(field: FormField): boolean {
  return (field.options?.length ?? 0) >= CODE_LIST_MIN_OPTIONS;
}

export function optionLabel(field: FormField, option: ChoiceOption): string {
  return isCodeList(field) ? `${option.value} — ${option.label}` : capitalizeFirst(option.label);
}

export function sectionFields(
  schema: FormSchema,
  section: FormScreenSection,
): readonly FormField[] {
  const byId = new Map(schema.fields.map((field) => [field.id, field]));
  return section.fieldIds.flatMap((id) => {
    const field = byId.get(id);
    return field ? [field] : [];
  });
}

export interface FieldRuleView {
  readonly status: FormField['rule']['status'];
  readonly paragraphs: readonly FormRuleParagraph[];
  readonly note: string | undefined;
}

export function fieldRuleView(schema: FormSchema, field: FormField): FieldRuleView {
  const byId = new Map(schema.rules.map((rule) => [rule.id, rule]));
  return {
    status: field.rule.status,
    paragraphs: field.rule.paragraphIds.flatMap((id) => {
      const paragraph = byId.get(id);
      return paragraph ? [paragraph] : [];
    }),
    note: field.rule.note,
  };
}

/** Where a paragraph sits in the official publication, e.g. `п. 6.11, стр. 35 PDF`. */
export function ruleCitation(schema: FormSchema, paragraph: FormRuleParagraph): string {
  const pages = [...new Set(paragraph.spans.map((span) => span.pdfPage))];
  const pageText = pages.length === 1 ? `стр. ${pages[0]}` : `стр. ${pages[0]}–${pages.at(-1)}`;
  return (
    `Порядок заполнения (приложение № ${schema.source.rulesAppendix.number} ` +
    `к приказу № ${schema.source.orderNumber}), п. ${paragraph.id}; ${pageText} официального PDF`
  );
}

/** The episode a diagnosis is taken from by default: the latest open one, else the latest. */
export function defaultEpisode(
  snapshot: PatientVaultSnapshot,
  patientId: string,
): ClinicalEpisode | undefined {
  const episodes = snapshot.episodes
    .filter((episode) => episode.patientId === patientId)
    .toSorted((left, right) => right.startedAt.localeCompare(left.startedAt));
  return episodes.find((episode) => episode.status === 'open') ?? episodes[0];
}
