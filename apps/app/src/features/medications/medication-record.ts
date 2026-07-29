import type { MedicalDocument } from '@localmed/contracts';

export interface MedicationPackage {
  readonly description: string;
  readonly prescriptionStatus: string | null;
}

export interface MedicationPresentation {
  readonly dosageForm: string;
  readonly strength: string | null;
  readonly route: string | null;
  readonly packages: readonly MedicationPackage[];
}

export interface MedicationProduct {
  readonly registrationDocumentId: string;
  readonly instructionDocumentId: string | null;
  readonly registrationNumber: string;
  readonly tradeName: string;
  readonly inn: string;
  readonly registrationStatus: string;
  readonly prescriptionStatus: string | null;
  readonly holder: string | null;
  readonly manufacturer: string | null;
  readonly registrationDate: string | null;
  readonly pharmacotherapeuticGroups: readonly string[];
  readonly presentations: readonly MedicationPresentation[];
}

interface MedicationMetadata extends Readonly<Record<string, unknown>> {
  readonly contentMode?: unknown;
  readonly registrationNumber?: unknown;
  readonly tradeName?: unknown;
  readonly inn?: unknown;
  readonly registrationStatus?: unknown;
  readonly prescriptionStatus?: unknown;
  readonly holder?: unknown;
  readonly manufacturer?: unknown;
  readonly registrationDate?: unknown;
  readonly pharmacotherapeuticGroups?: unknown;
  readonly presentations?: unknown;
  readonly description?: unknown;
  readonly dosageForm?: unknown;
  readonly strength?: unknown;
  readonly route?: unknown;
  readonly packages?: unknown;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.flatMap((item) => stringValue(item) ?? []) : [];
}

function parsePackages(value: unknown): readonly MedicationPackage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return [];
    const row = item as MedicationMetadata;
    const description = stringValue(row.description);
    if (!description) return [];
    return [{ description, prescriptionStatus: stringValue(row.prescriptionStatus) }];
  });
}

function parsePresentations(value: unknown): readonly MedicationPresentation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return [];
    const row = item as MedicationMetadata;
    const dosageForm = stringValue(row.dosageForm);
    if (!dosageForm) return [];
    return [
      {
        dosageForm,
        strength: stringValue(row.strength),
        route: stringValue(row.route),
        packages: parsePackages(row.packages),
      },
    ];
  });
}

export function parseMedicationProduct(
  document: MedicalDocument,
  instructionDocumentId: string | null,
): MedicationProduct | null {
  const metadata = document.metadata as MedicationMetadata;
  if (metadata.contentMode !== 'registry-normalized') return null;
  const registrationNumber = stringValue(metadata.registrationNumber);
  const tradeName = stringValue(metadata.tradeName);
  const inn = stringValue(metadata.inn);
  const registrationStatus = stringValue(metadata.registrationStatus);
  const presentations = parsePresentations(metadata.presentations);
  if (!registrationNumber || !tradeName || !inn || !registrationStatus || !presentations.length) {
    return null;
  }
  return {
    registrationDocumentId: document.id,
    instructionDocumentId,
    registrationNumber,
    tradeName,
    inn,
    registrationStatus,
    prescriptionStatus: stringValue(metadata.prescriptionStatus),
    holder: stringValue(metadata.holder),
    manufacturer: stringValue(metadata.manufacturer),
    registrationDate: stringValue(metadata.registrationDate),
    pharmacotherapeuticGroups: stringList(metadata.pharmacotherapeuticGroups),
    presentations,
  };
}

export function medicationDocumentRegistration(document: MedicalDocument): string | null {
  return stringValue((document.metadata as MedicationMetadata).registrationNumber);
}
