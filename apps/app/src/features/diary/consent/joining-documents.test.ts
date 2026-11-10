import { describe, expect, it } from 'vitest';

import { applyRevisions, EMPTY_REPLICA } from '@/features/diary/connected/diary-replica';
import { consentStatus, consentVersionLabel } from '@/features/diary/consent/consent-status';
import {
  acceptedAll,
  acceptedAt,
  diaryOperator,
  JOINING_DOCUMENT_IDS,
  joiningDocuments,
  joiningParagraph,
  operatorFromProfile,
  parseJoiningAcceptances,
} from '@/features/diary/consent/joining-documents';
import { careInvitation, starterCareDraft } from '@/features/diary/diary-care-draft';
import { parseDiaryInvitation } from '@/features/diary/diary-model';

const PROFILE = {
  organizationName: 'ООО «Клиника»',
  organizationAddress: 'Воронеж, ул. Мира, 1',
  ogrn: '1027700132195',
  clinicianFullName: 'Иванова Анна Петровна',
  clinicianPosition: 'врач-психиатр',
};

function accepted(at = '2026-11-04T08:00:00.000Z') {
  return joiningDocuments(true).map((document) => ({
    document: document.id,
    version: document.version,
    at,
  }));
}

describe('the joining documents', () => {
  it('are the informed consent, the personal-data consent and the contract, each with a summary', () => {
    for (const connected of [true, false]) {
      const documents = joiningDocuments(connected);
      expect(documents.map((document) => document.id)).toEqual([...JOINING_DOCUMENT_IDS]);
      for (const document of documents) {
        expect(document.summary.length).toBeGreaterThan(0);
        expect(document.sections.length).toBeGreaterThan(1);
        expect(document.version).toMatch(/^template-/u);
      }
    }
    expect(joiningDocuments(true).map((document) => document.title)).toEqual([
      'Информированное согласие на дистанционное наблюдение',
      'Согласие на обработку персональных данных',
      'Договор на дистанционное сопровождение',
    ]);
  });

  it('name the clinic and the doctor from «Врач и организация», and leave blanks for the rest', () => {
    const operator = operatorFromProfile(PROFILE);
    expect(operator).toEqual({
      organization: 'ООО «Клиника»',
      address: 'Воронеж, ул. Мира, 1',
      ogrn: '1027700132195',
      clinician: 'Иванова Анна Петровна',
      position: 'врач-психиатр',
    });
    const contract = joiningDocuments(true)[2];
    const opening = contract?.sections[0]?.paragraphs[0] ?? [];
    const filled = joiningParagraph(opening, operator ?? {});
    expect(filled.filter((part) => part.blank)).toEqual([]);
    expect(filled.map((part) => part.text).join('')).toContain(
      'ООО «Клиника», Воронеж, ул. Мира, 1, ОГРН 1027700132195, в лице лечащего врача Иванова Анна Петровна',
    );
    // Nothing filled in: every detail is a visible blank, never an empty gap.
    const empty = joiningParagraph(opening, {});
    expect(empty.filter((part) => part.blank).map((part) => part.text)).toContain(
      'медицинская организация',
    );
    expect(operatorFromProfile({})).toBeUndefined();
  });

  it('take the doctor’s signature when the profile has no name', () => {
    const invitation = careInvitation({
      id: 'operatorplan1',
      draft: starterCareDraft(),
      doctor: 'Др. Смирнов',
      note: '',
      operator: { organization: 'Клиника' },
    });
    expect(diaryOperator(invitation)).toEqual({
      organization: 'Клиника',
      clinician: 'Др. Смирнов',
    });
    // The plan carries the details through its own format, and the next version keeps them.
    expect(parseDiaryInvitation(JSON.parse(JSON.stringify(invitation))).operator).toEqual({
      organization: 'Клиника',
    });
    const next = careInvitation({
      id: 'operatorplan1',
      draft: starterCareDraft(),
      doctor: 'Др. Смирнов',
      note: '',
      previous: invitation,
    });
    expect(next.operator).toEqual({ organization: 'Клиника' });
  });
});

describe('acceptances', () => {
  it('count only when every document is accepted in its current wording', () => {
    const documents = joiningDocuments(true);
    const all = accepted();
    expect(acceptedAll(documents, all)).toBe(true);
    expect(acceptedAll(documents, all.slice(0, 2))).toBe(false);
    expect(
      acceptedAll(
        documents,
        all.map((item, index) =>
          index === 1 ? { ...item, version: 'template-2026-01-01' } : item,
        ),
      ),
    ).toBe(false);
  });

  it('are read defensively and in the documents’ order', () => {
    const [monitoring, data, contract] = accepted();
    expect(
      parseJoiningAcceptances([
        contract,
        { document: 'unknown', version: 'v', at: '2026-11-04T08:00:00.000Z' },
        { document: 'monitoring', version: '', at: '2026-11-04T08:00:00.000Z' },
        { document: 'personal-data', version: 'v', at: 'когда-то' },
        monitoring,
        data,
        'text',
      ]),
    ).toEqual([monitoring, data, contract]);
    expect(parseJoiningAcceptances({})).toEqual([]);
  });

  it('start the diary at the last one', () => {
    expect(
      acceptedAt([
        { document: 'monitoring', version: 'v', at: '2026-11-04T08:02:00.000Z' },
        { document: 'contract', version: 'v', at: '2026-11-04T08:05:00.000Z' },
        { document: 'personal-data', version: 'v', at: '2026-11-04T08:01:00.000Z' },
      ]),
    ).toBe('2026-11-04T08:05:00.000Z');
    expect(acceptedAt([])).toBeUndefined();
  });
});

describe('what the doctor sees', () => {
  it('comes from the patient’s consent record, never the doctor’s', () => {
    const consents = accepted();
    const replica = applyRevisions(EMPTY_REPLICA, [
      {
        id: 'consent',
        rev: 1,
        author: 'p:device000001',
        at: 't',
        payload: {
          kind: 'consent',
          at: '2026-11-04T08:00:00.000Z',
          version: 'x',
          documents: consents,
        },
      },
    ]);
    expect(replica.consentAt).toBe('2026-11-04T08:00:00.000Z');
    expect(replica.consents).toEqual(consents);
    const forged = applyRevisions(EMPTY_REPLICA, [
      {
        id: 'consent',
        rev: 1,
        author: 'd:doctor000001',
        at: 't',
        payload: {
          kind: 'consent',
          at: '2026-11-04T08:00:00.000Z',
          version: 'x',
          documents: consents,
        },
      },
    ]);
    expect(forged.consentAt).toBeUndefined();
    expect(forged.rejected).toBe(1);
  });

  it('says accepted and when, waiting on a paired phone, or nothing before pairing', () => {
    const at = '2026-11-04T08:00:00.000Z';
    expect(
      consentStatus({ asks: true, consentAt: at, consents: accepted(at), devices: 1 }),
    ).toEqual({
      kind: 'accepted',
      at,
      current: true,
    });
    expect(consentStatus({ asks: true, consentAt: at, consents: undefined, devices: 1 })).toEqual({
      kind: 'accepted-summary',
      at,
    });
    expect(
      consentStatus({ asks: true, consentAt: undefined, consents: undefined, devices: 1 }),
    ).toEqual({ kind: 'waiting' });
    expect(
      consentStatus({ asks: true, consentAt: undefined, consents: undefined, devices: 0 }),
    ).toBeUndefined();
    expect(
      consentStatus({ asks: false, consentAt: undefined, consents: undefined, devices: 1 }),
    ).toBeUndefined();
  });

  it('reads a wording’s version as a date', () => {
    expect(consentVersionLabel('template-2026-11-04')).toBe('шаблон от 04.11.2026');
    expect(consentVersionLabel('2027-02-01')).toBe('редакция от 01.02.2027');
    expect(consentVersionLabel('v7')).toBe('другая редакция');
  });
});
