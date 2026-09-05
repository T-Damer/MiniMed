import type { MedicalDocument } from '@localmed/contracts';
import {
  parseEsklpMedicationProducts,
  parseMedicationProduct,
} from '@/features/medications/medication-record';

export interface MedicationPreviewExcerpt {
  readonly text: string;
  readonly anchor?: string;
}

/** Registry strength stays source text: it is not a calculated or recommended dose. */
export function medicationPreviewExcerpts(
  document: MedicalDocument,
  phrase: string,
): readonly MedicationPreviewExcerpt[] {
  const product = parseMedicationProduct(document, null);
  const products = product ? [product] : parseEsklpMedicationProducts(document);
  const presentations = products.flatMap((item) =>
    item.presentations.map((presentation) => ({
      text: [
        item.tradeName,
        `Форма: ${presentation.dosageForm}`,
        `Количество / концентрация: ${presentation.strength ?? 'не указано'}`,
        `Путь введения: ${presentation.route ?? 'не указан'}`,
      ].join('\n'),
    })),
  );
  if (presentations.length) return presentations.slice(0, 3);
  if (document.metadata['catalogFamily'] !== 'medication') return [];
  const normalize = (text: string) => text.toLowerCase().replaceAll('ё', 'е');
  const chunks = document.sections
    .flatMap((section) =>
      section.chunks.map((chunk) => ({ ...chunk, sectionTitle: section.title })),
    )
    .filter((chunk) => chunk.originalText.includes('ТН:'));
  const matching = chunks.filter((chunk) =>
    normalize(chunk.originalText).includes(normalize(phrase)),
  );
  return (matching.length ? matching : chunks).slice(0, 3).map((chunk) => ({
    text: `${chunk.sectionTitle}\n${chunk.originalText}`,
    anchor: chunk.anchor,
  }));
}
