import { type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { DiarySheet } from '@/diary/DiarySheet';
import { consentDay } from '@/features/diary/consent/consent-status';
import {
  type StudyAnswerStatus,
  type StudyConsentStatus,
  studyStatusLabel,
} from '@/features/diary/consent/study-consent';
import type { DiaryStudy } from '@/features/diary/diary-model';
import '@/features/diary/consent/study-consent.css';

/** The title the patient sees for the offer; the wording of the consent itself is the doctor's. */
export const STUDY_OFFER_TITLE = 'Участие в исследовании (добровольно)';

/** One line on the patient's day while the study waits for an answer; a tap opens its text. */
export function StudyConsentCard(props: {
  readonly study: DiaryStudy;
  readonly onOpen: () => void;
}): JSX.Element {
  return (
    <button type="button" class="study-card" data-testid="study-card" onClick={props.onOpen}>
      <span class="study-card__badge" aria-hidden="true">
        <AppGlyph name="flask" class="study-card__glyph" />
      </span>
      <span class="study-card__text">
        <span class="study-card__title">{STUDY_OFFER_TITLE}</span>
        <span class="study-card__detail">{props.study.title}</span>
      </span>
      <AppGlyph name="caret-right" class="study-card__chevron" aria-hidden="true" />
    </button>
  );
}

/** What the settings row says about the answer. */
export function studyRowStatus(status: StudyConsentStatus): string | undefined {
  const label = studyStatusLabel(status);
  if (!label) return undefined;
  return status.kind === 'participates'
    ? 'вы участвуете'
    : status.kind === 'unanswered'
      ? 'ждёт ответа'
      : label;
}

/**
 * The study's consent text exactly as the doctor pasted it from the ethics committee's form, and
 * the answer. Declining or withdrawing changes nothing in the diary or the treatment.
 */
export function StudyConsentSheet(props: {
  readonly study: DiaryStudy;
  readonly status: StudyConsentStatus;
  readonly onAnswer: (status: StudyAnswerStatus) => void;
  readonly onClose: () => void;
}): JSX.Element {
  const answer = (status: StudyAnswerStatus): void => {
    props.onAnswer(status);
    props.onClose();
  };
  const state = (): string | undefined => {
    const current = props.status;
    if (current.kind === 'participates') return `Вы согласились ${consentDay(current.at)}`;
    if (current.kind === 'declined') return `Вы отказались ${consentDay(current.at)}`;
    if (current.kind === 'withdrawn') return `Вы отозвали согласие ${consentDay(current.at)}`;
    return undefined;
  };
  return (
    <DiarySheet
      title={STUDY_OFFER_TITLE}
      subtitle={props.study.title}
      tall
      onClose={props.onClose}
      footer={
        <div class="study-sheet__actions">
          <Show
            when={props.status.kind !== 'participates'}
            fallback={
              <Button class="diary-button" variant="secondary" onClick={() => answer('withdrawn')}>
                Отозвать согласие
              </Button>
            }
          >
            <Show when={props.status.kind === 'unanswered'}>
              <Button class="diary-button" variant="secondary" onClick={() => answer('declined')}>
                Не согласен(на)
              </Button>
            </Show>
            <Button class="diary-button" variant="primary" onClick={() => answer('accepted')}>
              Согласен(на)
            </Button>
          </Show>
        </div>
      }
    >
      <p class="study-sheet__protocol">
        Протокол {props.study.protocol} · версия {props.study.version}
      </p>
      <div class="study-sheet__text" data-testid="study-text">
        {props.study.text}
      </div>
      <p class="study-sheet__note">Можно отозвать в любой момент, лечение от этого не меняется</p>
      <Show when={state()}>
        {(line) => (
          <p class="study-sheet__state" role="status">
            {line()}
          </p>
        )}
      </Show>
    </DiarySheet>
  );
}
