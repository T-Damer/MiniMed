import type { MedicalDocument, MedicalSection } from '@localmed/contracts';

const REGISTRY_SECTION_PATTERN = /регистрационн|ограничен/i;

export function displayDocumentTitle(
  document: Pick<MedicalDocument, 'title' | 'shortTitle' | 'sourceType'>,
): string {
  if (document.sourceType === 'official_registry_summary') {
    const inn = document.title.split('—')[0]?.trim();
    if (inn) return inn;
  }
  return document.shortTitle ?? document.title;
}

export function displayDocumentSubtitle(
  document: Pick<MedicalDocument, 'title' | 'sourceType'>,
): string | null {
  if (document.sourceType === 'official_registry_summary') {
    const form = document.title.split('—').slice(1).join('—').trim();
    return form.length > 0 ? form : 'Сведения из официального реестра';
  }
  return null;
}

export function sourceTypeReaderLabel(sourceType: string): string | null {
  if (sourceType === 'official_registry_summary') return null;
  const labels: Readonly<Record<string, string>> = {
    clinical_recommendation_summary: 'Клиническая рекомендация',
    regulatory_act: 'Нормативный документ',
  };
  return labels[sourceType] ?? null;
}

export function orderDocumentSections(
  sections: readonly MedicalSection[],
  sourceType: string,
): readonly MedicalSection[] {
  if (sourceType !== 'official_registry_summary') return sections;
  const primary = sections.filter((section) => !REGISTRY_SECTION_PATTERN.test(section.title));
  const administrative = sections.filter((section) => REGISTRY_SECTION_PATTERN.test(section.title));
  return [...primary, ...administrative];
}
