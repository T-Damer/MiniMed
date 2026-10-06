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

  it('refuses an alias that points at a code the dictionary does not have', () => {
    const bad: readonly ClassAlias[] = [{ text: 'нечто', codes: ['Z99'], basis: 'test' }];
    expect(() => deriveClassPhrases(ATC, bad)).toThrow(/Z99/u);
  });
});
