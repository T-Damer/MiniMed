import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  loadAssessmentDefinition,
  registerDownloadedAssessment,
} from '@/features/assessments/assessment-catalog';
import { scoreAssessment } from '@/features/assessments/assessment-engine';
import {
  printAssessmentRecord,
  printBlankAssessment,
  shareAssessmentRecord,
} from '@/features/assessments/assessment-print';
import { loadToolModuleRecords } from '@/features/calculators/tool-module-test-helpers';

beforeAll(() => {
  for (const record of loadToolModuleRecords([
    'content/tool-modules/psychology.json',
    'content/tool-modules/obstetrics-gynecology.json',
  ])) {
    if (record.kind === 'assessment') registerDownloadedAssessment(record);
  }
});

describe('assessment print layout', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the description out of the blank form and links the MiniMed project', async () => {
    const definition = await loadAssessmentDefinition('braverman-behavioral-profile');
    const popupDocument = {
      open: vi.fn(),
      write: vi.fn(),
      close: vi.fn(),
    };
    const popup = {
      document: popupDocument,
      focus: vi.fn(),
      print: vi.fn(),
    };
    vi.stubGlobal('window', {
      location: { href: 'http://127.0.0.1:5175/#/assessments/braverman-behavioral-profile' },
      open: vi.fn(() => popup),
      setTimeout: (callback: () => void) => {
        callback();
        return 0;
      },
    });

    expect(
      printBlankAssessment({
        ...definition,
        images: [
          {
            id: 'print-image',
            alt: 'Схема для печати',
            dataUrl: 'data:image/png;base64,aA==',
          },
        ],
      }),
    ).toBe(true);

    const markup = popupDocument.write.mock.calls[0]?.[0];
    expect(markup).toContain(`<h1>${definition.title}</h1>`);
    expect(markup).not.toContain(`<div>${definition.title}</div>`);
    expect(markup).not.toContain(definition.description);
    expect(markup).toContain('href="https://t-damer.github.io/MiniMed/app/"');
    expect(markup).not.toContain('#/assessments/braverman-behavioral-profile');
    expect(markup).not.toContain('Ограничение:');
    expect(markup).not.toContain('Версия:');
    expect(markup).toContain('class="footer-qr"');
    expect(markup).toContain('class="images"');
    expect(markup).toContain('Схема для печати');
  });

  it('omits technical lines and prints an attached note title beside the date', async () => {
    const definition = await loadAssessmentDefinition('braverman-behavioral-profile');
    const popupDocument = { open: vi.fn(), write: vi.fn(), close: vi.fn() };
    const popup = { document: popupDocument, focus: vi.fn(), print: vi.fn() };
    vi.stubGlobal('window', {
      location: { href: 'http://127.0.0.1:5175/#/assessments/private-result' },
      open: vi.fn(() => popup),
      setTimeout: (callback: () => void) => {
        callback();
        return 0;
      },
    });
    const completedAt = '2026-08-10T10:00:00.000Z';

    expect(
      printAssessmentRecord(
        definition,
        {
          id: 'assessment-print-test',
          assessmentId: definition.id,
          subjectLabel: 'Скрытая подпись',
          createdAt: completedAt,
          kind: 'completed',
          answers: {},
          result: {
            assessmentId: definition.id,
            completedAt,
            scores: [],
            primaryScaleIds: [],
            headline: 'Результат',
            summary: 'Описание результата.',
            disclaimer: definition.disclaimer,
          },
        },
        'Заметка пациента',
      ),
    ).toBe(true);

    const markup = popupDocument.write.mock.calls[0]?.[0];
    expect(markup).toContain('⋅ Заметка пациента');
    expect(markup).not.toContain('Пациент / участник:');
    expect(markup).not.toContain('Ограничение:');
    expect(markup).not.toContain('Версия:');
    expect(markup).not.toContain('#/assessments/private-result');
  });

  it('reports clipboard share success and failure through its promise contract', async () => {
    const definition = await loadAssessmentDefinition('perinatal-mood-whooley');
    const record = {
      id: 'assessment-share-test',
      assessmentId: definition.id,
      subjectLabel: '',
      createdAt: '2026-08-10T10:00:00.000Z',
      kind: 'manual' as const,
      text: 'Внешний результат',
    };
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await expect(shareAssessmentRecord(definition, record)).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledOnce();

    writeText.mockRejectedValueOnce(new Error('clipboard unavailable'));
    await expect(shareAssessmentRecord(definition, record)).rejects.toThrow(
      'clipboard unavailable',
    );
  });

  it('prints a schema chart and can append the completed questions and answers', async () => {
    const definition = await loadAssessmentDefinition('temperament-profile');
    const answers = Object.fromEntries(
      definition.questions.map((question) => [question.id, question.reverse ? 1 : 5]),
    );
    const result = scoreAssessment(definition, answers, '2026-09-04T10:00:00.000Z');
    if (!result.ok) throw new Error(result.error);
    const popupDocument = { open: vi.fn(), write: vi.fn(), close: vi.fn() };
    const popup = { document: popupDocument, focus: vi.fn(), print: vi.fn() };
    vi.stubGlobal('window', {
      open: vi.fn(() => popup),
      setTimeout: (callback: () => void) => {
        callback();
        return 0;
      },
    });

    expect(
      printAssessmentRecord(
        definition,
        {
          id: 'temperament-print-test',
          assessmentId: definition.id,
          subjectLabel: 'Пациент',
          createdAt: result.value.completedAt,
          kind: 'completed',
          answers,
          result: result.value,
        },
        '',
        true,
      ),
    ).toBe(true);

    const markup = popupDocument.write.mock.calls[0]?.[0];
    expect(markup).toContain('class="schema-chart-print__svg"');
    expect(markup).toContain('Профиль темперамента: 100%, 100%');
    expect(markup).toContain('Вопросы и ответы:');
    expect(markup).toContain(definition.questions[0]?.prompt);
    expect(markup).toContain('Ответ: Очень похоже на меня');
  });
});
