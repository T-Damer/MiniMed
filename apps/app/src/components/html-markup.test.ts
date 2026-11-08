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

  it('drops underline tags, lifts sup/sub and reads markup the source escaped twice (FMT-AUDIT)', () => {
    expect(stripKnownHtmlMarkup('<u>Не применять</u> детям.')).toBe('Не применять детям.');
    expect(stripKnownHtmlMarkup('&lt;u&gt;Не применять&lt;/u&gt; детям, если x &lt; 5.')).toBe(
      'Не применять детям, если x < 5.',
    );
    expect(stripKnownHtmlMarkup('Ксарелто<sup style="line-height: 5px;">®</sup> 15 мг')).toBe(
      'Ксарелто® 15 мг',
    );
    expect(stripKnownHtmlMarkup('10<sup>9</sup>/л, H<sub>2</sub>O')).toBe('10⁹/л, H₂O');
    expect(stripKnownHtmlMarkup('A &Amp; B')).toBe('A & B');
  });
});
