import {
  PsyStatusDocumentSchema,
  type PsyStatusSuggestion,
  PsyStatusSuggestionSchema,
} from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { psyStatusPhrase } from './catalog';
import { PSY_STATUS_CUES } from './cues';
import {
  acceptPsyStatusSuggestion,
  dismissPsyStatusSuggestion,
  emptyPsyStatusDocument,
  generatePsyStatusText,
  openPsyStatusSuggestions,
  psyStatusIssues,
} from './document';
import { fillPsyStatusFromTranscript, foldPsyStatusLine, psyStatusQuoteSource } from './fill';

/** A made-up conversation; no real patient. */
const VISIT = [
  '[00:00–00:04] Врач: Расскажите, что вас беспокоит.',
  '[00:04–00:12] Пациент: Настроение плохое, ничего не радует, по ночам тревога.',
  '[00:12–00:15] Врач: Голоса слышите?',
  '[00:15–00:17] Пациент: Нет.',
  '[00:17–00:21] Врач: Мысли о самоубийстве бывают',
  '[00:21–00:26] Пациент: Нет, никогда, ради детей держусь.',
  '[00:26–00:31] Пациент: Алкоголь не пью, курю пачку в день.',
  '[00:31–00:36] Пациент: Аллергии нет. Принимаю сертралин, но иногда забываю выпить.',
];

function byCode(suggestions: readonly PsyStatusSuggestion[]): Map<string, PsyStatusSuggestion> {
  return new Map(suggestions.map((suggestion) => [suggestion.code, suggestion]));
}

describe('fillPsyStatusFromTranscript', () => {
  const suggestions = fillPsyStatusFromTranscript(VISIT);
  const found = byCode(suggestions);

  it('proposes catalog phrases from what was said, denied and answered', () => {
    expect([...found.keys()].sort()).toEqual(
      [
        'mood-depressed',
        'anxiety',
        'perception-none',
        'suicide-denied',
        'protective-factors',
        'alcohol-denied',
        'nicotine-daily',
        'allergy-none',
        'meds-current',
        'adherence-partial',
      ].sort(),
    );
    expect(found.get('mood-depressed')?.kind).toBe('statement');
    expect(found.get('alcohol-denied')?.kind).toBe('denial');
    expect(found.get('perception-none')?.kind).toBe('answer');
    expect(found.get('suicide-denied')?.kind).toBe('answer');
  });

  it('places every proposal in its catalog section and keeps to the contract', () => {
    for (const suggestion of suggestions) {
      expect(PsyStatusSuggestionSchema.parse(suggestion)).toEqual(suggestion);
      const ref = psyStatusPhrase(suggestion.code);
      expect(ref?.module.id).toBe(suggestion.moduleId);
      expect(ref?.section.id).toBe(suggestion.sectionId);
    }
  });

  it('quotes the transcript words exactly where they stand', () => {
    for (const suggestion of suggestions) {
      for (const quote of suggestion.quotes) {
        expect(psyStatusQuoteSource(VISIT, quote)).toBe(quote.text);
        expect(quote.text.length).toBeGreaterThan(0);
      }
    }
    expect(found.get('mood-depressed')?.quotes[0]).toEqual({
      source: 'transcript',
      startLine: 1,
      start: VISIT[1]?.indexOf('Настроение'),
      endLine: 1,
      end: VISIT[1]?.indexOf(','),
      text: 'Настроение плохое',
    });
    expect(found.get('alcohol-denied')?.quotes[0]?.text).toBe('Алкоголь не пью');
    expect(found.get('allergy-none')?.quotes[0]?.text).toBe('Аллергии нет');
  });

  it('quotes a question together with its answer on the next line', () => {
    const [quote] = found.get('perception-none')?.quotes ?? [];
    expect(quote).toMatchObject({
      startLine: 2,
      endLine: 3,
      text: 'Голоса слышите? [00:15–00:17] Пациент: Нет',
    });
    const suicide = found.get('suicide-denied')?.quotes[0];
    expect(suicide).toMatchObject({ startLine: 4, endLine: 5 });
    expect(suicide?.text).toBe('Мысли о самоубийстве бывают [00:21–00:26] Пациент: Нет');
  });

  it('reads turns joined on one line, as time-cut speech recognition stores them', () => {
    // Synthetic, in the shape of a recogniser that cuts audio by time: no speaker labels, «—» turns.
    const lines = [
      '[00:00–00:14] — Голоса слышите?— Нет, не слышу.— А таблетки пьёте?— Да, утром.',
      '[00:14–00:29] — Что думаете делать?— Да брошусь с моста, и всё.— Как это?— Не знаю.',
    ];
    const byCode = new Map(fillPsyStatusFromTranscript(lines).map((item) => [item.code, item]));
    expect(byCode.get('perception-none')?.quotes[0]?.text).toBe('Голоса слышите?— Нет');
    expect(byCode.get('meds-current')?.kind).toBe('answer');
    // A method named is an active suicidal statement, never a denial.
    expect(byCode.get('suicide-active')?.quotes[0]?.text).toBe('Да брошусь с моста');
    expect(byCode.has('suicide-denied')).toBe(false);
  });

  it('does not take a question for a fact without an answer', () => {
    expect(fillPsyStatusFromTranscript(['Врач: Голоса слышите?', 'Пациент: Сплю плохо.'])).toEqual(
      [],
    );
  });

  it('takes «да» to a question as the finding', () => {
    const result = byCode(
      fillPsyStatusFromTranscript(['Врач: голоса слышите', 'Пациент: Да, бывает.']),
    );
    expect(result.get('auditory-hallucinations')).toMatchObject({ kind: 'answer' });
  });

  it('does not read a statement before an unrelated «да» as a question', () => {
    const result = byCode(
      fillPsyStatusFromTranscript(['Пациент: Голоса не слышу.', 'Врач: Да, хорошо.']),
    );
    expect(result.has('auditory-hallucinations')).toBe(false);
    expect(result.get('perception-none')?.kind).toBe('denial');
  });

  it('proposes nothing for a denial when the catalog has no denial phrase', () => {
    expect(fillPsyStatusFromTranscript(['Пациент: Не курю и тошноты нет.'])).toEqual([]);
  });

  it('keeps one proposal per phrase with every place it was said, up to three', () => {
    const lines = ['Тревога днём.', 'Тревога ночью.', 'Тревожно утром.', 'Опять тревога.'];
    const [anxiety] = fillPsyStatusFromTranscript(lines);
    expect(anxiety?.code).toBe('anxiety');
    expect(anxiety?.quotes.map((quote) => quote.startLine)).toEqual([0, 1, 2]);
  });

  it('proposes both sides when the patient denied and then told', () => {
    const result = fillPsyStatusFromTranscript([
      'Пациент: Алкоголь не употребляю.',
      'Пациент: Ну, пиво пью по выходным.',
    ]);
    const codes = result.map((suggestion) => suggestion.code);
    expect(codes).toEqual(['alcohol-denied', 'alcohol-use']);
    let document = emptyPsyStatusDocument();
    for (const [index, suggestion] of result.entries()) {
      document = acceptPsyStatusSuggestion(document, suggestion, `e${index}`);
    }
    expect(psyStatusIssues(document).map((issue) => issue.type)).toContain('potential');
  });

  it('does not take medicines for drinking', () => {
    const codes = fillPsyStatusFromTranscript(['Пью таблетки утром.']).map((s) => s.code);
    expect(codes).not.toContain('alcohol-use');
    expect(codes).toContain('meds-current');
  });

  it('keeps offsets of the source line when folding case and «ё»', () => {
    const line = 'Ёлки, ТРЕВОГА ещё';
    expect(foldPsyStatusLine(line)).toHaveLength(line.length);
    const [anxiety] = fillPsyStatusFromTranscript([line]);
    expect(anxiety?.quotes[0]?.text).toBe('ТРЕВОГА ещё');
  });

  it('declares cues only for catalog phrases', () => {
    for (const cue of PSY_STATUS_CUES) {
      expect(psyStatusPhrase(cue.code), cue.code).toBeDefined();
      if (cue.denied) expect(psyStatusPhrase(cue.denied), cue.denied).toBeDefined();
    }
  });
});

describe('psy-status document from a transcript', () => {
  it('fills the form only with accepted proposals and keeps their quotes', () => {
    const suggestions = fillPsyStatusFromTranscript(VISIT);
    let document = emptyPsyStatusDocument();
    const mood = suggestions.find((suggestion) => suggestion.code === 'mood-depressed');
    const smoking = suggestions.find((suggestion) => suggestion.code === 'nicotine-daily');
    if (!mood || !smoking) throw new Error('expected proposals are missing');
    document = acceptPsyStatusSuggestion(document, mood, 'e1');
    document = dismissPsyStatusSuggestion(document, smoking.code);

    expect(PsyStatusDocumentSchema.parse(document)).toEqual(document);
    expect(document.entries).toHaveLength(1);
    expect(document.entries[0]).toMatchObject({
      code: 'mood-depressed',
      origin: 'transcript',
      sectionId: 'emotion',
      quotes: mood.quotes,
    });
    const open = openPsyStatusSuggestions(document, suggestions).map((s) => s.code);
    expect(open).not.toContain('mood-depressed');
    expect(open).not.toContain('nicotine-daily');
    expect(open).toContain('anxiety');

    expect(generatePsyStatusText(document)).toBe(
      'ПСИХИЧЕСКИЙ СТАТУС\nЭмоции и аффект: настроение устойчиво снижено; аффект депрессивный, реактивность ограничена.',
    );
  });
});
