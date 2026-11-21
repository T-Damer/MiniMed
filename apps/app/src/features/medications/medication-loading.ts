import type { MedicalDocument, MedicalDocumentSummary } from '@localmed/contracts';

const READY_SUMMARY_BATCH_SIZE = 60;
// Full substance summaries contain the registry registrations, packages and source facts.
const METADATA_READ_BATCH_SIZE = 4;

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
  options?: {
    readonly read?: (id: string) => Promise<MedicalDocumentSummary>;
    readonly signal: AbortSignal;
  },
): Promise<void> {
  const read = options?.read;
  const signal = options?.signal;
  const batchSize = read ? METADATA_READ_BATCH_SIZE : READY_SUMMARY_BATCH_SIZE;
  for (let start = 0; start < summaries.length; start += batchSize) {
    if (signal?.aborted) return;
    const selected = summaries.slice(start, start + batchSize);
    const batch = read ? await Promise.all(selected.map((summary) => read(summary.id))) : selected;
    if (signal?.aborted) return;
    onBatch(
      batch.flatMap((summary) => {
        const document = documentFromSummary(summary);
        return document ? [document] : [];
      }),
    );
    await yieldToEventLoop();
  }
}
