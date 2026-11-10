import { describe, expect, it } from 'vitest';

import { applyRevisions, EMPTY_REPLICA } from '@/features/diary/connected/diary-replica';
import {
  isStudyParticipant,
  laterStudyAnswer,
  parseStudyAnswer,
  type StudyAnswer,
  studyAnswer,
  studyAnswerFingerprint,
  studyConsentStatus,
  studyStatusLabel,
} from '@/features/diary/consent/study-consent';
import { careInvitation, emptyCareDraft, studyFromDraft } from '@/features/diary/diary-care-draft';
import {
  DIARY_FORMAT_VERSION,
  diaryTemplate,
  parseDiaryInvitation,
} from '@/features/diary/diary-model';

const STUDY = { id: 'studyabc123', version: '2' };
const AT = '2026-11-04T08:00:00.000Z';
const answer = (status: StudyAnswer['status'], over: Partial<StudyAnswer> = {}): StudyAnswer => ({
  study: STUDY.id,
  version: STUDY.version,
  status,
  at: AT,
  ...over,
});

describe('studyConsentStatus', () => {
  it('is «none» for a diary outside a study, whatever the answer says', () => {
    expect(studyConsentStatus(undefined, undefined)).toEqual({ kind: 'none' });
    expect(studyConsentStatus(undefined, answer('accepted'))).toEqual({ kind: 'none' });
  });

  it('is «unanswered» until the patient answers this study', () => {
    expect(studyConsentStatus(STUDY, undefined)).toEqual({ kind: 'unanswered', outdated: false });
    expect(studyConsentStatus(STUDY, answer('accepted', { study: 'otherstudy01' }))).toEqual({
      kind: 'unanswered',
      outdated: false,
    });
  });

  it('reads the answer to the current version', () => {
    expect(studyConsentStatus(STUDY, answer('accepted'))).toEqual({ kind: 'participates', at: AT });
    expect(studyConsentStatus(STUDY, answer('declined'))).toEqual({ kind: 'declined', at: AT });
    expect(studyConsentStatus(STUDY, answer('withdrawn'))).toEqual({ kind: 'withdrawn', at: AT });
  });

  it('asks again after a new version, but a withdrawal stands in any version', () => {
    expect(studyConsentStatus(STUDY, answer('accepted', { version: '1' }))).toEqual({
      kind: 'unanswered',
      outdated: true,
    });
    expect(studyConsentStatus(STUDY, answer('declined', { version: '1' }))).toEqual({
      kind: 'unanswered',
      outdated: true,
    });
    expect(studyConsentStatus(STUDY, answer('withdrawn', { version: '1' }))).toEqual({
      kind: 'withdrawn',
      at: AT,
    });
  });

  it('counts only a current acceptance as consent, and names each state', () => {
    const states = [
      studyConsentStatus(undefined, undefined),
      studyConsentStatus(STUDY, undefined),
      studyConsentStatus(STUDY, answer('accepted')),
      studyConsentStatus(STUDY, answer('declined')),
      studyConsentStatus(STUDY, answer('withdrawn')),
    ];
    expect(states.map(isStudyParticipant)).toEqual([false, false, true, false, false]);
    expect(states.map(studyStatusLabel)).toEqual([
      undefined,
      'не ответил',
      'участвует',
      'отказался',
      'отозвал',
    ]);
  });
});

describe('study answers', () => {
  it('are read defensively', () => {
    expect(parseStudyAnswer(answer('accepted'))).toEqual(answer('accepted'));
    expect(parseStudyAnswer(null)).toBeUndefined();
    expect(parseStudyAnswer([])).toBeUndefined();
    expect(parseStudyAnswer(answer('accepted', { study: 'Bad Id!' }))).toBeUndefined();
    expect(parseStudyAnswer(answer('accepted', { version: '' }))).toBeUndefined();
    expect(parseStudyAnswer({ ...answer('accepted'), status: 'maybe' })).toBeUndefined();
    expect(parseStudyAnswer(answer('accepted', { at: 'когда-то' }))).toBeUndefined();
  });

  it('are made for the study as it stands and the later one wins', () => {
    const made = studyAnswer(STUDY, 'accepted', new Date(AT));
    expect(made).toEqual(answer('accepted'));
    const later = answer('withdrawn', { at: '2026-11-05T08:00:00.000Z' });
    expect(laterStudyAnswer(made, later)).toBe(later);
    expect(laterStudyAnswer(later, made)).toBe(later);
    expect(laterStudyAnswer(undefined, made)).toBe(made);
    expect(laterStudyAnswer(made, undefined)).toBe(made);
    expect(studyAnswerFingerprint(undefined)).toBe('1');
    expect(studyAnswerFingerprint(made)).not.toBe(studyAnswerFingerprint(later));
  });
});

describe('the study in the plan', () => {
  const template = diaryTemplate('care');
  const base = {
    v: DIARY_FORMAT_VERSION,
    id: 'studyplan0001',
    template: 'care',
    title: template?.title,
    issuedAt: AT,
    fields: template?.fields,
    plan: [{ id: 'p1', name: 'Сертралин', times: [{ time: '08:00' }] }],
    planTitle: 'Лекарства',
  };
  const study = {
    id: 'studyabc123',
    title: 'Наблюдение за переносимостью',
    protocol: '№ 12',
    version: '2',
    text: 'Первая строка\n\nВторая строка',
  };

  it('is kept verbatim and ignored by plans without it', () => {
    expect(parseDiaryInvitation({ ...base, study }).study).toEqual(study);
    expect(parseDiaryInvitation(base).study).toBeUndefined();
  });

  it('refuses a broken study', () => {
    expect(() => parseDiaryInvitation({ ...base, study: { ...study, text: '  ' } })).toThrow();
    expect(() => parseDiaryInvitation({ ...base, study: { ...study, title: '' } })).toThrow();
    expect(() => parseDiaryInvitation({ ...base, study: { ...study, id: 'Нет' } })).toThrow();
    expect(() =>
      parseDiaryInvitation({ ...base, study: { ...study, text: 'a\u0007b' } }),
    ).toThrow();
    expect(() => parseDiaryInvitation({ ...base, study: 'text' })).toThrow();
  });

  it('comes from the editor with pasted line ends made plain and an id that stays', () => {
    const made = studyFromDraft({
      title: ' Исследование ',
      protocol: '№ 3',
      version: '1',
      consentText: ' Строка 1\r\nСтрока\t2\r\n',
    });
    expect(made).toMatchObject({
      title: 'Исследование',
      protocol: '№ 3',
      version: '1',
      text: 'Строка 1\nСтрока 2',
    });
    expect(made?.id).toMatch(/^[a-z0-9]{6,24}$/u);
    const draft = {
      ...emptyCareDraft(),
      study: {
        id: 'studyabc123',
        ...{ title: 'T', protocol: 'P', version: 'V', consentText: 'X' },
      },
    };
    const invitation = careInvitation({ id: 'studyplan0002', draft, doctor: '', note: '' });
    expect(invitation.study?.id).toBe('studyabc123');
    // Empty fields remove the study; a half-filled study is an error, not a silent drop.
    expect(
      studyFromDraft({ title: '', protocol: '', version: '', consentText: '' }),
    ).toBeUndefined();
    expect(studyFromDraft(undefined)).toBeUndefined();
    expect(() =>
      studyFromDraft({ title: 'Т', protocol: '', version: '', consentText: 'x' }),
    ).toThrow(/заполните/u);
  });

  it('keeps a patient’s answer in the consent record apart from the joining documents', () => {
    const revision = (payload: unknown, rev: number) => ({
      id: 'consent',
      rev,
      author: 'p:device000001',
      at: AT,
      payload,
    });
    const documents = [{ document: 'monitoring', version: 'template-2026-11-04', at: AT }];
    const joined = applyRevisions(EMPTY_REPLICA, [
      revision({ kind: 'consent', at: AT, version: 'v', documents }, 1),
    ]);
    expect(joined.consentAt).toBe(AT);
    expect(joined.study).toBeUndefined();
    const answered = applyRevisions(joined, [
      revision({ kind: 'consent', at: AT, version: 'v', documents, study: answer('accepted') }, 2),
    ]);
    expect(answered.study).toEqual(answer('accepted'));
    expect(answered.consents).toHaveLength(1);
    // A phone that does not know studies rewrites the record: the answer stays.
    const rewritten = applyRevisions(answered, [
      revision({ kind: 'consent', at: AT, version: 'v', documents }, 3),
    ]);
    expect(rewritten.study).toEqual(answer('accepted'));
    // A record with only the study answer is not the joining documents' consent.
    const alone = applyRevisions(EMPTY_REPLICA, [
      revision({ kind: 'consent', at: AT, version: 'v', study: answer('declined') }, 1),
    ]);
    expect(alone.consentAt).toBeUndefined();
    expect(alone.study).toEqual(answer('declined'));
    // A broken answer is ignored.
    const broken = applyRevisions(EMPTY_REPLICA, [
      revision({ kind: 'consent', at: AT, version: 'v', documents, study: { status: 'x' } }, 1),
    ]);
    expect(broken.study).toBeUndefined();
    expect(broken.consentAt).toBe(AT);
  });
});
