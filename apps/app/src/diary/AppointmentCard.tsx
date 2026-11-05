import { type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { contactHref } from '@/diary/care-contacts';
import { dayKey } from '@/features/diary/diary-care';
import type { DiaryInvitation } from '@/features/diary/diary-model';
import { appointmentHeadline, nextAppointment } from '@/features/diary/diary-visits';

/**
 * The next visit the doctor booked, above everything on the patient's day (owner 2026-11-04):
 * «Завтра у вас приём в 14:30», where, what to bring, and a call to the doctor's phone.
 */
export function AppointmentCard(props: {
  readonly invitation: DiaryInvitation;
  readonly now: Date;
}): JSX.Element {
  const next = () => nextAppointment(props.invitation, props.now);
  const phone = () => props.invitation.contacts?.find((contact) => contact.kind === 'phone');
  return (
    <Show when={next()}>
      {(visit) => (
        <section class="care-visit" aria-label="Приём у врача">
          <span class="care-visit__badge" aria-hidden="true">
            <AppGlyph name="calendar-check" class="care-visit__glyph" />
          </span>
          <div class="care-visit__text">
            <p class="care-visit__title">{appointmentHeadline(visit(), dayKey(props.now))}</p>
            <Show when={[visit().place, visit().note].filter(Boolean).join(' · ')}>
              {(detail) => <p class="care-visit__detail">{detail()}</p>}
            </Show>
          </div>
          <Show when={phone()}>
            {(contact) => (
              <a
                class="ui-button ui-button--secondary care-visit__call"
                href={contactHref(contact())}
                aria-label={`Позвонить: ${contact().label ?? contact().value}`}
              >
                <span class="ui-button__icon" aria-hidden="true">
                  <AppGlyph name="phone" class="care-visit__call-glyph" />
                </span>
                <span class="ui-button__label">Позвонить</span>
              </a>
            )}
          </Show>
        </section>
      )}
    </Show>
  );
}
