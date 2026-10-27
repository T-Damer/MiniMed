import QRCode from 'qrcode';
import { createResource, type JSX, Show } from 'solid-js';
import { toast } from 'solid-sonner';

import { Button } from '@/components/Button';
import type { DoctorDiaries } from '@/features/diary/connected/doctor-workspace';

/**
 * The one-time code that connects the patient's phone. It works once and for 72 hours; a photo of
 * it taken later opens nothing.
 */
export function PairingView(props: {
  readonly workspace: DoctorDiaries;
  readonly patientId: string;
  readonly onDone: () => void;
}): JSX.Element {
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
      <Show when={link()} fallback={<p class="diary-dash__quiet">Готовим код…</p>}>
        {(ready) => (
          <>
            <img class="diary-pair__code" src={ready().image} alt="Код для телефона пациента" />
            <p class="diary-pair__hint">
              Пациент сканирует код камерой телефона, проходит согласия и добавляет дневник на экран
              «Домой». Код одноразовый, действует 72 часа.
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
