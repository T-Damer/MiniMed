import { describe, expect, it } from 'vitest';

import {
  CombinedMentionFinder,
  MentionMatcher,
  mentionTargets,
  nameStems,
  tokenizeForMatching,
} from './mention-matcher';

function found(matcher: { find: MentionMatcher['find'] }, text: string): readonly string[] {
  return mentionTargets(matcher.find(tokenizeForMatching(text)));
}

describe('nameStems', () => {
  it('reduces every inflection of a name to the same stems', () => {
    expect(nameStems('ибупрофена')).toEqual(nameStems('ибупрофеном'));
    expect(nameStems('Ацетилсалициловой кислотой')).toEqual(nameStems('ацетилсалициловая кислота'));
    expect(nameStems('алкоголь')).toEqual(nameStems('алкоголя'));
    expect(nameStems('кальций')).toEqual(nameStems('кальция'));
  });

  it('reads the plural of an adjective in every case', () => {
    expect(nameStems('нестероидных противовоспалительных')).toEqual(
      nameStems('нестероидные противовоспалительные'),
    );
    expect(nameStems('гормональных контрацептивов')).toEqual(
      nameStems('гормональные контрацептивы'),
    );
  });

  it('drops Roman numerals, single letters and digits', () => {
    expect(nameStems('S(-)амлодипин')).toEqual(nameStems('амлодипин'));
    expect(nameStems('железа [III] гидроксид')).toEqual(nameStems('железа гидроксид'));
    expect(nameStems('β-адреноблокаторы')).toEqual(nameStems('бета-адреноблокаторы'));
  });
});

describe('MentionMatcher', () => {
  const matcher = new MentionMatcher([
    { target: 's:варфарин', stems: nameStems('варфарин') },
    { target: 's:ацетилсалицилов кислот', stems: nameStems('ацетилсалициловая кислота') },
    { target: 's:калий хлорид', stems: nameStems('калия хлорид') },
    { target: 's:болиголов', stems: nameStems('болиголов') },
    { target: 's:боль', stems: nameStems('боль') },
    { target: 's:этанол', stems: nameStems('алкоголь') },
  ]);

  it('finds a name in any inflection and returns the original offsets', () => {
    const text = 'Усиливает действие Варфарина и снижает эффект варфарином.';
    const hits = matcher.find(tokenizeForMatching(text));
    expect(hits.map((hit) => text.slice(hit.start, hit.end))).toEqual(['Варфарина', 'варфарином']);
  });

  it('matches a several-word name only as consecutive words', () => {
    expect(found(matcher, 'ацетилсалициловой кислоты в малых дозах')).toEqual([
      's:ацетилсалицилов кислот',
    ]);
    expect(found(matcher, 'ацетилсалициловая и аскорбиновая кислота')).toEqual([]);
  });

  it('knows a two-word name in the other order', () => {
    expect(found(matcher, 'растворы хлорида калия')).toEqual(['s:калий хлорид']);
  });

  it('never finds a short name inside a longer word', () => {
    expect(found(matcher, 'головной болиголов, головная боль и болями')).toEqual([
      's:болиголов',
      's:боль',
    ]);
    expect(found(matcher, 'головной')).toEqual([]);
    expect(found(matcher, 'головные боли и болезнь')).toEqual([]);
    expect(found(matcher, 'в составе болиголова')).toEqual(['s:болиголов']);
  });

  it('ignores a single-word name shorter than four letters of stem', () => {
    const short = new MentionMatcher([{ target: 's:йод', stems: ['йод'] }]);
    expect(found(short, 'препараты йода')).toEqual([]);
    const allowed = new MentionMatcher([{ target: 'c:H02A', stems: ['гкс'] }], {
      minSingleStem: 3,
    });
    expect(found(allowed, 'совместно с ГКС')).toEqual(['c:H02A']);
  });

  it('does not take the second half of a word wrapped at a hyphen for a name', () => {
    const statins = new MentionMatcher([
      { target: 'c:C10AA', stems: nameStems('статины') },
      { target: 'c:C07', stems: nameStems('бета адреноблокаторы') },
    ]);
    expect(found(statins, 'взаимодействующими с розува- статином')).toEqual([]);
    expect(found(statins, 'совместно со статином и бета- адреноблокаторами')).toEqual([
      'c:C10AA',
      'c:C07',
    ]);
  });

  it('reads alcohol under its everyday name in every case', () => {
    expect(found(matcher, 'нельзя употреблять алкоголь, алкоголем и после алкоголя')).toEqual([
      's:этанол',
    ]);
  });
});

describe('CombinedMentionFinder', () => {
  it('drops a name that is only a part of a longer name of another matcher', () => {
    const substances = new MentionMatcher([
      { target: 's:серотонин', stems: nameStems('серотонин') },
      { target: 's:флуоксетин', stems: nameStems('флуоксетин') },
    ]);
    const classes = new MentionMatcher([
      { target: 'c:N06AB', stems: nameStems('ингибиторы обратного захвата серотонина') },
    ]);
    const combined = new CombinedMentionFinder([substances, classes]);
    const tokens = tokenizeForMatching(
      'Ингибиторы обратного захвата серотонина и флуоксетин усиливают эффект.',
    );
    expect(mentionTargets(combined.find(tokens))).toEqual(['c:N06AB', 's:флуоксетин']);
  });
});
