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
import '@/components/page-skeleton.css';
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
  // Read by state, not by `link()`: a pending resource read inside the sheet would swap the whole
  // body for the sheet's own loading lines, and this view has its own placeholder of the code's size.
  const ready = () => (link.state === 'ready' ? link() : undefined);
  /** The code's picture has been decoded: the placeholder gives way to it. */
  const [shown, setShown] = createSignal(false);
  return (
    <div class="diary-pair">
      <Show when={link.error}>
        <p class="diary-dash__error" role="alert">
          {link.error instanceof Error ? link.error.message : 'Не удалось создать код.'}
        </p>
      </Show>
      <Show
        when={connected()}
        fallback={
          <>
            {/* The code's own box from the first frame: the placeholder and the picture lie on one
                another, so the picture fades in over it and nothing around moves. */}
            <div class="diary-pair__code-box" aria-busy={ready() === undefined}>
              <span
                class="page-skeleton__bar diary-pair__skeleton"
                classList={{ 'diary-pair__skeleton--gone': shown() }}
                aria-hidden="true"
                data-testid="pair-skeleton"
              />
              <Show when={ready()}>
                {(code) => (
                  <img
                    class="diary-pair__code"
                    classList={{ 'diary-pair__code--shown': shown() }}
                    src={code().image}
                    alt="Код для телефона пациента"
                    onLoad={() => setShown(true)}
                  />
                )}
              </Show>
            </div>
            <p class="diary-pair__hint">
              Пациент наводит камеру телефона на код. Код одноразовый, действует 72 часа.
            </p>
            <p class="diary-pair__waiting">
              <span class="diary-pair__waiting-dot" aria-hidden="true" />
              Ждём телефон пациента
            </p>
            <div class="diary-pair__actions">
              <Button
                disabled={ready() === undefined}
                onClick={() => {
                  const url = ready()?.url;
                  if (!url) return;
                  void navigator.clipboard
                    .writeText(url)
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
        }
      >
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
    </div>
  );
}
