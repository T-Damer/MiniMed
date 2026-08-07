import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadAssessmentDefinition } from '@/features/assessments/assessment-catalog';
import { printBlankAssessment } from '@/features/assessments/assessment-print';

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
});
