import { describe, expect, it } from 'vitest';

import { stripKnownHtmlMarkup } from '@/components/html-markup';

describe('stripKnownHtmlMarkup', () => {
  it('converts <br> tags to line breaks', () => {
    expect(stripKnownHtmlMarkup('Строка первая<br>Строка вторая<br>')).toBe(
      'Строка первая\nСтрока вторая\n',
    );
  });

  it('collapses <br><br> into a paragraph break', () => {
    expect(stripKnownHtmlMarkup('Абзац один.<br><br>Абзац два.')).toBe('Абзац один.\n\nАбзац два.');
  });

  it('strips emphasis and bold tags while keeping their text', () => {
    expect(stripKnownHtmlMarkup('<em>Перорально</em>.')).toBe('Перорально.');
    expect(stripKnownHtmlMarkup('<strong>Важно</strong>: доза 5 мг.')).toBe(
      '**Важно**: доза 5 мг.',
    );
  });

  it('strips layout tags from medication instruction fragments', () => {
    expect(stripKnownHtmlMarkup('<div>Первая часть</div><div>Вторая часть</div>')).toBe(
      'Первая часть\nВторая часть\n',
    );
  });

  it('decodes known HTML entities', () => {
    expect(stripKnownHtmlMarkup('50&nbsp;мг &amp; 10&nbsp;мл')).toBe('50 мг & 10 мл');
  });

  it('decodes typographic entities used in Russian clinical text', () => {
    expect(stripKnownHtmlMarkup('А-церумен &ndash; препарат &laquo;Х&raquo;&hellip;')).toBe(
      'А-церумен – препарат «Х»…',
    );
  });

  it('leaves clinical comparison operators untouched', () => {
    expect(stripKnownHtmlMarkup('температура <38°C, доза >10 мг')).toBe(
      'температура <38°C, доза >10 мг',
    );
  });

  it('returns plain text unchanged (fast path)', () => {
    const text = 'Обычный текст без разметки.';
    expect(stripKnownHtmlMarkup(text)).toBe(text);
  });

  it('handles a realistic multi-line instruction fragment', () => {
    const input =
      '<em>Перорально</em>.<br>Рекомендуемая доза 7 мг.<br><br>Мониторинг:<br>- контроль АЛТ;<br>- контроль АД.';
    const output = stripKnownHtmlMarkup(input);
    expect(output).toBe(
      'Перорально.\nРекомендуемая доза 7 мг.\n\nМониторинг:\n- контроль АЛТ;\n- контроль АД.',
    );
  });
});
