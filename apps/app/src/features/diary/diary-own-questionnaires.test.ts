import { describe, expect, it, vi } from 'vitest';

import { scoreAssessment } from '@/features/assessments/assessment-engine';
import {
  userQuestionnaireEditPath,
  userQuestionnaireHomePath,
  userQuestionnaireNewPath,
} from '@/features/assessments/assessment-routing';
import { questionnaireSeries } from '@/features/diary/dashboard/diary-insights';
import { atTime } from '@/features/diary/diary-care';
import {
  type CareDraft,
  careDraftFrom,
  careInvitation,
  emptyCareDraft,
  newCareSection,
  newCustomQuestionnaireSection,
} from '@/features/diary/diary-care-draft';
import {
  CUSTOM_QUESTIONNAIRE_SLUG,
  DiaryFormatError,
  type DiaryInvitation,
  MAX_DIARY_CUSTOM_CHARS,
  parseDiaryEntry,
  parseDiaryInvitation,
} from '@/features/diary/diary-model';
import {
  OWN_QUESTIONNAIRE_NEW_HASH,
  OWN_QUESTIONNAIRES_HASH,
  ownQuestionnaireEditHash,
} from '@/features/diary/diary-own-questionnaires';
import {
  checkpointQuestionnaireAbout,
  customQuestionnaireSlug,
  loadCheckpointQuestionnaire,
  questionnaireCheckpointId,
} from '@/features/diary/diary-questionnaires';
import {
  parseUserQuestionnaire,
  type UserQuestionnaire,
  withoutUserQuestionnaireImages,
} from '@/state/user-questionnaire-format';

const PICTURE = { id: 'pic-1', name: 'Схема', dataUrl: 'data:image/png;base64,aA==' };

/** A scored two-question questionnaire with a picture on the questionnaire and on a question. */
function ownQuestionnaire(next: Partial<UserQuestionnaire> = {}): UserQuestionnaire {
  return parseUserQuestionnaire({
    format: 'minimed-questionnaire',
    version: 2,
    title: 'Тревога за неделю',
    description: 'Две вопроса о неделе.',
    disclaimer: 'Авторский опросник.',
    population: { group: 'adults' },
    images: [PICTURE],
    sections: [],
    questions: [
      {
        id: 'q1',
        prompt: 'Тревожно ли вам?',
        text: '',
        images: [{ ...PICTURE, id: 'pic-2' }],
        options: [
          { id: 'q1-no', label: 'Нет', weight: 0 },
          { id: 'q1-yes', label: 'Да', weight: 3 },
        ],
      },
      {
        id: 'q2',
        prompt: 'Плохо ли вы спите?',
        text: '',
        images: [],
        options: [
          { id: 'q2-no', label: 'Нет', weight: 0 },
          { id: 'q2-yes', label: 'Да', weight: 2 },
        ],
      },
    ],
    scoreBySection: false,
    bands: [
      { id: 'b1', scope: 'total', min: 0, max: 2, headline: 'Спокойно', message: 'Всё в порядке.' },
      {
        id: 'b2',
        scope: 'total',
        min: 3,
        max: 5,
        headline: 'Тревожно',
        message: 'Нужен разговор.',
      },
    ],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...next,
  });
}

const SOURCE_ID = 'user-library-questionnaire-0001';

function issue(draft: CareDraft, previous?: DiaryInvitation): DiaryInvitation {
  return careInvitation({ id: 'carediary02', draft, doctor: 'Д-р', note: '', previous });
}

function draftWith(section = newCustomQuestionnaireSection(ownQuestionnaire(), SOURCE_ID)) {
  return {
    ...emptyCareDraft(),
    sections: [{ ...newCareSection('drug'), title: 'Сертралин' }, section],
  } satisfies CareDraft;
}

describe('a doctor-made questionnaire in a care diary', () => {
  it('travels inside the invitation without pictures and parses back', () => {
    const invitation = issue(draftWith());
    const checkpoint = invitation.checkpoints?.find((candidate) => candidate.custom);
    const slug = customQuestionnaireSlug(SOURCE_ID);
    expect(slug).toMatch(CUSTOM_QUESTIONNAIRE_SLUG);
    expect(checkpoint).toMatchObject({
      id: questionnaireCheckpointId(slug),
      kind: 'questionnaire',
      label: 'Тревога за неделю',
      questionnaire: slug,
      everyDays: 7,
    });
    expect(checkpoint?.id.length).toBeLessThanOrEqual(24);
    expect(checkpoint?.custom?.images).toEqual([]);
    expect(checkpoint?.custom?.questions.every((question) => question.images.length === 0)).toBe(
      true,
    );
    // The wire form (JSON) parses to the same invitation.
    const again = parseDiaryInvitation(JSON.parse(JSON.stringify(invitation)));
    expect(again.checkpoints?.find((candidate) => candidate.custom)).toEqual(checkpoint);
  });

  it('removes pictures from an untrusted invitation before validating them', () => {
    const invitation = issue(draftWith());
    const wire = JSON.parse(JSON.stringify(invitation)) as {
      checkpoints: { custom?: { images: unknown } }[];
    };
    const custom = wire.checkpoints.find((checkpoint) => checkpoint.custom)?.custom;
    if (!custom) throw new Error('No embedded questionnaire.');
    // A picture that would fail the image rules (not an image data URL) must not reject the diary.
    custom.images = [{ id: 'x', name: 'x', dataUrl: 'javascript:alert(1)' }];
    const parsed = parseDiaryInvitation(wire);
    expect(parsed.checkpoints?.find((checkpoint) => checkpoint.custom)?.custom?.images).toEqual([]);
  });

  it('rejects a broken, oversized, mislabelled or missing embedded questionnaire', () => {
    const base = JSON.parse(JSON.stringify(issue(draftWith()))) as {
      checkpoints: Record<string, unknown>[];
    };
    const withCheckpoint = (change: Record<string, unknown>) => ({
      ...base,
      checkpoints: base.checkpoints.map((checkpoint) =>
        checkpoint['custom'] ? { ...checkpoint, ...change } : checkpoint,
      ),
    });
    expect(() => parseDiaryInvitation(withCheckpoint({ custom: { title: 'x' } }))).toThrow(
      DiaryFormatError,
    );
    expect(() => parseDiaryInvitation(withCheckpoint({ custom: undefined }))).toThrow(
      /опросник врача/u,
    );
    expect(() =>
      parseDiaryInvitation(
        withCheckpoint({
          custom: {
            ...ownQuestionnaire(),
            questions: ownQuestionnaire().questions.map((question) => ({
              ...question,
              text: 'я'.repeat(MAX_DIARY_CUSTOM_CHARS / 2),
            })),
          },
        }),
      ),
    ).toThrow(/слишком большой/u);
    // A built-in slug cannot carry a replacement text.
    expect(() => parseDiaryInvitation(withCheckpoint({ questionnaire: 'phq-9' }))).toThrow(/own-/u);
  });

  it('keeps its checkpoint on re-issue, and ended when the doctor removes it', () => {
    const first = issue(draftWith());
    const draft = careDraftFrom(first);
    const section = draft.sections.find((candidate) => candidate.custom);
    expect(section).toMatchObject({
      kind: 'questionnaire',
      title: 'Тревога за неделю',
      quiz: customQuestionnaireSlug(SOURCE_ID),
    });
    expect(section?.custom?.questions).toHaveLength(2);

    const second = issue(draft, first);
    expect(second.checkpoints?.find((checkpoint) => checkpoint.custom)?.custom).toEqual(
      first.checkpoints?.find((checkpoint) => checkpoint.custom)?.custom,
    );

    const removed = issue(
      { ...draft, sections: draft.sections.filter((candidate) => !candidate.custom) },
      second,
    );
    const ended = removed.checkpoints?.find((checkpoint) => checkpoint.custom);
    expect(ended?.ended).toBe(true);
    expect(ended?.custom?.title).toBe('Тревога за неделю');
  });

  it('shows its length instead of a built-in description', () => {
    const checkpoint = issue(draftWith()).checkpoints?.find((candidate) => candidate.custom);
    if (!checkpoint) throw new Error('No custom checkpoint.');
    expect(checkpointQuestionnaireAbout(checkpoint)).toBe('2 вопроса');
    expect(checkpointQuestionnaireAbout({ questionnaire: 'phq-9' })).toBe('настроение');
  });

  it('loads and scores like a built-in one, bands included', async () => {
    const invitation = issue(draftWith());
    const checkpoint = invitation.checkpoints?.find((candidate) => candidate.custom);
    if (!checkpoint) throw new Error('No custom checkpoint.');
    const definition = await loadCheckpointQuestionnaire(checkpoint);
    expect(definition.slug).toBe(checkpoint.questionnaire);
    expect(definition.questions.map((question) => question.id)).toEqual(['q1', 'q2']);
    const scored = scoreAssessment(definition, { q1: 3, q2: 2 });
    expect(scored.ok && scored.value.headline).toBe('Тревожно');

    // The built-in path is unchanged.
    expect((await loadCheckpointQuestionnaire({ questionnaire: 'phq-9' })).slug).toBe('phq-9');
    await expect(loadCheckpointQuestionnaire({})).rejects.toThrow(/опросник/u);
  });

  it('reaches the doctor chart: total, maximum and the band headline per answered entry', async () => {
    const invitation = issue(draftWith());
    const checkpoint = invitation.checkpoints?.find((candidate) => candidate.custom);
    if (!checkpoint) throw new Error('No custom checkpoint.');
    const entry = (id: string, day: string, answers: Record<string, number>) =>
      parseDiaryEntry(invitation, {
        id,
        at: atTime(day, '12:00'),
        values: {},
        check: checkpoint.id,
        answers,
      });
    const series = await questionnaireSeries(invitation, [
      entry('answer000001', '2026-10-20', { q1: 0, q2: 0 }),
      entry('answer000002', '2026-10-27', { q1: 3, q2: 2 }),
    ]);
    expect(series).toHaveLength(1);
    expect(series[0]?.title).toBe('Тревога за неделю');
    expect(series[0]?.points.map((point) => [point.total, point.max, point.headline])).toEqual([
      [0, 5, 'Спокойно'],
      [5, 5, 'Тревожно'],
    ]);
  });

  it('charts nothing for a questionnaire without points', async () => {
    const plain = ownQuestionnaire({
      bands: [],
      questions: ownQuestionnaire().questions.map((question) => ({
        ...question,
        options: question.options.map(({ weight: _weight, ...option }) => option),
      })),
    });
    const invitation = issue(draftWith(newCustomQuestionnaireSection(plain, SOURCE_ID)));
    const checkpoint = invitation.checkpoints?.find((candidate) => candidate.custom);
    if (!checkpoint) throw new Error('No custom checkpoint.');
    const answered = parseDiaryEntry(invitation, {
      id: 'answer000003',
      at: atTime('2026-10-27', '12:00'),
      values: {},
      check: checkpoint.id,
      answers: { q1: 1, q2: 0 },
    });
    expect(await questionnaireSeries(invitation, [answered])).toEqual([]);
  });
});

describe('questionnaire format helpers', () => {
  it('drops pictures from a questionnaire and keeps the rest', () => {
    const stripped = withoutUserQuestionnaireImages(ownQuestionnaire());
    expect(stripped.images).toEqual([]);
    expect(stripped.questions.flatMap((question) => question.images)).toEqual([]);
    expect(stripped.questions.map((question) => question.prompt)).toEqual([
      'Тревожно ли вам?',
      'Плохо ли вы спите?',
    ]);
  });

  it('gives one library file the same short slug every time', () => {
    expect(customQuestionnaireSlug(SOURCE_ID)).toBe(customQuestionnaireSlug(SOURCE_ID));
    expect(customQuestionnaireSlug(SOURCE_ID)).not.toBe(customQuestionnaireSlug('another-file'));
    expect(
      questionnaireCheckpointId(customQuestionnaireSlug(SOURCE_ID)).length,
    ).toBeLessThanOrEqual(24);
  });
});

describe('picker data', () => {
  it('addresses the main app questionnaire editor', () => {
    expect(OWN_QUESTIONNAIRE_NEW_HASH).toBe(userQuestionnaireNewPath());
    expect(OWN_QUESTIONNAIRES_HASH).toBe(userQuestionnaireHomePath());
    expect(ownQuestionnaireEditHash('file 1')).toBe(userQuestionnaireEditPath('file 1'));
  });

  it('lists the doctor files with their size, scoring and readiness', async () => {
    vi.resetModules();
    vi.doMock('@/state/user-questionnaires', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/state/user-questionnaires')>()),
      listUserQuestionnaires: async () => [
        {
          file: { id: SOURCE_ID, title: 'Тревога за неделю' },
          questionnaire: ownQuestionnaire(),
        },
        {
          file: { id: 'file-2', title: 'Без возраста' },
          questionnaire: (() => {
            const { population: _population, ...rest } = ownQuestionnaire();
            return rest as UserQuestionnaire;
          })(),
        },
      ],
      loadUserQuestionnaire: async (id: string) => ({
        file: { id, title: 'Переименован' },
        questionnaire: ownQuestionnaire(),
      }),
    }));
    const own = await import('@/features/diary/diary-own-questionnaires');
    const [ready, blocked] = await own.listOwnQuestionnaires();
    expect(ready).toMatchObject({
      id: SOURCE_ID,
      title: 'Тревога за неделю',
      questionCount: 2,
      scored: true,
      imageCount: 2,
      problem: null,
      slug: customQuestionnaireSlug(SOURCE_ID),
    });
    expect(blocked?.problem).toBeTruthy();
    const section = await own.ownQuestionnaireSection(SOURCE_ID);
    expect(section).toMatchObject({ kind: 'questionnaire', title: 'Переименован' });
    expect(section.custom?.title).toBe('Переименован');
    expect(section.custom?.images).toEqual([]);
    vi.doUnmock('@/state/user-questionnaires');
  });
});
