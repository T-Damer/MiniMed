import type { JSX } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { TextArea } from '@/components/TextArea';
import { TextField } from '@/components/TextField';
import {
  type CareDraft,
  type CareStudyDraft,
  EMPTY_STUDY_DRAFT,
} from '@/features/diary/diary-care-draft';
import { MAX_DIARY_STUDY_TEXT } from '@/features/diary/diary-model';

/** True when any field of the study is filled. */
export function studyFilled(study: CareStudyDraft | undefined): boolean {
  return Boolean(
    study && (study.title || study.protocol || study.version || study.consentText).trim(),
  );
}

/**
 * The research study this diary takes part in: its title, protocol number and version, and the
 * consent text approved by the ethics committee, pasted as it is. The patient sees the text as
 * written and answers on the phone; nothing here is worded by the app.
 */
export function StudyEditor(props: {
  readonly draft: CareDraft;
  readonly patch: (next: Partial<CareDraft>) => void;
  readonly onDone: () => void;
}): JSX.Element {
  const study = (): CareStudyDraft => props.draft.study ?? EMPTY_STUDY_DRAFT;
  const change = (next: Partial<CareStudyDraft>): void =>
    props.patch({ study: { ...study(), ...next } });
  return (
    <div class="screen-editor__sheet">
      <TextField
        inputClass="screen-editor__input"
        label="Название исследования"
        maxLength={200}
        value={study().title}
        onInput={(event) => change({ title: event.currentTarget.value })}
      />
      <TextField
        inputClass="screen-editor__input"
        label="Номер протокола"
        maxLength={200}
        value={study().protocol}
        onInput={(event) => change({ protocol: event.currentTarget.value })}
      />
      <TextField
        inputClass="screen-editor__input"
        label="Версия протокола и согласия"
        maxLength={200}
        value={study().version}
        onInput={(event) => change({ version: event.currentTarget.value })}
      />
      <TextArea
        textareaClass="screen-editor__input screen-editor__study-text"
        label="Текст согласия, одобренный этическим комитетом"
        maxLength={MAX_DIARY_STUDY_TEXT}
        rows={10}
        value={study().consentText}
        onInput={(event) => change({ consentText: event.currentTarget.value })}
      />
      <div class="screen-editor__sheet-actions">
        <Button
          type="button"
          variant="quiet"
          icon={<AppGlyph name="trash" class="screen-editor__glyph" />}
          disabled={!studyFilled(props.draft.study)}
          onClick={() => {
            // The id stays in the draft's plan until saved; clearing every field removes the study.
            props.patch({ study: { ...EMPTY_STUDY_DRAFT } });
          }}
        >
          Убрать исследование
        </Button>
        <Button type="button" variant="primary" onClick={() => props.onDone()}>
          Готово
        </Button>
      </div>
    </div>
  );
}
