import { createSignal, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { PatientEmojiPicker } from '@/components/PatientEmojiPicker';
import { SheetPopover } from '@/components/SheetPopover';
import { TextField } from '@/components/TextField';
import { isDiaryBirthDate, isDiaryPhone } from '@/features/diary/connected/diary-replica';
import { savePatientContact, telHref } from '@/features/diary/dashboard/patient-contact';

/**
 * Who the patient is for the doctor: an emoji from the full picker, a pseudonym and, when the
 * doctor wants to call back, the phone — with a call button and «В контакты» once it is valid.
 */
export function PatientIdentity(props: {
  readonly label: string;
  readonly emoji: string;
  readonly phone: string;
  /** `YYYY-MM-DD` or empty. */
  readonly birthDate: string;
  readonly onLabel: (value: string) => void;
  readonly onEmoji: (value: string) => void;
  readonly onPhone: (value: string) => void;
  readonly onBirthDate: (value: string) => void;
}): JSX.Element {
  const [picking, setPicking] = createSignal(false);
  const [error, setError] = createSignal('');
  const valid = (): boolean => isDiaryPhone(props.phone);
  return (
    <div class="diary-identity">
      <div class="diary-identity__row">
        <SheetPopover
          open={picking()}
          onOpenChange={setPicking}
          title="Значок пациента"
          triggerClass="diary-identity__emoji"
          triggerLabel={`Значок пациента: ${props.emoji}`}
          trigger={<span class="diary-identity__emoji-text">{props.emoji}</span>}
          contentClass="diary-identity__picker"
          placement="bottom-start"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <PatientEmojiPicker
            onSelect={(avatar) => {
              if (avatar.kind === 'symbol') props.onEmoji(avatar.value);
              setPicking(false);
            }}
          />
        </SheetPopover>
        <TextField
          label="Имя или псевдоним"
          class="diary-identity__name"
          inputClass="screen-editor__input"
          placeholder="Например: Лиса, А. К."
          value={props.label}
          onInput={(event) => props.onLabel(event.currentTarget.value)}
        />
      </div>
      <div class="diary-identity__row">
        <TextField
          label="Дата рождения"
          class="diary-identity__birth"
          inputClass="screen-editor__input"
          type="date"
          value={props.birthDate}
          error={
            props.birthDate && !isDiaryBirthDate(props.birthDate) ? 'Проверьте дату' : undefined
          }
          onInput={(event) => props.onBirthDate(event.currentTarget.value)}
        />
      </div>
      <div class="diary-identity__row">
        <TextField
          label="Телефон пациента"
          class="diary-identity__phone"
          inputClass="screen-editor__input"
          type="tel"
          inputmode="tel"
          autocomplete="off"
          placeholder="Чтобы перезвонить"
          value={props.phone}
          error={props.phone.trim() && !valid() ? 'Проверьте номер' : undefined}
          onInput={(event) => props.onPhone(event.currentTarget.value)}
        />
        <Show when={valid()}>
          <a
            class="diary-identity__action"
            href={telHref(props.phone)}
            aria-label="Позвонить пациенту"
          >
            <AppGlyph name="phone" class="diary-identity__glyph" />
          </a>
          <Button
            type="button"
            variant="icon"
            class="diary-identity__action"
            aria-label="Добавить в контакты телефона"
            icon={<AppGlyph name="users" class="diary-identity__glyph" />}
            onClick={() => {
              setError('');
              savePatientContact({
                name: props.label.trim() || 'Пациент',
                phone: props.phone,
              }).catch((cause: unknown) =>
                setError(cause instanceof Error ? cause.message : 'Не удалось сохранить контакт.'),
              );
            }}
          />
        </Show>
      </div>
      <Show when={error()}>
        <p class="diary-dash__error" role="alert">
          {error()}
        </p>
      </Show>
    </div>
  );
}
