import type { MedicalDocument } from '@localmed/contracts';

interface ClinicalPrintCover {
  readonly codes: readonly string[];
  readonly ages: readonly string[];
  readonly approvalYear: string | undefined;
  readonly developers: readonly string[];
  readonly id: string | undefined;
}

const CONTENTS_START = /(?:^|\n)\s*(?:Оглавление|Содержание|Список\s+сокращений)(?=[\s.:]|$)/iu;
const ICD_FIELD =
  /Кодирование\s+по\s+Международной([\s\S]*?)(?=Возрастн|Год\s+утверждения|Разработчик|$)/iu;
const ICD_CODE =
  /(?<![\p{L}\d])[A-ZА-Я]\d{2}(?:\.\d{1,2})?(?:\s*[-–—]\s*[A-ZА-Я]\d{2}(?:\.\d{1,2})?)?(?![\p{L}\d])/gu;
const APPROVAL_YEAR = /Год\s+утверждения(?:\s*\([^)]*\))?\s*:\s*((?:19|20)\d{2})(?![\d_])/iu;
const DEVELOPERS =
  /Разработчик(?:и)?\s+(?:клиническ|методическ)(?:ой|их)\s+рекомендаци[\p{L}]*\s*:\s*([\s\S]*?)(?=\n\s*(?:Одобрено|Согласовано|При\s+участии)|$)/iu;

function values(value: unknown): readonly string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : [];
}

function openingPages(document: MedicalDocument): string {
  let text = '';
  for (const section of document.sections) {
    for (const chunk of section.chunks) {
      const page = chunk.pageStart ?? section.pageStart;
      if (page !== null && page > 3) return text;
      if (page === null || page < 1) continue;
      const next = `${text}\n${chunk.originalText.slice(0, 6_000 - text.length)}`;
      const contents = next.search(CONTENTS_START);
      if (contents >= 0) return next.slice(0, contents);
      text = next;
      if (text.length >= 6_000) return text;
    }
    if (section.pageStart !== null && section.pageStart > 3) break;
  }
  return text;
}

/** PDF packs often keep title-page facts only in the extracted opening pages. */
export function clinicalPrintCover(document: MedicalDocument): ClinicalPrintCover {
  const text = openingPages(document);
  const metadata = document.metadata;
  const codes = values(metadata['icd10Codes']);
  const ages = values(metadata['ageCategories']);
  const developers = [...values(metadata['developers']), ...values(metadata['developer'])];
  const sourceCodes = text.match(ICD_FIELD)?.[1]?.match(ICD_CODE) ?? [];
  const sourceDevelopers =
    text
      .match(DEVELOPERS)?.[1]
      ?.split(/(?:^|\n)\s*[•●▪\uf0b7]\s*/u)
      .map((item) => item.replace(/\s+/gu, ' ').trim())
      .filter(Boolean) ?? [];
  const approvalYear = metadata['approvalYear'];
  const year =
    typeof approvalYear === 'number' || typeof approvalYear === 'string'
      ? String(approvalYear).trim()
      : '';
  return {
    codes: codes.length ? codes : [...new Set(sourceCodes)],
    ages: ages.length ? ages : (document.ageGroups ?? values(metadata['ageGroups'])),
    approvalYear: /^(?:19|20)\d{2}$/u.test(year) ? year : text.match(APPROVAL_YEAR)?.[1],
    developers: [...new Set(developers.length ? developers : sourceDevelopers)],
    id: values(metadata['officialId'])[0],
  };
}
