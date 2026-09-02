import type { MedicalDocumentSummary } from '@localmed/contracts';

export interface ClinicalMedicationLink {
  readonly pointerDocumentId: string;
  readonly targetDocumentId: string;
  readonly relationId: string;
  readonly recommendationTitle: string;
  readonly mnnDocumentId: string;
  readonly inn: string;
  readonly ageGroups: readonly string[];
  readonly evidenceQuote: string;
  readonly sourceAnchor: string;
}

type RecordValue = Readonly<Record<string, unknown>>;

interface ClinicalPointerMetadata extends RecordValue {
  readonly contentMode?: unknown;
  readonly catalogFamily?: unknown;
  readonly targetDocumentId?: unknown;
  readonly clinicalMedicationLinks?: unknown;
}

interface ClinicalMedicationLinkMetadata extends RecordValue {
  readonly relationId?: unknown;
  readonly mnnDocumentId?: unknown;
  readonly inn?: unknown;
  readonly targetDocumentId?: unknown;
  readonly predicate?: unknown;
  readonly relationStatus?: unknown;
  readonly reviewStatus?: unknown;
  readonly ageGroups?: unknown;
  readonly evidenceQuote?: unknown;
  readonly sourceAnchor?: unknown;
}

function recordValue(value: unknown): RecordValue | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function ageGroupsValue(value: unknown): readonly string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const groups = value.map(nonEmptyString);
  return groups.every((group): group is string => group !== null) ? groups : null;
}

function compareLinks(left: ClinicalMedicationLink, right: ClinicalMedicationLink): number {
  return (
    left.recommendationTitle.localeCompare(right.recommendationTitle, 'ru') ||
    left.relationId.localeCompare(right.relationId, 'ru')
  );
}

export function parseClinicalMedicationLinks(
  summaries: readonly MedicalDocumentSummary[],
  mnnDocumentId: string,
): readonly ClinicalMedicationLink[] {
  const linksByRelationId = new Map<string, ClinicalMedicationLink>();

  for (const summary of summaries) {
    if (summary.sourceType !== 'core_catalog_pointer') continue;
    const metadata = recordValue(summary.metadata) as ClinicalPointerMetadata | null;
    if (metadata?.contentMode !== 'module-pointer' || metadata.catalogFamily !== 'clinical') {
      continue;
    }

    const targetDocumentId = nonEmptyString(metadata.targetDocumentId);
    const rawLinks = metadata.clinicalMedicationLinks;
    if (!targetDocumentId || !Array.isArray(rawLinks)) continue;

    for (const rawLink of rawLinks) {
      const link = recordValue(rawLink) as ClinicalMedicationLinkMetadata | null;
      if (!link) continue;

      const relationId = nonEmptyString(link.relationId);
      const linkMnnDocumentId = nonEmptyString(link.mnnDocumentId);
      const inn = nonEmptyString(link.inn);
      const linkTargetDocumentId = nonEmptyString(link.targetDocumentId);
      const evidenceQuote = nonEmptyString(link.evidenceQuote);
      const sourceAnchor = nonEmptyString(link.sourceAnchor);
      const ageGroups = ageGroupsValue(link.ageGroups);
      if (
        !relationId ||
        !linkMnnDocumentId ||
        !inn ||
        !linkTargetDocumentId ||
        link.predicate !== 'recommended-for' ||
        link.relationStatus !== 'guideline' ||
        link.reviewStatus !== 'proposed' ||
        !evidenceQuote ||
        !sourceAnchor ||
        ageGroups === null ||
        linkMnnDocumentId !== mnnDocumentId ||
        linkTargetDocumentId !== targetDocumentId
      ) {
        continue;
      }

      if (!linksByRelationId.has(relationId)) {
        linksByRelationId.set(relationId, {
          pointerDocumentId: summary.id,
          targetDocumentId,
          relationId,
          recommendationTitle: summary.title,
          mnnDocumentId: linkMnnDocumentId,
          inn,
          ageGroups,
          evidenceQuote,
          sourceAnchor,
        });
      }
    }
  }

  const links = [...linksByRelationId.values()].sort(compareLinks).map((link) =>
    Object.freeze({
      ...link,
      ageGroups: Object.freeze([...link.ageGroups]),
    }),
  );
  return Object.freeze(links);
}
