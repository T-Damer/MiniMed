import { describe, expect, it } from 'vitest';

import { buildAskAiUserPrompt } from '@/features/ask-ai/ask-ai-client';
import { extractBoundedWindow } from '@/features/ask-ai/ask-ai-context';

describe('ask-ai file context pipeline', () => {
  it('centers a bounded surrounding window around the selected excerpt', () => {
    const before = 'Доклиническая преамбула '.repeat(80);
    const excerpt = 'Рекомендуемая стартовая доза 2 мг/сут';
    const after = ' Противопоказания и контроль ЭКГ '.repeat(80);
    const windowText = extractBoundedWindow(`${before}${excerpt}${after}`, excerpt, 240);
    expect(windowText).toContain(excerpt);
    expect(windowText.length).toBeLessThanOrEqual(244);
    expect(windowText.startsWith('…')).toBe(true);
    expect(windowText.endsWith('…')).toBe(true);
  });

  it('formats attached document/file context blocks with source labels in the prompt', () => {
    const prompt = buildAskAiUserPrompt({
      excerpt: 'интервал QT',
      documentTitle: 'Рисперидон — инструкция',
      sectionTitle: 'Особые указания',
      question: 'Какие риски?',
      contextBlocks: [
        {
          kind: 'section',
          title: 'Рисперидон — инструкция',
          section: 'Особые указания',
          sourceRef: '#/modules/documents/d/risperidone',
          text: 'Следует соблюдать осторожность при сочетании с препаратами, удлиняющими интервал QT.',
        },
      ],
    });
    expect(prompt).toContain('Контекст из открытых файлов MiniMed:');
    expect(prompt).toContain('[1 · Рисперидон — инструкция — Особые указания]');
    expect(prompt).toContain('удлиняющими интервал QT');
  });
});
