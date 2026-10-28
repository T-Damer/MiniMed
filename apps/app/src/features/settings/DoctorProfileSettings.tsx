import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { SheetPopover } from '@/components/SheetPopover';
import {
  type DoctorProfile,
  getDoctorProfile,
  noteDoctorField,
  PROFILE_FULL_CONFIDENCE,
  resetDoctorProfile,
  subscribeDoctorProfile,
} from '@/features/reference/doctor-profile';
import { doctorProfileFieldsLine } from '@/features/reference/doctor-profile-feeds';
import { MEDICAL_FIELDS } from '@/features/reference/medical-fields';
import '@/styles/doctor-profile-settings.css';

/**
 * «Профиль врача»: the specialties the app has noticed you read, used only to put the likelier
 * meaning of an ambiguous term first. Lives on this device. Empty, it offers «Добавить» (pick the
 * specialties by hand); learned, «Сбросить» forgets it.
 */
export function DoctorProfileSettings(): JSX.Element {
  const [profile, setProfile] = createSignal<DoctorProfile>(getDoctorProfile());
  const [helpOpen, setHelpOpen] = createSignal(false);
  const [pickOpen, setPickOpen] = createSignal(false);
  const empty = (): boolean => Object.keys(profile().fields).length === 0;

  onMount(() => {
    setProfile(getDoctorProfile());
    onCleanup(subscribeDoctorProfile(setProfile));
  });

  return (
    <div class="settings-row" data-testid="doctor-profile-settings">
      <div class="settings-row__text">
        <span class="settings-row__label settings-row__label--with-icon">
          <AppGlyph name="heartbeat" class="settings-row__label-icon" aria-hidden="true" />
          Профиль врача
          <SheetPopover
            open={helpOpen()}
            onOpenChange={setHelpOpen}
            title="Профиль врача"
            triggerClass="doctor-profile-settings__help-button"
            triggerLabel="Что такое профиль врача"
            triggerTitle="Что такое профиль врача"
            trigger={<AppGlyph name="question" class="doctor-profile-settings__help-icon" />}
            contentClass="doctor-profile-settings__help-panel"
            placement="bottom-start"
          >
            <p class="doctor-profile-settings__help-text">
              Приложение запоминает, в каких областях медицины вы читаете и ищете, чтобы у
              многозначного термина первым показывать нужное значение. Данные хранятся только на
              этом устройстве и никуда не отправляются.
            </p>
          </SheetPopover>
        </span>
        <Show when={!empty()}>
          <p
            class="settings-row__helper doctor-profile-settings__summary"
            data-testid="doctor-profile-summary"
          >
            {doctorProfileFieldsLine(profile())}
          </p>
        </Show>
      </div>
      <Show
        when={!empty()}
        fallback={
          <SheetPopover
            open={pickOpen()}
            onOpenChange={setPickOpen}
            title="Ваши специальности"
            triggerClass="ui-button settings-row__action"
            triggerLabel="Добавить специальности"
            trigger="Добавить"
            contentClass="doctor-profile-settings__pick-panel"
            placement="bottom-end"
          >
            <div class="doctor-profile-settings__fields">
              <For each={MEDICAL_FIELDS}>
                {(field) => (
                  <button
                    type="button"
                    class="doctor-profile-settings__field"
                    onClick={() => setProfile(noteDoctorField(field.id, PROFILE_FULL_CONFIDENCE))}
                  >
                    {field.label}
                  </button>
                )}
              </For>
            </div>
          </SheetPopover>
        }
      >
        <Button class="settings-row__action" onClick={() => setProfile(resetDoctorProfile())}>
          Сбросить
        </Button>
      </Show>
    </div>
  );
}
