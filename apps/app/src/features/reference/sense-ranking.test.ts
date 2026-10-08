import type { DefinitionReferenceSense } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';
import { EMPTY_DOCTOR_PROFILE, withSignal } from './doctor-profile';
import { rankSenses, type SenseCandidate, senseChips } from './sense-ranking';

const fracture: DefinitionReferenceSense = {
  field: 'traumatology',
  fieldLabel: 'травматология',
  documents: 1,
  authority: 3,
  usage: 8,
  termUsage: 275,
};
const mood: DefinitionReferenceSense = {
  field: 'psychiatry',
  fieldLabel: 'психиатрия',
  documents: 1,
  authority: 1,
  usage: 68,
  termUsage: 275,
};
const dictionary: DefinitionReferenceSense = {
  field: 'psychiatry',
  fieldLabel: 'психиатрия',
  documents: 1,
  authority: 0,
  usage: 68,
  termUsage: 275,
};

const candidates = (...senses: (DefinitionReferenceSense | undefined)[]) =>
  senses.map((sense, order): SenseCandidate<string> => ({ item: `sense-${order}`, sense, order }));

describe('rankSenses', () => {
  it('puts the widely used psychiatric sense of «депрессия» before the rare fracture sense', () => {
    // The core lists the glossary entry first (explicit-definition); usage must outweigh it.
    const ranked = rankSenses(candidates(fracture, mood, dictionary));
    expect(ranked.map((entry) => entry.item)).toEqual(['sense-1', 'sense-2', 'sense-0']);
    expect(ranked[0]?.sense?.fieldLabel).toBe('психиатрия');
  });

  it('keeps the glossary above a dictionary when both are used alike', () => {
    const glossary = { ...mood, authority: 3 };
    const ranked = rankSenses(candidates(dictionary, glossary));
    expect(ranked.map((entry) => entry.item)).toEqual(['sense-1', 'sense-0']);
  });

  it('keeps the core order when no sense carries build signals', () => {
    const ranked = rankSenses(candidates(undefined, undefined, undefined));
    expect(ranked.map((entry) => entry.item)).toEqual(['sense-0', 'sense-1', 'sense-2']);
  });

  it('does not trust a tiny usage difference', () => {
    const rare = { ...fracture, usage: 2 };
    const rarer = { ...mood, usage: 1, authority: 1 };
    // Both barely used: authority decides, not the 2:1 ratio.
    expect(rankSenses(candidates(rarer, rare)).map((entry) => entry.item)).toEqual([
      'sense-1',
      'sense-0',
    ]);
  });

  it('lets a clear profile bring the doctor’s own field up, but not a stray tap', () => {
    let trauma = EMPTY_DOCTOR_PROFILE;
    for (let index = 0; index < 8; index += 1) trauma = withSignal(trauma, 'traumatology');
    const withProfile = rankSenses(candidates(fracture, mood), trauma);
    expect(withProfile[0]?.sense?.field).toBe('traumatology');
    const oneTap = rankSenses(
      candidates(fracture, mood),
      withSignal(EMPTY_DOCTOR_PROFILE, 'traumatology'),
    );
    expect(oneTap[0]?.sense?.field).toBe('psychiatry');
  });

  it('does not let the profile of another field change the order', () => {
    let cardio = EMPTY_DOCTOR_PROFILE;
    for (let index = 0; index < 10; index += 1) cardio = withSignal(cardio, 'cardiology');
    expect(rankSenses(candidates(fracture, mood), cardio)[0]?.sense?.field).toBe('psychiatry');
  });
});

describe('senseChips', () => {
  const first = (ranked: { item: string }[]) => (entry: { item: string }) =>
    entry.item === ranked[0]?.item;

  it('shows one chip per other field, labelled by the field', () => {
    const ranked = rankSenses(candidates(fracture, mood, dictionary, { ...fracture, usage: 3 }));
    const chips = senseChips(ranked, first(ranked), () => 'словарь');
    expect(chips.map((chip) => chip.label)).toEqual(['травматология']);
  });

  it('labels a sense without a field by its fallback', () => {
    const noField: DefinitionReferenceSense = { authority: 0, documents: 1, usage: 0 };
    const ranked = rankSenses(candidates(mood, noField));
    expect(
      senseChips(ranked, first(ranked), () => 'общий словарь').map((chip) => chip.label),
    ).toEqual(['общий словарь']);
  });

  it('does not offer another wording of the meaning already on screen', () => {
    const same = { ...mood, field: 'neurology', fieldLabel: 'неврология', meaning: 0 };
    const ranked = rankSenses(
      candidates({ ...mood, meaning: 0 }, same, { ...fracture, meaning: 1 }),
    );
    expect(senseChips(ranked, first(ranked), () => 'словарь').map((chip) => chip.label)).toEqual([
      'травматология',
    ]);
  });

  it('offers the sense that was on screen once another is chosen', () => {
    const ranked = rankSenses(candidates(fracture, mood));
    const chosen = ranked[1];
    const chips = senseChips(
      ranked,
      (entry) => entry === chosen,
      () => 'словарь',
    );
    expect(chips.map((chip) => chip.label)).toEqual(['психиатрия']);
  });
});
