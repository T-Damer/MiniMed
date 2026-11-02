import type { VisitNoteModel } from '@localmed/core';

import type { LocalModelController } from '@/features/models/controller';
import { extractTruncatedJson } from '@/features/models/structured-output';

/**
 * The device's local model as the visit-note port (SCRIBE1). An answer cut off by the token limit
 * still gives the items it finished; everything is checked against the sources by the core.
 */
export function localVisitNoteModel(
  controller: Pick<LocalModelController, 'completeStructuredTask'>,
): VisitNoteModel {
  return {
    async complete(request) {
      const response = await controller.completeStructuredTask({
        task: 'visit-note',
        systemPrompt: request.systemPrompt,
        userPrompt: request.userPrompt,
        maxTokens: request.maxTokens,
        temperature: 0,
      });
      return response.parsedJson ?? extractTruncatedJson(response.rawText);
    },
  };
}
