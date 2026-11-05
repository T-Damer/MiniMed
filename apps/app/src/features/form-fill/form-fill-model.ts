import type { FormFillModel } from '@localmed/core/form-fill';

import type { LocalModelController } from '@/features/models/controller';
import { extractTruncatedJson } from '@/features/models/structured-output';

/**
 * The device's local model as the form-fill port (FORMFILL1). The response schema goes to the
 * runtime, which constrains generation to it where it can (wllama: `response_format` →
 * llama.cpp grammar); the Android llama.cpp plugin does not take a schema yet, so there the answer
 * is parsed as text. Either way the core checks every value against the transcript.
 */
export function localFormFillModel(
  controller: Pick<LocalModelController, 'completeStructuredTask'>,
): FormFillModel {
  return {
    async complete(request) {
      const response = await controller.completeStructuredTask({
        task: 'form-fill',
        systemPrompt: request.systemPrompt,
        userPrompt: request.userPrompt,
        maxTokens: request.maxTokens,
        temperature: 0,
        responseSchema: request.responseSchema,
      });
      return response.parsedJson ?? extractTruncatedJson(response.rawText);
    },
  };
}
