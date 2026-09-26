import QRCode from 'qrcode';
import { createSignal, For, Index, type JSX, onCleanup, Show } from 'solid-js';
import { toast } from 'solid-sonner';

import { Button } from '@/components/Button';
import { Checkbox } from '@/components/Checkbox';
import { ChoiceGroup } from '@/components/ChoiceGroup';
import { FileButton } from '@/components/FileButton';
import { OverlayDialog } from '@/components/OverlayDialog';
import { SelectField } from '@/components/SelectField';
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
  DIARY_FIELD_TYPE_LABEL,
  DIARY_FIELD_TYPES,
  DIARY_FORMAT_VERSION,
  DIARY_TEMPLATES,
  type DiaryField,
  type DiaryFieldType,
  type DiaryInvitation,
  type DiaryResults,
  describeDiaryEntry,
  diaryTemplate,
  MAX_DIARY_FIELDS,
  MAX_DIARY_PLAN_ITEMS,
  parseDiaryInvitation,
} from '@/features/diary/diary-model';
import { diaryPrintHtml } from '@/features/diary/diary-print';
import { decodeQrFromSource } from '@/features/diary/qr-decode';
import { PrintManager } from '@/features/printing/print-manager';
import type { PatientVaultSnapshot } from '@/state/patient-domain';
import { updatePatientVault } from '@/state/patient-vault';
import '@/styles/patient-diary.css';

const MAX_QR_PHOTOS = 40;
const MAX_QR_PHOTO_BYTES = 20 * 1024 * 1024;

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

interface PlanDraft {
  readonly name: string;
  readonly dose: string;
  readonly schedule: string;
}

interface FieldDraft {
  readonly type: DiaryFieldType;
  readonly label: string;
  readonly unit: string;
  readonly options: string;
  readonly required: boolean;
}

const CUSTOM = 'custom';
const EMPTY_PLAN: PlanDraft = { name: '', dose: '', schedule: '' };
const EMPTY_FIELD: FieldDraft = {
  type: 'number',
  label: '',
  unit: '',
  options: '',
  required: false,
};

function slug(label: string, index: number, used: Set<string>): string {
  const base = `f${index + 1}`;
  let id = base;
  let suffix = 1;
  while (used.has(id)) id = `${base}-${suffix++}`;
  used.add(id);
  return label ? id : id;
}

function customFields(drafts: readonly FieldDraft[]): DiaryField[] {
  const used = new Set<string>();
  return drafts
    .filter((draft) => draft.label.trim())
    .map((draft, index) => {
      const options = draft.options
        .split(/[,;\n]/u)
        .map((option) => option.trim())
        .filter(Boolean);
      return {
        id: slug(draft.label, index, used),
        type: draft.type,
        label: draft.label.trim(),
        ...(draft.unit.trim() && (draft.type === 'number' || draft.type === 'count')
          ? { unit: draft.unit.trim() }
          : {}),
        ...(draft.type === 'choice' || draft.type === 'multi' ? { options } : {}),
        ...(draft.type === 'plan' ? { trackDone: true } : {}),
        ...(draft.required ? { required: true } : {}),
      };
    });
}

function IssueDiaryDialog(props: { readonly onClose: () => void }): JSX.Element {
  const [templateId, setTemplateId] = createSignal<string>(DIARY_TEMPLATES[0]?.id ?? CUSTOM);
  const [customTitle, setCustomTitle] = createSignal('');
  const [fields, setFields] = createSignal<readonly FieldDraft[]>([EMPTY_FIELD]);
  const [doctor, setDoctor] = createSignal('');
  const [note, setNote] = createSignal('');
  const [plan, setPlan] = createSignal<readonly PlanDraft[]>([EMPTY_PLAN]);
  const [link, setLink] = createSignal('');
  const [code, setCode] = createSignal('');
  const [error, setError] = createSignal('');

  const template = () => diaryTemplate(templateId());
  const custom = () => templateId() === CUSTOM;
  const hasPlan = () =>
    custom() ? fields().some((field) => field.type === 'plan') : Boolean(template()?.planTitle);

  const updatePlan = (index: number, patch: Partial<PlanDraft>): void => {
    setPlan((current) =>
      current.map((item, position) => (position === index ? { ...item, ...patch } : item)),
    );
  };
  const updateField = (index: number, patch: Partial<FieldDraft>): void => {
    setFields((current) =>
      current.map((item, position) => (position === index ? { ...item, ...patch } : item)),
    );
  };

  const invitation = (): DiaryInvitation => {
    const planItems = hasPlan()
      ? plan()
          .filter((item) => item.name.trim())
          .map((item, index) => ({
            id: `p${index + 1}`,
            name: item.name,
            ...(item.dose.trim() ? { dose: item.dose } : {}),
            ...(item.schedule.trim() ? { schedule: item.schedule } : {}),
          }))
      : [];
    if (!custom() && template()?.planRequired && planItems.length === 0) {
      throw new Error('Добавьте хотя бы один пункт назначения.');
    }
    const base = template();
    return parseDiaryInvitation({
      v: DIARY_FORMAT_VERSION,
      id: createDiaryId(),
      template: custom() ? CUSTOM : templateId(),
      title: custom() ? customTitle() : (base?.title ?? ''),
      issuedAt: new Date().toISOString(),
      fields: custom() ? customFields(fields()) : (base?.fields ?? []),
      ...(planItems.length ? { plan: planItems } : {}),
      ...(hasPlan() ? { planTitle: custom() ? 'Назначение врача' : base?.planTitle } : {}),
      ...(doctor().trim() ? { doctor: doctor() } : {}),
      ...(note().trim() ? { note: note() } : {}),
    });
  };

  const create = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    setError('');
    try {
      const next = await diaryInvitationLink(invitation(), diaryPageUrl());
      setCode(await QRCode.toDataURL(next, { errorCorrectionLevel: 'M', margin: 2, width: 360 }));
      setLink(next);
    } catch (cause) {
      setError(errorMessage(cause, 'Не удалось создать дневник.'));
    }
  };

  const printBlank = (): void => {
    setError('');
    try {
      const current = invitation();
      PrintManager.html(diaryPrintHtml(current, [], 24), current.title);
    } catch (cause) {
      setError(errorMessage(cause, 'Не удалось подготовить бланк.'));
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
      subtitle="Онлайн в браузере пациента или на бумаге"
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
              входит, записи хранятся только у пациента.
            </p>
            <a class="patient-diary__link" href={link()} target="_blank" rel="noreferrer">
              {link()}
            </a>
            <div class="patient-diary__actions">
              <Button onClick={() => void copy()}>Копировать ссылку</Button>
              <Button onClick={printBlank}>Распечатать бланк</Button>
              <Button variant="primary" onClick={props.onClose}>
                Готово
              </Button>
            </div>
          </div>
        }
      >
        <form class="patient-diary__form" onSubmit={(event) => void create(event)}>
          <ChoiceGroup
            legend="Какой дневник"
            name="diary-template"
            value={templateId()}
            options={[
              ...DIARY_TEMPLATES.map((option) => ({
                value: option.id,
                label: option.title,
                hint: option.summary,
              })),
              {
                value: CUSTOM,
                label: 'Свой дневник',
                hint: 'Задайте поля сами: числа, варианты, отметки, текст.',
              },
            ]}
            onChange={setTemplateId}
          />
          <Show when={custom()}>
            <div class="patient-diary__builder">
              <TextField
                label="Название дневника"
                value={customTitle()}
                placeholder="Например: Дневник головной боли"
                onInput={(event) => setCustomTitle(event.currentTarget.value)}
              />
              <Index each={fields()}>
                {(field, index) => (
                  <div class="patient-diary__field-row">
                    <TextField
                      label={`Поле ${index + 1}`}
                      value={field().label}
                      placeholder="Что записывать"
                      onInput={(event) => updateField(index, { label: event.currentTarget.value })}
                    />
                    <SelectField
                      label="Тип"
                      value={field().type}
                      options={DIARY_FIELD_TYPES.map((type) => ({
                        value: type,
                        label: DIARY_FIELD_TYPE_LABEL[type],
                      }))}
                      onChange={(event) =>
                        updateField(index, { type: event.currentTarget.value as DiaryFieldType })
                      }
                    />
                    <Show when={field().type === 'number' || field().type === 'count'}>
                      <TextField
                        label="Единица"
                        value={field().unit}
                        placeholder="например, °C"
                        onInput={(event) => updateField(index, { unit: event.currentTarget.value })}
                      />
                    </Show>
                    <Show when={field().type === 'choice' || field().type === 'multi'}>
                      <TextField
                        label="Варианты через запятую"
                        value={field().options}
                        placeholder="слабая, средняя, сильная"
                        onInput={(event) =>
                          updateField(index, { options: event.currentTarget.value })
                        }
                      />
                    </Show>
                    <div class="patient-diary__field-actions">
                      <Checkbox
                        label="Обязательно"
                        checked={field().required}
                        onChange={(event) =>
                          updateField(index, { required: event.currentTarget.checked })
                        }
                      />
                      <Button
                        type="button"
                        variant="quiet"
                        disabled={fields().length === 1}
                        onClick={() =>
                          setFields((current) =>
                            current.filter((_, position) => position !== index),
                          )
                        }
                      >
                        Убрать
                      </Button>
                    </div>
                  </div>
                )}
              </Index>
              <Button
                type="button"
                variant="quiet"
                disabled={fields().length >= MAX_DIARY_FIELDS}
                onClick={() => setFields((current) => [...current, EMPTY_FIELD])}
              >
                Добавить поле
              </Button>
            </div>
          </Show>
          <Show when={hasPlan()}>
            <div class="patient-diary__medications">
              <Heading depth={3}>
                {custom() ? 'Назначение врача' : (template()?.planTitle ?? 'Назначение врача')}
              </Heading>
              <Show when={!custom() && template()?.planHint}>
                <p class="patient-diary__hint">{template()?.planHint}</p>
              </Show>
              <Index each={plan()}>
                {(item, index) => (
                  <div class="patient-diary__medication">
                    <TextField
                      label="Название"
                      hideLabel
                      placeholder="Название"
                      value={item().name}
                      onInput={(event) => updatePlan(index, { name: event.currentTarget.value })}
                    />
                    <TextField
                      label="Доза или объём"
                      hideLabel
                      placeholder="Доза или объём"
                      value={item().dose}
                      onInput={(event) => updatePlan(index, { dose: event.currentTarget.value })}
                    />
                    <TextField
                      label="Когда"
                      hideLabel
                      placeholder="Когда (например, 8:00 и 20:00, дни 1–5)"
                      value={item().schedule}
                      onInput={(event) =>
                        updatePlan(index, { schedule: event.currentTarget.value })
                      }
                    />
                  </div>
                )}
              </Index>
              <Button
                type="button"
                variant="quiet"
                disabled={plan().length >= MAX_DIARY_PLAN_ITEMS}
                onClick={() => setPlan((current) => [...current, EMPTY_PLAN])}
              >
                Добавить пункт
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
          <div class="patient-diary__actions">
            <Button type="button" onClick={printBlank}>
              Распечатать бланк
            </Button>
            <Button type="submit" variant="primary">
              Создать QR-код
            </Button>
          </div>
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
  const [startingCamera, setStartingCamera] = createSignal(false);
  const [attach, setAttach] = createSignal(Boolean(props.episodeId));
  const [saving, setSaving] = createSignal(false);
  let video: HTMLVideoElement | undefined;
  let stream: MediaStream | undefined;
  let frame: number | undefined;
  let lastScan = 0;
  let disposed = false;

  const stopCamera = (): void => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = undefined;
    if (video) {
      video.pause();
      video.srcObject = null;
    }
    setCameraOn(false);
    setStartingCamera(false);
  };
  onCleanup(() => {
    disposed = true;
    stopCamera();
  });

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
    if (startingCamera() || stream || disposed) return;
    setStatus('');
    setStartingCamera(true);
    try {
      const requestedStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      if (disposed) {
        for (const track of requestedStream.getTracks()) track.stop();
        return;
      }
      stream = requestedStream;
      if (!video) throw new Error('Видео недоступно.');
      video.srcObject = stream;
      await video.play();
      if (disposed || !stream) {
        stopCamera();
        return;
      }
      setCameraOn(true);
      setStartingCamera(false);
      frame = requestAnimationFrame(scanLoop);
    } catch (cause) {
      stopCamera();
      if (!disposed) {
        setStatus(
          `${errorMessage(cause, 'Камера недоступна.')} Можно сфотографировать коды и выбрать фото.`,
        );
      }
    }
  };

  const readPhotos = async (files: FileList | null): Promise<void> => {
    const selected = Array.from(files ?? []);
    if (selected.length > MAX_QR_PHOTOS) {
      setStatus(`Можно выбрать не больше ${MAX_QR_PHOTOS} фото кодов за один раз.`);
      return;
    }
    for (const file of selected) {
      if (!file.type.startsWith('image/')) {
        setStatus(`«${file.name}» не является изображением.`);
        continue;
      }
      if (file.size > MAX_QR_PHOTO_BYTES) {
        setStatus(`Фото «${file.name}» больше 20 МБ. Уменьшите изображение и попробуйте снова.`);
        continue;
      }
      let bitmap: ImageBitmap | undefined;
      try {
        bitmap = await createImageBitmap(file);
        const text = decodeQrFromSource(bitmap, bitmap.width, bitmap.height, canvas);
        if (text) accept(text);
        else setStatus(`На фото «${file.name}» код не найден.`);
      } catch (cause) {
        setStatus(errorMessage(cause, `Не удалось открыть «${file.name}».`));
      } finally {
        bitmap?.close();
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
                  <Button
                    variant="primary"
                    disabled={startingCamera()}
                    onClick={() => void startCamera()}
                  >
                    {startingCamera() ? 'Открываем камеру…' : 'Включить камеру'}
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
            <Heading depth={3}>{current().invitation.title}</Heading>
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
        Давление, приём препаратов, дневник ребёнка, течение болезни или свой дневник. Пациент ведёт
        его в браузере телефона или на распечатанном бланке и на приёме показывает QR-коды.
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
