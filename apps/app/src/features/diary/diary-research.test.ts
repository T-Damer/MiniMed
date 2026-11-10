import { describe, expect, it } from 'vitest';
import { careDraftFrom, copyCareSection } from './diary-care-draft';
import { DiaryFormatError, diaryTemplate, parseDiaryInvitation } from './diary-model';
import { studyAtcCodes } from './diary-research';

const NOW = Date.parse('2026-11-10T09:00:00Z');

function invitationWith(plan: unknown) {
  const care = diaryTemplate('care');
  return parseDiaryInvitation(
    {
      v: 2,
      id: 'studydiary1',
      template: 'care',
      title: care?.title,
      issuedAt: '2026-11-01T09:00:00.000Z',
      fields: care?.fields,
      plan,
    },
    NOW,
  );
}

describe('RESEARCH1 plan item study fields', () => {
  it('keeps the catalog slug, ATC codes and target of a medicine', () => {
    const invitation = invitationWith([
      {
        id: 'p1',
        name: 'Кветиапин',
        dose: '25 мг',
        drug: 'quetiapine',
        atc: ['N05AH04', 'N05AH04'],
        target: 'сон',
      },
    ]);
    expect(invitation.plan?.[0]).toMatchObject({
      drug: 'quetiapine',
      atc: ['N05AH04'],
      target: 'сон',
    });
  });

  it('refuses a malformed ATC code', () => {
    expect(() => invitationWith([{ id: 'p1', name: 'X', atc: ['n05 ah'] }])).toThrow(
      DiaryFormatError,
    );
  });

  it('a plan without the study fields reads as before', () => {
    const item = invitationWith([{ id: 'p1', name: 'Эналаприл', dose: '5 мг' }]).plan?.[0];
    expect(item).toEqual({ id: 'p1', name: 'Эналаприл', dose: '5 мг' });
  });

  it('studyAtcCodes normalises and drops invalid codes', () => {
    expect(studyAtcCodes([' n06ab06 ', 'N06AB06', 'bad code', 'C09AA02'])).toEqual([
      'N06AB06',
      'C09AA02',
    ]);
    expect(studyAtcCodes(undefined)).toEqual([]);
  });

  it('the editor round-trips the fields and a copied section drops them', () => {
    const invitation = invitationWith([
      { id: 'p1', name: 'Кветиапин', drug: 'quetiapine', atc: ['N05AH04'], target: 'сон' },
    ]);
    const draft = careDraftFrom(invitation);
    const drug = draft.sections.find((section) => section.kind === 'drug');
    expect(drug).toMatchObject({ drug: 'quetiapine', atc: ['N05AH04'], target: 'сон' });
    const copy = drug ? copyCareSection(drug) : undefined;
    expect(copy?.drug).toBeUndefined();
    expect(copy?.atc).toBeUndefined();
    expect(copy?.target).toBeUndefined();
  });
});
