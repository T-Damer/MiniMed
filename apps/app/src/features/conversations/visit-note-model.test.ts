import { draftVisitNoteWithModel } from '@localmed/core';
import { describe, expect, it } from 'vitest';

import { localVisitNoteModel } from '@/features/conversations/visit-note-model';
import type { LocalModelStructuredRequest } from '@/features/models/types';

describe('localVisitNoteModel', () => {
  it('drafts from the local model and keeps the items of an answer the token limit cut off', async () => {
    const requests: LocalModelStructuredRequest[] = [];
    const rawText =
      '```json\n{"complaints": [{"text": "Давящая боль в груди", "quote": "давит в груди"}, {"text": "Одыш';
    const model = localVisitNoteModel({
      async completeStructuredTask(request) {
        requests.push(request);
        return { task: request.task, rawText, parsedJson: null, generationMs: 1 };
      },
    });
    const result = await draftVisitNoteWithModel(model, {
      transcript: ['Пациент: Давит в груди, особенно при ходьбе.'],
      remote: false,
    });
    expect(requests).toMatchObject([{ task: 'visit-note', temperature: 0, maxTokens: 512 }]);
    expect(result.unreadableWindows).toBe(0);
    expect(result.draft.fields.find((field) => field.field === 'complaints')).toMatchObject({
      text: 'Давящая боль в груди',
      status: 'supported',
    });
  });
});
