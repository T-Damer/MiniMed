import { describe, expect, it } from 'vitest';

import type { LocalModelStructuredRequest } from '@/features/models/types';

import { localFormFillModel } from './form-fill-model';

describe('localFormFillModel', () => {
  it('passes the response schema to the runtime and reads a cut answer', async () => {
    const seen: LocalModelStructuredRequest[] = [];
    const model = localFormFillModel({
      async completeStructuredTask(request) {
        seen.push(request);
        return {
          task: request.task,
          rawText: '{"diabetes": {"value": false, "lines": [6]}, "strokeTia": {"value": tr',
          parsedJson: null,
          generationMs: 1,
        };
      },
    });
    const schema = { type: 'object', required: ['diabetes'] };
    const answer = await model.complete({
      systemPrompt: 'system',
      userPrompt: 'user',
      maxTokens: 300,
      responseSchema: schema,
    });
    expect(seen[0]).toMatchObject({ task: 'form-fill', temperature: 0, responseSchema: schema });
    expect(answer).toEqual({ diabetes: { value: false, lines: [6] } });
  });
});
