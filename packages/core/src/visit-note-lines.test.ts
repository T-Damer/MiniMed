import { describe, expect, it } from 'vitest';

import { locateLines } from './visit-note-lines';

const SOURCES = {
  transcript: [
    'Врач: Голова не кружится, обмороков не было?',
    'Пациент: Нет, такого не было.',
    '',
    'Пациент: Курю, пачку в день, лет тридцать.',
  ],
  priorRecord: ['Принимает лизиноприл 10 мг в сутки.'],
};

describe('locateLines', () => {
  it('links a statement to the cited lines through a shared word', () => {
    expect(locateLines(SOURCES, 4, 'Курит 30 лет по пачке в день')).toMatchObject({
      ok: true,
      quote: { source: 'transcript', startLine: 3, endLine: 3, start: 0, end: 42 },
    });
    expect(locateLines(SOURCES, [1, 2], 'Обмороков не было')).toMatchObject({
      ok: true,
      quote: {
        startLine: 0,
        endLine: 1,
        text: `${SOURCES.transcript[0]} ${SOURCES.transcript[1]}`,
      },
    });
    expect(locateLines(SOURCES, 5, 'Лизиноприл 10 мг')).toMatchObject({
      ok: true,
      quote: { source: 'prior-record', startLine: 0 },
    });
  });

  it('does not link through function words', () => {
    const books = { transcript: ['— А каких-нибудь книг ты читал?— Нет, только журналы.'] };
    expect(locateLines(books, 1, 'Мысли причинить себе какой-нибудь вред')).toEqual({
      ok: false,
      code: 'line-unrelated',
    });
  });

  it('does not take a negated mention as the positive claim', () => {
    expect(locateLines(SOURCES, 1, 'Обмороки')).toEqual({ ok: false, code: 'quote-negated' });
    expect(locateLines(SOURCES, 1, 'Обмороков нет')).toMatchObject({ ok: true });
  });

  it('rejects lines out of range, blank, across sources, too far apart or unrelated', () => {
    for (const cited of [0, 9, 3, [4, 5], [1, 4], [1, 2, 3, 4], 'два', 1.5, null]) {
      expect(locateLines(SOURCES, cited, 'Курит, обмороков нет')).toEqual({
        ok: false,
        code: 'line-not-found',
      });
    }
    expect(locateLines(SOURCES, 2, 'Боль в груди')).toEqual({ ok: false, code: 'line-unrelated' });
  });
});
