import QRCode from 'qrcode';
import {
  createEffect,
  createResource,
  createSignal,
  type JSX,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import { toast } from 'solid-sonner';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import type { DoctorDiaries } from '@/features/diary/connected/doctor-workspace';
import { OnlineTag } from '@/features/diary/dashboard/OnlineTag';
import { isOnline } from '@/features/diary/dashboard/presence';
import { FEEDBACK_MOMENTS, playFeedback } from '@/state/ui-feedback';

/**
 * The one-time code that connects the patient's phone. It works once and for 72 hours; a photo of
 * it taken later opens nothing. The sheet watches the live stream: when a new phone of this patient
 * pairs, the code gives way to «Телефон подключён» with the phone's presence.
 */
export function PairingView(props: {
  readonly workspace: DoctorDiaries;
  readonly patientId: string;
  readonly onDone: () => void;
}): JSX.Element {
  const summary = () => props.workspace.patient(props.patientId)?.summary;
  const [current, setCurrent] = createSignal(summary());
  onCleanup(props.workspace.subscribe(() => setCurrent(summary())));
  const devicesBefore = current()?.devices ?? 0;
  const connected = () => (current()?.devices ?? 0) > devicesBefore;
  createEffect(
    on(
      connected,
      (now) => {
        if (now) playFeedback(...FEEDBACK_MOMENTS.received);
      },
      { defer: true },
    ),
  );
  const [link] = createResource(async () => {
    const url = await props.workspace.pairingLink(props.patientId);
    return {
      url,
      image: await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 2, width: 360 }),
    };
  });
  return (
    <div class="diary-pair">
      <Show when={link.error}>
        <p class="diary-dash__error" role="alert">
          {link.error instanceof Error ? link.error.message : 'Не удалось создать код.'}
        </p>
      </Show>
      <Show when={connected()}>
        <div class="diary-pair__done" role="status">
          <span class="diary-pair__check" aria-hidden="true">
            <AppGlyph name="check" class="diary-pair__check-icon" />
          </span>
          <p class="diary-pair__done-title">Телефон подключён</p>
          <Show when={current() && isOnline(current() as NonNullable<ReturnType<typeof current>>)}>
            <OnlineTag />
          </Show>
          <Button variant="primary" class="diary-pair__done-button" onClick={props.onDone}>
            Готово
          </Button>
        </div>
      </Show>
      <Show
        when={!connected() && link()}
        fallback={
          <Show when={!connected()}>
            <p class="diary-dash__quiet">Готовим код…</p>
          </Show>
        }
      >
        {(ready) => (
          <>
            <img class="diary-pair__code" src={ready().image} alt="Код для телефона пациента" />
            <p class="diary-pair__hint">
              Пациент наводит камеру телефона на код. Код одноразовый, действует 72 часа.
            </p>
            <p class="diary-pair__waiting">
              <span class="diary-pair__waiting-dot" aria-hidden="true" />
              Ждём телефон пациента
            </p>
            <div class="diary-pair__actions">
              <Button
                onClick={() => {
                  void navigator.clipboard
                    .writeText(ready().url)
                    .then(() => toast.success('Ссылка скопирована.'))
                    .catch(() => toast.error('Не удалось скопировать.'));
                }}
              >
                Копировать ссылку
              </Button>
              <Button variant="primary" onClick={props.onDone}>
                Готово
              </Button>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}
