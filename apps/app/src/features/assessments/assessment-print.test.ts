import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  loadAssessmentDefinition,
  registerDownloadedAssessment,
} from '@/features/assessments/assessment-catalog';
import {
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

  it('keeps the description out of the blank form and adds a page link QR footer', async () => {
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

    expect(printBlankAssessment(definition)).toBe(true);

    const markup = popupDocument.write.mock.calls[0]?.[0];
    expect(markup).toContain(`<h1>${definition.title}</h1>`);
    expect(markup).not.toContain(`<div>${definition.title}</div>`);
    expect(markup).not.toContain(definition.description);
    expect(markup).toContain(
      'href="http://127.0.0.1:5175/#/assessments/braverman-behavioral-profile"',
    );
    expect(markup).toContain('class="footer-qr"');
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
});
