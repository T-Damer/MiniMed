import { createSignal, type JSX, onCleanup, onMount } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { SheetPopover } from '@/components/SheetPopover';
import {
  type DoctorProfile,
  getDoctorProfile,
  resetDoctorProfile,
  subscribeDoctorProfile,
} from '@/features/reference/doctor-profile';
import { doctorProfileSummary } from '@/features/reference/doctor-profile-feeds';
import '@/styles/doctor-profile-settings.css';

/**
 * «Профиль врача»: the specialties the app has noticed you read, used only to put the likelier
 * meaning of an ambiguous term first. Lives on this device; «Сбросить» forgets it.
 */
export function DoctorProfileSettings(): JSX.Element {
  const [profile, setProfile] = createSignal<DoctorProfile>(getDoctorProfile());
  const [helpOpen, setHelpOpen] = createSignal(false);
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
          <span class="doctor-profile-settings__summary" data-testid="doctor-profile-summary">
            {doctorProfileSummary(profile())}
          </span>
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
      </div>
      <Button
        class="settings-row__action"
        disabled={empty()}
        onClick={() => setProfile(resetDoctorProfile())}
      >
        Сбросить
      </Button>
    </div>
  );
}
