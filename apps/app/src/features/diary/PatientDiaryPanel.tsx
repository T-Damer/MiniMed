import QRCode from 'qrcode';
import { createSignal, For, Index, type JSX, onCleanup, Show } from 'solid-js';
import { toast } from 'solid-sonner';

import { Button } from '@/components/Button';
import { Checkbox } from '@/components/Checkbox';
import { ChoiceGroup } from '@/components/ChoiceGroup';
import { FileButton } from '@/components/FileButton';
import { OverlayDialog } from '@/components/OverlayDialog';
import { Heading } from '@/components/Text';
import { TextArea } from '@/components/TextArea';
import { TextField } from '@/components/TextField';
import {
  DiaryPartCollector,
  diaryInvitationLink,
  parseDiaryPart,
} from '@/features/diary/diary-codec';
import { applyDiaryImport, diaryImportEvents } from '@/features/diary/diary-import';
import { diaryPageUrl } from '@/features/diary/diary-links';
import {
  createDiaryId,
  DIARY_FORMAT_VERSION,
  DIARY_KIND_TITLE,
  DIARY_KINDS,
  type DiaryKind,
  type DiaryResults,
  describeDiaryEntry,
  parseDiaryInvitation,
} from '@/features/diary/diary-model';
import { decodeQrFromSource } from '@/features/diary/qr-decode';
import type { PatientVaultSnapshot } from '@/state/patient-domain';
import { updatePatientVault } from '@/state/patient-vault';
import '@/styles/patient-diary.css';

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

interface MedicationDraft {
  readonly name: string;
  readonly dose: string;
  readonly schedule: string;
}

function IssueDiaryDialog(props: { readonly onClose: () => void }): JSX.Element {
  const [kind, setKind] = createSignal<DiaryKind>('blood-pressure');
  const [doctor, setDoctor] = createSignal('');
  const [note, setNote] = createSignal('');
  const [medications, setMedications] = createSignal<readonly MedicationDraft[]>([
    { name: '', dose: '', schedule: '' },
  ]);
  const [link, setLink] = createSignal('');
  const [code, setCode] = createSignal('');
  const [error, setError] = createSignal('');

  const updateMedication = (index: number, patch: Partial<MedicationDraft>): void => {
    setMedications((current) =>
      current.map((item, position) => (position === index ? { ...item, ...patch } : item)),
    );
  };

  const create = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    setError('');
    try {
      const drafts = medications().filter((item) => item.name.trim());
      const invitation = parseDiaryInvitation({
        v: DIARY_FORMAT_VERSION,
        id: createDiaryId(),
        kind: kind(),
        issuedAt: new Date().toISOString(),
        ...(doctor().trim() ? { doctor: doctor() } : {}),
        ...(note().trim() ? { note: note() } : {}),
        ...(kind() === 'medication'
          ? {
              medications: drafts.map((item) => ({
                name: item.name,
                ...(item.dose.trim() ? { dose: item.dose } : {}),
                ...(item.schedule.trim() ? { schedule: item.schedule } : {}),
              })),
            }
          : {}),
      });
      const next = await diaryInvitationLink(invitation, diaryPageUrl());
      setCode(await QRCode.toDataURL(next, { errorCorrectionLevel: 'M', margin: 2, width: 360 }));
      setLink(next);
    } catch (cause) {
      setError(errorMessage(cause, 'Не удалось создать дневник.'));
    }
  };

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(link());
      toast.success('Ссылка скопирована.');
    } catch (cause) {
      toast.error(errorMessage(cause, 'Не удалось скопировать ссылку.'));
    }
  };

  return (
    <OverlayDialog
      open
      title="Выдать дневник"
      subtitle="Пациент ведёт записи в своём браузере; сервер не нужен"
      class="patient-diary-dialog"
      onClose={props.onClose}
    >
      <Show
        when={!link()}
        fallback={
          <div class="patient-diary__issued">
            <img class="patient-diary__code" src={code()} alt="QR-код дневника для пациента" />
            <p class="patient-diary__hint">
              Попросите пациента отсканировать код камерой телефона. Имя пациента в ссылку не
              входит.
            </p>
            <a class="patient-diary__link" href={link()} target="_blank" rel="noreferrer">
              {link()}
            </a>
            <div class="patient-diary__actions">
              <Button onClick={() => void copy()}>Копировать ссылку</Button>
              <Button variant="primary" onClick={props.onClose}>
                Готово
              </Button>
            </div>
          </div>
        }
      >
        <form class="patient-diary__form" onSubmit={(event) => void create(event)}>
          <ChoiceGroup
            legend="Что записывает пациент"
            name="diary-kind"
            value={kind()}
            options={DIARY_KINDS.map((option) => ({
              value: option,
              label: DIARY_KIND_TITLE[option],
            }))}
            onChange={(value) => setKind(value as DiaryKind)}
          />
          <Show when={kind() === 'medication'}>
            <div class="patient-diary__medications">
              <Index each={medications()}>
                {(item, index) => (
                  <div class="patient-diary__medication">
                    <TextField
                      label="Препарат"
                      hideLabel
                      placeholder="Препарат"
                      value={item().name}
                      onInput={(event) =>
                        updateMedication(index, { name: event.currentTarget.value })
                      }
                    />
                    <TextField
                      label="Доза"
                      hideLabel
                      placeholder="Доза"
                      value={item().dose}
                      onInput={(event) =>
                        updateMedication(index, { dose: event.currentTarget.value })
                      }
                    />
                    <TextField
                      label="Схема приёма"
                      hideLabel
                      placeholder="Когда (например, 8:00 и 20:00)"
                      value={item().schedule}
                      onInput={(event) =>
                        updateMedication(index, { schedule: event.currentTarget.value })
                      }
                    />
                  </div>
                )}
              </Index>
              <Button
                type="button"
                variant="quiet"
                onClick={() =>
                  setMedications((current) => [...current, { name: '', dose: '', schedule: '' }])
                }
              >
                Добавить препарат
              </Button>
            </div>
          </Show>
          <TextField
            class="patient-diary__field"
            label="Врач (необязательно)"
            value={doctor()}
            onInput={(event) => setDoctor(event.currentTarget.value)}
          />
          <TextArea
            class="patient-diary__field"
            label="Инструкция пациенту"
            maxLength={200}
            value={note()}
            placeholder="Например: утром и вечером, сидя, после 5 минут отдыха"
            onInput={(event) => setNote(event.currentTarget.value)}
          />
          <Show when={error()}>
            <p class="patient-diary__error" role="alert">
              {error()}
            </p>
          </Show>
          <Button type="submit" variant="primary">
            Создать QR-код
          </Button>
        </form>
      </Show>
    </OverlayDialog>
  );
}

function ImportDiaryDialog(props: {
  readonly patientId: string;
  readonly episodeId: string | undefined;
  readonly onSaved: (snapshot: PatientVaultSnapshot) => void;
  readonly onClose: () => void;
}): JSX.Element {
  const collector = new DiaryPartCollector();
  const canvas = document.createElement('canvas');
  const [progress, setProgress] = createSignal({ received: 0, total: 0 });
  const [status, setStatus] = createSignal('');
  const [results, setResults] = createSignal<DiaryResults | null>(null);
  const [cameraOn, setCameraOn] = createSignal(false);
  const [attach, setAttach] = createSignal(Boolean(props.episodeId));
  const [saving, setSaving] = createSignal(false);
  let video: HTMLVideoElement | undefined;
  let stream: MediaStream | undefined;
  let frame: number | undefined;
  let lastScan = 0;

  const stopCamera = (): void => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = undefined;
    setCameraOn(false);
  };
  onCleanup(stopCamera);

  const accept = (text: string): void => {
    if (results()) return;
    if (!collector.add(text)) {
      setStatus(
        parseDiaryPart(text)
          ? 'Этот код от другой передачи. Попросите пациента показать коды заново.'
          : 'Это не код дневника MiniMed.',
      );
      return;
    }
    setProgress({ received: collector.received, total: collector.total });
    setStatus('');
    if (!collector.complete) return;
    stopCamera();
    void collector
      .results()
      .then(setResults)
      .catch((cause: unknown) => {
        collector.reset();
        setProgress({ received: 0, total: 0 });
        setStatus(errorMessage(cause, 'Не удалось прочитать дневник.'));
      });
  };

  const scanLoop = (time: number): void => {
    if (!video || !stream) return;
    if (time - lastScan > 200 && video.readyState >= 2) {
      lastScan = time;
      const text = decodeQrFromSource(video, video.videoWidth, video.videoHeight, canvas);
      if (text) accept(text);
    }
    if (stream) frame = requestAnimationFrame(scanLoop);
  };

  const startCamera = async (): Promise<void> => {
    setStatus('');
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      setCameraOn(true);
      if (!video) throw new Error('Видео недоступно.');
      video.srcObject = stream;
      await video.play();
      frame = requestAnimationFrame(scanLoop);
    } catch (cause) {
      stopCamera();
      setStatus(
        `${errorMessage(cause, 'Камера недоступна.')} Можно сфотографировать коды и выбрать фото.`,
      );
    }
  };

  const readPhotos = async (files: FileList | null): Promise<void> => {
    for (const file of Array.from(files ?? [])) {
      try {
        const bitmap = await createImageBitmap(file);
        const text = decodeQrFromSource(bitmap, bitmap.width, bitmap.height, canvas);
        bitmap.close();
        if (text) accept(text);
        else setStatus(`На фото «${file.name}» код не найден.`);
      } catch (cause) {
        setStatus(errorMessage(cause, `Не удалось открыть «${file.name}».`));
      }
    }
  };

  const save = async (): Promise<void> => {
    const current = results();
    if (!current || saving()) return;
    setSaving(true);
    try {
      const events = diaryImportEvents(
        current,
        props.patientId,
        attach() ? props.episodeId : undefined,
      );
      let outcome = { added: 0, alreadyPresent: 0 };
      const snapshot = await updatePatientVault((vault) => {
        const applied = applyDiaryImport(vault, events);
        outcome = applied;
        return applied.snapshot;
      });
      toast.success(
        outcome.alreadyPresent > 0
          ? `Добавлено записей: ${outcome.added}. Уже были в карте: ${outcome.alreadyPresent}.`
          : `Добавлено записей: ${outcome.added}.`,
      );
      props.onSaved(snapshot);
      props.onClose();
    } catch (cause) {
      setStatus(errorMessage(cause, 'Не удалось сохранить дневник.'));
    } finally {
      setSaving(false);
    }
  };

  const period = (current: DiaryResults): string => {
    const first = current.entries[0]?.at;
    const last = current.entries.at(-1)?.at;
    if (!first || !last) return 'записей нет';
    const format = (value: string) => new Date(value).toLocaleDateString('ru-RU');
    return `${format(first)} — ${format(last)}`;
  };

  return (
    <OverlayDialog
      open
      title="Принять данные дневника"
      subtitle="Отсканируйте все коды с экрана пациента"
      class="patient-diary-dialog"
      onClose={props.onClose}
    >
      <Show
        when={results()}
        fallback={
          <div class="patient-diary__scanner">
            <video
              ref={video}
              class={`patient-diary__video${cameraOn() ? '' : ' patient-diary__video--hidden'}`}
              muted
              playsinline
            />
            <p class="patient-diary__progress" aria-live="polite">
              {progress().total > 0
                ? `Получено кодов: ${progress().received} из ${progress().total}`
                : 'Коды ещё не отсканированы'}
            </p>
            <Show when={status()}>
              <p class="patient-diary__error" role="alert">
                {status()}
              </p>
            </Show>
            <div class="patient-diary__actions">
              <Show
                when={cameraOn()}
                fallback={
                  <Button variant="primary" onClick={() => void startCamera()}>
                    Включить камеру
                  </Button>
                }
              >
                <Button onClick={stopCamera}>Выключить камеру</Button>
              </Show>
              <FileButton
                accept="image/*"
                multiple
                onChange={(event) => void readPhotos(event.currentTarget.files)}
              >
                Выбрать фото кодов
              </FileButton>
            </div>
          </div>
        }
      >
        {(current) => (
          <div class="patient-diary__preview">
            <Heading depth={3}>{DIARY_KIND_TITLE[current().invitation.kind]}</Heading>
            <p class="patient-diary__hint">
              {period(current())} · записей: {current().entries.length}
              {current().invitation.doctor ? ` · врач: ${current().invitation.doctor}` : ''}
            </p>
            <ul class="patient-diary__entries">
              <For each={current().entries.slice(-8).reverse()}>
                {(entry) => (
                  <li class="patient-diary__entry">
                    <span class="patient-diary__entry-time">
                      {new Date(entry.at).toLocaleString('ru-RU', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    {describeDiaryEntry(current().invitation, entry)}
                  </li>
                )}
              </For>
            </ul>
            <p class="patient-diary__hint">
              Записи сохранятся как данные самоконтроля пациента, отдельно от ваших измерений.
            </p>
            <Show when={props.episodeId}>
              <Checkbox
                label="Прикрепить к открытому осмотру"
                checked={attach()}
                onChange={(event) => setAttach(event.currentTarget.checked)}
              />
            </Show>
            <Show when={status()}>
              <p class="patient-diary__error" role="alert">
                {status()}
              </p>
            </Show>
            <div class="patient-diary__actions">
              <Button onClick={props.onClose}>Отмена</Button>
              <Button variant="primary" disabled={saving()} onClick={() => void save()}>
                {saving() ? 'Сохраняем…' : 'Сохранить в карту'}
              </Button>
            </div>
          </div>
        )}
      </Show>
    </OverlayDialog>
  );
}

export function PatientDiaryPanel(props: {
  readonly patientId: string;
  readonly episodeId: string | undefined;
  readonly onSaved: (snapshot: PatientVaultSnapshot) => void;
}): JSX.Element {
  const [dialog, setDialog] = createSignal<'issue' | 'import' | null>(null);
  return (
    <section class="patient-diary paper-card">
      <Heading depth={3}>Дневник самоконтроля</Heading>
      <p class="patient-diary__hint">
        Давление, глюкоза или приём препаратов. Пациент ведёт дневник в браузере телефона и на
        приёме показывает QR-коды.
      </p>
      <div class="patient-diary__actions">
        <Button onClick={() => setDialog('issue')}>Выдать дневник</Button>
        <Button onClick={() => setDialog('import')}>Принять данные</Button>
      </div>
      <Show when={dialog() === 'issue'}>
        <IssueDiaryDialog onClose={() => setDialog(null)} />
      </Show>
      <Show when={dialog() === 'import'}>
        <ImportDiaryDialog
          patientId={props.patientId}
          episodeId={props.episodeId}
          onSaved={props.onSaved}
          onClose={() => setDialog(null)}
        />
      </Show>
    </section>
  );
}
