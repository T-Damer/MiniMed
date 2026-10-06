import { describe, expect, it } from 'vitest';

import {
  extractDocumentSpans,
  SPAN_FLAG_CONTRAINDICATIONS,
  SPAN_FLAG_INTERACTIONS,
  SPAN_FLAG_LEAFLET_BODY,
  SPAN_FLAG_SPECIAL,
} from './interaction-extract';
import { canonicalSectionText } from './interaction-text';
import { CombinedMentionFinder, MentionMatcher, nameStems } from './mention-matcher';

const matcher = new CombinedMentionFinder([
  new MentionMatcher([
    { target: 's:варфарин', stems: nameStems('варфарин') },
    { target: 's:ибупрофен', stems: nameStems('ибупрофен') },
  ]),
  new MentionMatcher([
    { target: 'c:M01A', stems: nameStems('нестероидные противовоспалительные') },
  ]),
]);

const section = (type: string, text: string, id = `section.${type}`) => ({
  id,
  type,
  title: type,
  chunks: [text],
});

describe('extractDocumentSpans', () => {
  it('records offsets that point at the sentence in the canonical text', () => {
    const text = 'Вступление без названий. Усиливает действие варфарина и ибупрофена.';
    const extracted = extractDocumentSpans([section('interactions', text)], matcher, {
      isLeaflet: false,
      ownKeys: new Set(),
    });
    expect(extracted.hasInteractionSection).toBe(true);
    expect(extracted.spans).toHaveLength(1);
    const span = extracted.spans[0];
    expect(span?.flags).toBe(SPAN_FLAG_INTERACTIONS);
    expect(span?.targets).toEqual(['s:варфарин', 's:ибупрофен']);
    const canonical = canonicalSectionText([text]);
    expect(canonical.text.slice(span?.start, span?.end)).toBe(
      'Усиливает действие варфарина и ибупрофена.',
    );
  });

  it('searches only the sections that can name another drug', () => {
    const named = 'Сочетание с варфарином опасно.';
    const extracted = extractDocumentSpans(
      [
        section('indications', named),
        section('dosage', named),
        section('special-instructions', named),
        section('contraindications', named),
      ],
      matcher,
      { isLeaflet: false, ownKeys: new Set() },
    );
    expect(extracted.spans.map((span) => span.flags)).toEqual([
      SPAN_FLAG_SPECIAL,
      SPAN_FLAG_CONTRAINDICATIONS,
    ]);
  });

  it('leaves out the instruction’s own substance', () => {
    const extracted = extractDocumentSpans(
      [section('interactions', 'Препарат содержит варфарин; также ибупрофен усиливает эффект.')],
      matcher,
      { isLeaflet: false, ownKeys: new Set(['варфарин']) },
    );
    expect(extracted.spans[0]?.targets).toEqual(['s:ибупрофен']);
  });

  it('does not count the own class as an interaction outside the interaction section', () => {
    const text = 'Как и другие нестероидные противовоспалительные средства, препарат осторожно.';
    const options = { isLeaflet: false, ownKeys: new Set<string>(), ownAtcCodes: ['M01AE01'] };
    expect(
      extractDocumentSpans([section('special-instructions', text)], matcher, options).spans,
    ).toHaveLength(0);
    expect(
      extractDocumentSpans([section('interactions', text)], matcher, options).spans[0]?.targets,
    ).toEqual(['c:M01A']);
  });

  it('reads a leaflet’s general sections only for sentences about taking drugs together', () => {
    const body = [
      'Препарат не следует применять при аллергии на ибупрофен.',
      'Сообщите врачу, если Вы одновременно принимаете варфарин.',
    ].join(' ');
    const leaflet = extractDocumentSpans([section('other', body)], matcher, {
      isLeaflet: true,
      ownKeys: new Set(),
    });
    expect(leaflet.spans).toHaveLength(1);
    expect(leaflet.spans[0]?.flags).toBe(SPAN_FLAG_LEAFLET_BODY);
    expect(leaflet.spans[0]?.targets).toEqual(['s:варфарин']);
    const instruction = extractDocumentSpans([section('other', body)], matcher, {
      isLeaflet: false,
      ownKeys: new Set(),
    });
    expect(instruction.spans).toHaveLength(0);
  });

  it('leaves out a word of the own name («препараты кальция» in a calcium instruction)', () => {
    const calcium = new MentionMatcher([
      { target: 's:кальц', stems: nameStems('кальция') },
      { target: 's:кальц глюконат', stems: nameStems('кальция глюконат') },
      { target: 's:ибупрофен', stems: nameStems('ибупрофен') },
    ]);
    const extracted = extractDocumentSpans(
      [section('interactions', 'При лечении препаратами кальция избегайте ибупрофена.')],
      calcium,
      { isLeaflet: false, ownKeys: new Set(['кальц глюконат']) },
    );
    expect(extracted.spans[0]?.targets).toEqual(['s:ибупрофен']);
  });

  it('leaves out a class that is only the own substance’s name', () => {
    const own = new CombinedMentionFinder([
      new MentionMatcher([{ target: 'c:H01BB', stems: nameStems('окситоцин') }]),
    ]);
    const text = 'При введении окситоцина на фоне анестезии описаны случаи брадикардии.';
    expect(
      extractDocumentSpans([section('interactions', text)], own, {
        isLeaflet: false,
        ownKeys: new Set(['окситоцин']),
      }).spans,
    ).toHaveLength(0);
  });

  it('searches an element that is also a laboratory value only in the interaction section', () => {
    const potassium = new MentionMatcher([{ target: 's:кали', stems: nameStems('калий') }]);
    const text = 'Следует контролировать содержание калия в плазме крови пациентов.';
    const options = { isLeaflet: false, ownKeys: new Set<string>() };
    expect(
      extractDocumentSpans([section('special-instructions', text)], potassium, options).spans,
    ).toHaveLength(0);
    expect(
      extractDocumentSpans([section('interactions', text)], potassium, options).spans,
    ).toHaveLength(1);
  });

  it('names a class in a warning only when the sentence is also about taking drugs together', () => {
    const options = { isLeaflet: false, ownKeys: new Set<string>(), ownAtcCodes: ['A02BC01'] };
    const alone =
      'У детей возможны побочные явления при наружном применении нестероидных противовоспалительных средств.';
    const together =
      'Нельзя применять одновременно с нестероидными противовоспалительными средствами.';
    expect(
      extractDocumentSpans([section('special-instructions', alone)], matcher, options).spans,
    ).toHaveLength(0);
    expect(
      extractDocumentSpans([section('special-instructions', together)], matcher, options).spans[0]
        ?.targets,
    ).toEqual(['c:M01A']);
  });

  it('does not take an allergen for a drug taken together outside the interaction section', () => {
    const text = 'Не принимайте препарат, если у Вас аллергия на ибупрофен или варфарин.';
    const options = { isLeaflet: false, ownKeys: new Set<string>() };
    expect(
      extractDocumentSpans([section('contraindications', text)], matcher, options).spans,
    ).toHaveLength(0);
    expect(
      extractDocumentSpans([section('interactions', text)], matcher, options).spans,
    ).toHaveLength(1);
  });

  it('gives a section a checksum of its canonical text', () => {
    const extracted = extractDocumentSpans(
      [section('interactions', 'Варфарин усиливает эффект ибупрофена.')],
      matcher,
      { isLeaflet: false, ownKeys: new Set() },
    );
    expect(extracted.sections).toHaveLength(1);
    expect(extracted.sections[0]?.checksum).toMatch(/^[0-9a-f]{8}$/u);
  });
});
