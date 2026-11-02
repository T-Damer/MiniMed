import { VisitNoteDraftSchema } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  draftVisitNoteWithModel,
  splitVisitNoteWindows,
  type VisitNoteModel,
  type VisitNoteModelRequest,
  visitNoteSystemPrompt,
} from './visit-note-model';

const TRANSCRIPT = [
  'Врач: Что беспокоит?',
  'Пациент: Давит в груди, особенно при ходьбе. Уже недели две.',
  'Врач: Лекарства какие-то принимаете?',
  'Пациент: Аспирин по утрам. И на пенициллин у меня аллергия, сыпь была.',
];

function scriptedModel(answers: readonly unknown[]): VisitNoteModel & {
  readonly requests: VisitNoteModelRequest[];
} {
  const requests: VisitNoteModelRequest[] = [];
  return {
    requests,
    async complete(request) {
      requests.push(request);
      return answers[requests.length - 1] ?? null;
    },
  };
}

describe('splitVisitNoteWindows', () => {
  it('packs whole lines, carries a short last line over and cuts an overlong one at a space', () => {
    const windows = splitVisitNoteWindows(
      ['Врач: Что беспокоит?', 'Пациент: Давит в груди.', '', 'Врач: Давно?', 'слово '.repeat(20)],
      48,
    );
    expect(windows[0]).toBe('Врач: Что беспокоит?\nПациент: Давит в груди.');
    expect(windows[1]).toBe('Врач: Давно?');
    expect(windows.every((window) => window.length <= 48)).toBe(true);
    expect(windows.join(' ').split('слово').length - 1).toBe(20);
  });

  it('opens the next window with a short last line of the previous one', () => {
    expect(splitVisitNoteWindows(['А'.repeat(30), 'Б'.repeat(5), 'В'.repeat(30)], 40)).toEqual([
      `${'А'.repeat(30)}\n${'Б'.repeat(5)}`,
      `${'Б'.repeat(5)}\n${'В'.repeat(30)}`,
    ]);
  });
});

describe('draftVisitNoteWithModel', () => {
  it('merges the windows per field and keeps only items whose quote is located', async () => {
    const model = scriptedModel([
      {
        complaints: [
          { text: 'Давящая боль в груди при ходьбе', quote: 'давит в груди, особенно при ходьбе' },
          { text: 'Боль отдаёт в левую руку', quote: 'отдаёт в левую руку' },
        ],
      },
      {
        complaints: [
          { text: 'Давящая боль в груди при ходьбе', quote: 'давит в груди, особенно при ходьбе' },
        ],
        medications: [{ text: 'Аспирин утром', quote: 'Аспирин по утрам' }],
        allergies: { text: 'Пенициллин', quote: 'на пенициллин у меня аллергия' },
        plan: 'Контроль ЭКГ',
        mood: [{ text: 'Тревожен', quote: 'что беспокоит' }],
      },
      'Не могу ответить.',
    ]);
    const progress: number[] = [];
    const result = await draftVisitNoteWithModel(
      model,
      {
        transcript: TRANSCRIPT,
        priorRecord: ['Диагноз: гипертоническая болезнь II стадии.'],
        remote: false,
      },
      { windowChars: 120, onProgress: (done) => progress.push(done) },
    );

    expect(result.windows).toBe(3);
    expect(result.unreadableWindows).toBe(1);
    expect(progress).toEqual([1, 2, 3]);
    expect(model.requests[2]?.userPrompt).toMatch(
      /^Прежняя медицинская запись пациента, фрагмент 3 из 3/u,
    );
    expect(VisitNoteDraftSchema.parse(result.draft)).toEqual(result.draft);
    const fields = new Map(result.draft.fields.map((field) => [field.field, field]));
    expect(fields.get('complaints')).toMatchObject({
      text: 'Давящая боль в груди при ходьбе',
      status: 'supported',
      quotes: [{ source: 'transcript', startLine: 1 }],
    });
    expect(fields.get('medications')?.text).toBe('Аспирин утром');
    expect(fields.get('allergies')).toMatchObject({ text: 'Пенициллин', status: 'supported' });
    expect(fields.get('plan')?.status).toBe('empty');
    expect(result.draft.rejected).toEqual([
      { item: 'field-quote', code: 'unknown-field' },
      { item: 'field-quote', field: 'complaints', code: 'quote-not-found' },
      { item: 'field-quote', field: 'complaints', code: 'duplicate-item' },
      { item: 'field-quote', field: 'plan', code: 'not-an-object' },
    ]);
  });

  it('tells the model when the visit was remote', async () => {
    const model = scriptedModel([]);
    await draftVisitNoteWithModel(model, { transcript: TRANSCRIPT, remote: true });
    expect(model.requests[0]?.systemPrompt).toBe(visitNoteSystemPrompt(true));
    expect(visitNoteSystemPrompt(true)).toContain('аускультации не было');
    expect(visitNoteSystemPrompt(false)).not.toContain('дистанционный');
  });

  it('stops between windows when cancelled and passes model failures on', async () => {
    const controller = new AbortController();
    const model: VisitNoteModel = {
      async complete() {
        controller.abort();
        return {};
      },
    };
    await expect(
      draftVisitNoteWithModel(
        model,
        { transcript: TRANSCRIPT, remote: false },
        { signal: controller.signal, windowChars: 60 },
      ),
    ).rejects.toThrow();

    const broken: VisitNoteModel = {
      complete: () => Promise.reject(new Error('модель выгружена')),
    };
    await expect(
      draftVisitNoteWithModel(broken, { transcript: TRANSCRIPT, remote: false }),
    ).rejects.toThrow('модель выгружена');
  });

  it('keeps «__proto__» from the model as an unknown field', async () => {
    const answer = JSON.parse('{"__proto__": [{"text": "x", "quote": "y"}]}') as unknown;
    const result = await draftVisitNoteWithModel(scriptedModel([answer]), {
      transcript: TRANSCRIPT,
      remote: false,
    });
    expect(result.draft.rejected).toEqual([{ item: 'field-quote', code: 'unknown-field' }]);
  });
});
