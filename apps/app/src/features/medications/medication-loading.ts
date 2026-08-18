import type { MedicalDocument, MedicalDocumentSummary } from '@localmed/contracts';

const DOCUMENT_FETCH_BATCH_SIZE = 60;

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function documentFromSummary(summary: MedicalDocumentSummary): MedicalDocument | null {
  if (!summary.metadata) return null;
  return { ...summary, metadata: summary.metadata, sections: [] };
}

export async function processMedicationSummariesInBatches(
  summaries: readonly MedicalDocumentSummary[],
  onBatch: (documents: readonly MedicalDocument[]) => void,
): Promise<void> {
  for (let start = 0; start < summaries.length; start += DOCUMENT_FETCH_BATCH_SIZE) {
    const batch = summaries.slice(start, start + DOCUMENT_FETCH_BATCH_SIZE);
    onBatch(
      batch.flatMap((summary) => {
        const document = documentFromSummary(summary);
        return document ? [document] : [];
      }),
    );
    await yieldToEventLoop();
  }
}
