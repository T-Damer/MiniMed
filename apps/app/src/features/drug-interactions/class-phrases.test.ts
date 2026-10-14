import { describe, expect, it } from 'vitest';

import { type ClassAlias, classPatterns, deriveClassPhrases } from './class-phrases';
import { MentionMatcher, mentionTargets, tokenizeForMatching } from './mention-matcher';

/** A few real НСИ «АТХ» names (v3.8), enough to exercise every rule. */
const ATC: Readonly<Record<string, string>> = {
  C: 'Сердечно-сосудистая система',
  C03: 'Диуретики',
  C03A: 'Тиазидные диуретики',
  C07: 'Бета-адреноблокаторы',
  C08: 'Блокаторы кальциевых каналов',
  C09: 'Средства, действующие на ренин-ангиотензиновую систему',
  C09A: 'Ингибиторы ангиотензинпревращающего фермента (АПФ)',
  C09AA: 'Ингибиторы АПФ',
  C09B: 'Ингибиторы АПФ в комбинации с другими препаратами',
  M01: 'Противовоспалительные и противоревматические препараты',
  M01A: 'Нестероидные противовоспалительные и противоревматические препараты',
  J01: 'Антибактериальные препараты системного действия',
  J01F: 'Макролиды, линкозамиды и стрептограмины',
  J04AB: 'Антибиотики',
  A07AA: 'Антибиотики',
  A06: 'Слабительные препараты',
  A02: 'Препараты для лечения заболеваний, связанных с нарушением кислотности',
  A02B: 'Препараты для лечения язвенной болезни желудка и двенадцатиперстной кишки',
  H03A: 'Препараты щитовидной железы',
  V07AR: 'Таблетки',
  A09AB: 'Кислоты',
  // Enough ordinary names for «препараты», «средства» and «для» to be the frequent words they are.
  ...Object.fromEntries(
    Array.from({ length: 40 }, (_, index) => [
      `X${String(index).padStart(2, '0')}`,
      `Прочие препараты и средства для лечения заболеваний ${index}`,
    ]),
  ),
};

describe('deriveClassPhrases', () => {
  const { phrases, report } = deriveClassPhrases(ATC, [
    { text: 'НПВП', codes: ['M01A'], basis: 'test' },
  ]);
  const matcher = new MentionMatcher(classPatterns(phrases), { minSingleStem: 3 });
  const targets = (text: string): readonly string[] =>
    mentionTargets(matcher.find(tokenizeForMatching(text)));

  it('turns the official group names into the phrases an instruction uses', () => {
    expect(targets('с диуретиками и бета-адреноблокаторами')).toEqual(['c:C03', 'c:C07']);
    expect(targets('блокаторами кальциевых каналов')).toEqual(['c:C08']);
    expect(targets('ингибиторов АПФ')).toEqual(['c:C09AA', 'c:C09B']);
    expect(targets('нестероидные противовоспалительные препараты')).toEqual(['c:M01A']);
    expect(targets('макролиды')).toEqual(['c:J01F']);
    expect(targets('антибактериальными препаратами')).toEqual(['c:J01']);
  });

  it('keeps the shortest code of a group family', () => {
    expect(targets('тиазидные диуретики')).toEqual(['c:C03A']);
  });

  it('reads an alias from the small table', () => {
    expect(targets('при приеме НПВП')).toEqual(['c:M01A']);
  });

  it('keeps a class name that stands in several branches, with the codes of all of them', () => {
    // «Антибиотики» is claimed by A07AA and J04AB: there the table of aliases decides, not the names.
    expect(targets('антибиотики')).toEqual(['c:A07AA', 'c:J04AB']);
    expect(report.manyBranches).toContain('антибиотик');
  });

  it('names an adjective as a class only in the plural', () => {
    expect(targets('назначают слабительные средства')).toEqual(['c:A06']);
    expect(targets('слабительное действие')).toEqual([]);
  });

  it('never makes a class of an organ, a condition, a dosage form or a short ordinary word', () => {
    expect(targets('щитовидной железы, язвенной болезни, таблетки, кислоты')).toEqual([]);
    expect(targets('двенадцатиперстной кишки')).toEqual([]);
  });

  it('finds container words by frequency, not by a list', () => {
    expect(report.containerWords).toContain('препарат');
  });

  it('lets an alias narrow a class word that the group name would stand for as a whole', () => {
    // «Противокашлевые препараты и средства для лечения простудных заболеваний» is R05 as a whole,
    // expectorants (R05C) included; the alias keeps the word on the suppressant subgroups.
    const names = {
      ...ATC,
      R05: 'Противокашлевые препараты и средства для лечения простудных заболеваний',
      R05C: 'Отхаркивающие препараты, кроме комбинаций с противокашлевыми средствами',
      R05D: 'Противокашлевые препараты, кроме комбинаций с отхаркивающими средствами',
      R05F: 'Комбинированные препараты противокашлевых и отхаркивающих средств',
    };
    const find = (aliases: readonly ClassAlias[]): readonly string[] => {
      const derived = deriveClassPhrases(names, aliases);
      const antitussive = derived.phrases.filter((phrase) => phrase.stems.includes('противокашл'));
      return antitussive.flatMap((phrase) => phrase.codes).toSorted();
    };
    expect(find([])).toEqual(['R05']);
    expect(find([{ text: 'противокашлевые', codes: ['R05D', 'R05F'], basis: 'test' }])).toEqual([
      'R05D',
      'R05F',
    ]);
  });

  it('lets one alias per word split a name that lists several classes (ATC4c)', () => {
    // «Макролиды, линкозамиды и стрептограмины» is one name with three words; without aliases every
    // word stands for J01F as a whole, with one alias each the words are told apart.
    const names = {
      ...ATC,
      J01FA: 'Макролиды',
      J01FF: 'Линкозамиды',
      J01FG: 'Стрептограмины',
    };
    const matcherFor = (aliases: readonly ClassAlias[]) =>
      new MentionMatcher(classPatterns(deriveClassPhrases(names, aliases).phrases), {
        minSingleStem: 3,
      });
    const targetsIn = (aliases: readonly ClassAlias[], text: string): readonly string[] =>
      mentionTargets(matcherFor(aliases).find(tokenizeForMatching(text))).toSorted();
    expect(targetsIn([], 'макролиды и линкозамиды')).toEqual(['c:J01F']);
    const aliases: readonly ClassAlias[] = [
      { text: 'макролиды', codes: ['J01FA'], basis: 'test' },
      { text: 'линкозамиды', codes: ['J01FF'], basis: 'test' },
      { text: 'стрептограмины', codes: ['J01FG'], basis: 'test' },
    ];
    expect(targetsIn(aliases, 'антагонизм с макролидами')).toEqual(['c:J01FA']);
    expect(targetsIn(aliases, 'линкозамидов и стрептограминов')).toEqual(['c:J01FF', 'c:J01FG']);
    expect(targetsIn(aliases, 'макролиды и линкозамиды')).toEqual(['c:J01FA', 'c:J01FF']);
  });

  it('gives a widened alias one target per code, the sentence named by the word is one mention', () => {
    const aliases: readonly ClassAlias[] = [
      { text: 'гипотензивные', codes: ['C03A', 'C07', 'C08'], basis: 'test' },
    ];
    const matcher = new MentionMatcher(classPatterns(deriveClassPhrases(ATC, aliases).phrases), {
      minSingleStem: 3,
    });
    const mentions = matcher.find(tokenizeForMatching('усиливает действие гипотензивных средств'));
    expect(mentions.map((mention) => mention.target).toSorted()).toEqual([
      'c:C03A',
      'c:C07',
      'c:C08',
    ]);
    // all of them mark the same words
    expect(new Set(mentions.map((mention) => `${mention.start}-${mention.end}`)).size).toBe(1);
  });

  it('refuses an alias that points at a code the dictionary does not have', () => {
    const bad: readonly ClassAlias[] = [{ text: 'нечто', codes: ['Z99'], basis: 'test' }];
    expect(() => deriveClassPhrases(ATC, bad)).toThrow(/Z99/u);
  });
});
