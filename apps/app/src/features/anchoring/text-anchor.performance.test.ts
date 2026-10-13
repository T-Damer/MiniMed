import { describe, expect, it } from 'vitest';

import { AnchorDocument, type AnchorUnit, locateQuote } from '@/features/anchoring/text-anchor';

describe('re-anchoring in a book-sized document', () => {
  // ~1 400 pages of ~1 800 characters: the size of a long PDF handbook.
  const words = [
    'пациент',
    'терапия',
    'артериальное',
    'давление',
    'рекомендуется',
    'назначение',
    'препарат',
    'доза',
    'мониторинг',
    'осложнение',
    'диагностика',
    'лечение',
    'синдром',
    'клинический',
    'показание',
    'противопоказание',
    'эффективность',
    'безопасность',
    'наблюдение',
    'исследование',
  ];
  let seed = 7;
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed;
  };
  const sentence = (): string =>
    `${Array.from({ length: 12 }, () => words[next() % words.length]).join(' ')}.`;
  const pages: AnchorUnit[] = Array.from({ length: 1400 }, (_, index) => ({
    id: `p${String(index)}`,
    text: Array.from({ length: 16 }, sentence).join(' '),
  }));
  const needle =
    'Метформин назначается при непереносимости других препаратов, при этом контролируется функция почек каждые три месяца.';

  it('locates a reworded, moved quote within a few seconds', () => {
    const edition = pages.map((page) =>
      page.id === 'p900'
        ? {
            id: page.id,
            text: `${page.text} Метформин назначается при непереносимости прочих препаратов, при этом функция почек контролируется каждые 3 месяца. ${sentence()}`,
          }
        : page,
    );
    const started = performance.now();
    const document = new AnchorDocument(edition);
    const built = performance.now();
    const match = locateQuote(
      document,
      { exact: needle, prefix: 'к назначению', suffix: ' Дозу подбирают' },
      { unitId: 'p10', start: 100 },
    );
    const finished = performance.now();
    expect(match?.status).toBe('approximate');
    expect(match?.segments[0]?.unitId).toBe('p900');
    // Generous bounds: they only guard against accidental quadratic behaviour.
    expect(built - started).toBeLessThan(4000);
    expect(finished - built).toBeLessThan(4000);
  });

  it('finds nothing for a quote that is not there, quickly', () => {
    const document = new AnchorDocument(pages);
    const started = performance.now();
    const match = locateQuote(document, {
      exact: 'Совершенно иное утверждение о тромболизисе при инфаркте миокарда.',
      prefix: '',
      suffix: '',
    });
    expect(match).toBeNull();
    expect(performance.now() - started).toBeLessThan(4000);
  });
});
