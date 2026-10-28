import type { DiaryAlert, DiaryPatientDetail, DiaryRole } from '@localmed/contracts';
import { createResource, createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import { OverlayDialog } from '@/components/OverlayDialog';
import { SegmentedControl } from '@/components/SegmentedControl';
import { TextArea } from '@/components/TextArea';
import { TextField } from '@/components/TextField';
import { isDiaryPhone, replicaResults } from '@/features/diary/connected/diary-replica';
import type { DoctorDiaries, DoctorPatient } from '@/features/diary/connected/doctor-workspace';
import {
  type AlertCause,
  alertCause,
  questionnaireSeries,
} from '@/features/diary/dashboard/diary-insights';
import { frequentDrugs } from '@/features/diary/dashboard/frequent-drugs';
import { PatientIdentity } from '@/features/diary/dashboard/PatientIdentity';
import { telHref } from '@/features/diary/dashboard/patient-contact';
import { CARE_DOSE_FIELD, dayKey } from '@/features/diary/diary-care';
import { type CareDraft, careDraftFrom, careInvitation } from '@/features/diary/diary-care-draft';
import {
  type DiaryEntry,
  type DiaryInvitation,
  type DiaryPlanValue,
  type DiaryTip,
  parseDiaryEntry,
} from '@/features/diary/diary-model';
import { PatientScreenEditor } from '@/features/diary/PatientScreenEditor';

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

const ROLE_LABEL: Readonly<Record<DiaryRole, string>> = {
  owner: 'Владелец',
  editor: 'Изменение',
  reader: 'Чтение',
};

/**
 * Curators of one patient: names, access level (read / edit), pending invitations, removal and
 * hand-over. Only the owner changes anything; a removal rotates the patient's key.
 */
export function CuratorsDialog(props: {
  readonly workspace: DoctorDiaries;
  readonly patient: DoctorPatient;
  readonly onClose: () => void;
}): JSX.Element {
  const id = () => props.patient.summary.id;
  const owner = () => props.patient.summary.role === 'owner';
  const [detail, { refetch }] = createResource(() => props.workspace.detail(id()));
  const [email, setEmail] = createSignal('');
  const [role, setRole] = createSignal<'editor' | 'reader'>('reader');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');

  const run = async (action: () => Promise<unknown>, fallback: string): Promise<void> => {
    setError('');
    setBusy(true);
    try {
      await action();
      await refetch();
    } catch (cause) {
      setError(errorText(cause, fallback));
    } finally {
      setBusy(false);
    }
  };

  const devices = (current: DiaryPatientDetail) => current.devices;

  return (
    <OverlayDialog
      open
      title="Кураторы"
      subtitle="Кто видит дневник и что может менять"
      onClose={props.onClose}
    >
      <div class="diary-curators">
        <Show when={detail()} fallback={<p class="diary-dash__quiet">Загружаем…</p>}>
          {(current) => (
            <>
              <ul class="diary-curators__list">
                <For each={current().members}>
                  {(member) => (
                    <li class="diary-curator">
                      <span class="diary-curator__avatar" aria-hidden="true">
                        {member.doctor.name.slice(0, 1)}
                      </span>
                      <span class="diary-curator__text">
                        <span class="diary-curator__name">
                          {member.doctor.name}
                          {member.doctor.id === props.workspace.doctorId ? ' (вы)' : ''}
                        </span>
                        <span class="diary-curator__meta">
                          {member.doctor.email}
                          {member.status === 'pending' ? ' · ждёт принятия' : ''}
                        </span>
                      </span>
                      <Show
                        when={owner() && member.role !== 'owner'}
                        fallback={
                          <span class="diary-curator__role">{ROLE_LABEL[member.role]}</span>
                        }
                      >
                        <SegmentedControl
                          label={`Доступ: ${member.doctor.name}`}
                          value={member.role === 'editor' ? 'editor' : 'reader'}
                          options={[
                            { value: 'reader', label: 'Чтение' },
                            { value: 'editor', label: 'Изменение' },
                          ]}
                          onChange={(next) =>
                            void run(
                              () => props.workspace.setRole(id(), member.doctor.id, next),
                              'Не удалось изменить доступ.',
                            )
                          }
                        />
                        <Button
                          variant="icon"
                          aria-label={`Передать пациента: ${member.doctor.name}`}
                          icon={<AppGlyph name="arrow-u-up-right" class="diary-dash__glyph" />}
                          disabled={busy() || member.status !== 'active'}
                          onClick={() =>
                            void run(
                              () => props.workspace.transfer(id(), member.doctor.id),
                              'Не удалось передать пациента.',
                            )
                          }
                        />
                        <Button
                          variant="icon"
                          aria-label={`Убрать куратора: ${member.doctor.name}`}
                          icon={<AppGlyph name="trash" class="diary-dash__glyph" />}
                          disabled={busy()}
                          onClick={() =>
                            void run(
                              () => props.workspace.removeMember(id(), member.doctor.id),
                              'Не удалось убрать куратора.',
                            )
                          }
                        />
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
              <Show when={owner()}>
                <form
                  class="diary-curators__invite"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(async () => {
                      await props.workspace.invite(id(), email(), role());
                      setEmail('');
                    }, 'Не удалось пригласить.');
                  }}
                >
                  <TextField
                    label="Добавить куратора по почте"
                    type="email"
                    placeholder="colleague@clinic.ru"
                    value={email()}
                    onInput={(event) => setEmail(event.currentTarget.value)}
                  />
                  <SegmentedControl
                    label="Доступ"
                    value={role()}
                    options={[
                      { value: 'reader', label: 'Чтение' },
                      { value: 'editor', label: 'Изменение' },
                    ]}
                    onChange={setRole}
                  />
                  <Button type="submit" variant="primary" disabled={busy() || !email().trim()}>
                    Пригласить
                  </Button>
                </form>
              </Show>
              <h3 class="diary-curators__heading">Телефоны пациента</h3>
              <Show
                when={devices(current()).length}
                fallback={<p class="diary-dash__quiet">Телефон ещё не подключён.</p>}
              >
                <ul class="diary-curators__list">
                  <For each={devices(current())}>
                    {(device) => (
                      <li class="diary-curator">
                        <span class="diary-curator__avatar" aria-hidden="true">
                          <AppGlyph name="phone" class="diary-dash__glyph" />
                        </span>
                        <span class="diary-curator__text">
                          <span class="diary-curator__name">Телефон</span>
                          <span class="diary-curator__meta">
                            подключён {new Date(device.createdAt).toLocaleDateString('ru-RU')}
                            {device.lastSeenAt
                              ? ` · был в сети ${new Date(device.lastSeenAt).toLocaleString('ru-RU')}`
                              : ''}
                          </span>
                        </span>
                        <Show when={props.patient.summary.role !== 'reader'}>
                          <Button
                            variant="icon"
                            aria-label="Отключить этот телефон"
                            icon={<AppGlyph name="trash" class="diary-dash__glyph" />}
                            disabled={busy()}
                            onClick={() =>
                              void run(
                                () => props.workspace.revokeDevice(id(), device.id),
                                'Не удалось отключить телефон.',
                              )
                            }
                          />
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </>
          )}
        </Show>
        <Show when={error() || detail.error}>
          <p class="diary-dash__error" role="alert">
            {error() || errorText(detail.error, 'Не удалось загрузить.')}
          </p>
        </Show>
        <Show when={props.patient.summary.role !== 'owner'}>
          <Button
            variant="quiet"
            onClick={() =>
              void run(async () => {
                await props.workspace.removeMember(id(), props.workspace.doctorId);
                props.onClose();
              }, 'Не удалось выйти.')
            }
          >
            Перестать курировать
          </Button>
        </Show>
      </div>
    </OverlayDialog>
  );
}

/**
 * Tips on what the patient fills: a medicine or a checkpoint. The patient sees a «?» on that row
 * until opened; here the doctor sees whether it was read.
 */
export function TipsDialog(props: {
  readonly workspace: DoctorDiaries;
  readonly patient: DoctorPatient;
  readonly invitation: DiaryInvitation;
  readonly onClose: () => void;
}): JSX.Element {
  const targets = [
    ...(props.invitation.plan ?? [])
      .filter((item) => !item.ended)
      .map((item) => ({ id: item.id, label: [item.name, item.dose].filter(Boolean).join(' ') })),
    ...(props.invitation.checkpoints ?? [])
      .filter((checkpoint) => !checkpoint.ended)
      .map((checkpoint) => ({ id: checkpoint.id, label: checkpoint.label })),
  ];
  const existing = new Map((props.invitation.tips ?? []).map((tip) => [tip.target, tip]));
  const [texts, setTexts] = createSignal<Record<string, string>>(
    Object.fromEntries(targets.map((target) => [target.id, existing.get(target.id)?.text ?? ''])),
  );
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');

  const save = async (): Promise<void> => {
    setError('');
    setBusy(true);
    try {
      const tips: DiaryTip[] = targets.flatMap((target) => {
        const text = (texts()[target.id] ?? '').trim();
        if (!text) return [];
        const previous = existing.get(target.id);
        // A changed text is a new tip, so the patient sees the «?» again.
        const id =
          previous && previous.text === text
            ? previous.id
            : `t-${target.id}-${Date.now().toString(36)}`.slice(0, 24);
        return [{ id, target: target.id, text }];
      });
      const invitation: DiaryInvitation = {
        ...props.invitation,
        issuedAt: new Date(
          Math.max(Date.now(), Date.parse(props.invitation.issuedAt) + 1000),
        ).toISOString(),
        tips,
      };
      if (!tips.length) delete (invitation as { tips?: unknown }).tips;
      await props.workspace.writePlan(props.patient.summary.id, invitation);
      props.onClose();
    } catch (cause) {
      setError(errorText(cause, 'Не удалось сохранить подсказки.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <OverlayDialog
      open
      title="Подсказки пациенту"
      subtitle="Видны как «?» у строки"
      class="diary-dash-dialog"
      onClose={props.onClose}
    >
      <div class="diary-dash-form">
        <For each={targets}>
          {(target) => {
            const tip = existing.get(target.id);
            return (
              <TextArea
                label={`${target.label}${tip ? (props.patient.replica.tipsRead.has(tip.id) ? ' · прочитано' : ' · не прочитано') : ''}`}
                maxLength={4000}
                value={texts()[target.id] ?? ''}
                placeholder="Например: принимать после еды, запивать водой"
                onInput={(event) => {
                  const value = event.currentTarget.value;
                  setTexts((current) => ({ ...current, [target.id]: value }));
                }}
              />
            );
          }}
        </For>
        <Show when={error()}>
          <p class="diary-dash__error" role="alert">
            {error()}
          </p>
        </Show>
        <Button variant="primary" disabled={busy()} onClick={() => void save()}>
          Сохранить подсказки
        </Button>
      </div>
    </OverlayDialog>
  );
}

/**
 * A doctor's correction of one entry: numbers, intake taken or skipped, the comment. Saved as a new
 * revision signed by the doctor; the patient's original stays in the history and is marked.
 */
export function CorrectEntryDialog(props: {
  readonly workspace: DoctorDiaries;
  readonly patient: DoctorPatient;
  readonly invitation: DiaryInvitation;
  readonly entry: DiaryEntry;
  readonly onClose: () => void;
}): JSX.Element {
  const numeric = props.invitation.fields.filter(
    (field) => field.type === 'number' && typeof props.entry.values[field.id] === 'number',
  );
  const plan = props.entry.values[CARE_DOSE_FIELD] as DiaryPlanValue | undefined;
  const [numbers, setNumbers] = createSignal<Record<string, string>>(
    Object.fromEntries(numeric.map((field) => [field.id, String(props.entry.values[field.id])])),
  );
  const [taken, setTaken] = createSignal(plan?.done !== false);
  const [note, setNote] = createSignal(props.entry.note ?? '');
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [confirming, setConfirming] = createSignal(false);

  const save = async (remove: boolean): Promise<void> => {
    setError('');
    setBusy(true);
    try {
      if (remove) {
        await props.workspace.deleteEntry(props.patient.summary.id, props.entry.id);
      } else {
        const values: Record<string, unknown> = { ...props.entry.values };
        for (const field of numeric)
          values[field.id] = Number((numbers()[field.id] ?? '').replace(',', '.'));
        if (plan) values[CARE_DOSE_FIELD] = { ...plan, done: taken() };
        const entry = parseDiaryEntry(props.invitation, {
          ...props.entry,
          values,
          ...(note().trim() ? { note: note() } : { note: undefined }),
        });
        await props.workspace.correctEntry(props.patient.summary.id, entry);
      }
      props.onClose();
    } catch (cause) {
      setError(errorText(cause, 'Не удалось сохранить исправление.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <OverlayDialog
      open
      title="Исправить запись"
      subtitle={new Date(props.entry.at).toLocaleString('ru-RU')}
      onClose={props.onClose}
    >
      <div class="diary-dash-form">
        <Show when={plan}>
          <SegmentedControl
            label="Приём"
            stretch
            value={taken() ? 'taken' : 'skipped'}
            options={[
              { value: 'taken', label: 'Принято' },
              { value: 'skipped', label: 'Пропущено' },
            ]}
            onChange={(next) => setTaken(next === 'taken')}
          />
        </Show>
        <For each={numeric}>
          {(field) => (
            <TextField
              label={`${field.label}${field.unit ? `, ${field.unit}` : ''}`}
              inputmode="decimal"
              value={numbers()[field.id] ?? ''}
              onInput={(event) => {
                const value = event.currentTarget.value;
                setNumbers((current) => ({ ...current, [field.id]: value }));
              }}
            />
          )}
        </For>
        <TextArea
          label="Комментарий"
          maxLength={4000}
          value={note()}
          onInput={(event) => setNote(event.currentTarget.value)}
        />
        <Show when={error()}>
          <p class="diary-dash__error" role="alert">
            {error()}
          </p>
        </Show>
        <div class="diary-dash-form__actions">
          <Button variant="quiet" disabled={busy()} onClick={() => setConfirming(true)}>
            Удалить запись
          </Button>
          <ConfirmationDialog
            open={confirming()}
            title="Удалить запись?"
            description={<p>Запись исчезнет у пациента и у кураторов.</p>}
            confirmLabel="Удалить"
            danger
            onConfirm={() => {
              setConfirming(false);
              void save(true);
            }}
            onOpenChange={setConfirming}
          />
          <Button variant="primary" disabled={busy()} onClick={() => void save(false)}>
            Сохранить исправление
          </Button>
        </div>
      </div>
    </OverlayDialog>
  );
}

function when(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** A questionnaire result with its schema alerts: score, band and what each alert asks for. */
export function AlertNotices(props: { readonly cause: AlertCause }): JSX.Element {
  return (
    <>
      <p class="diary-alert__score">
        <span class="diary-alert__quiz">{props.cause.title}</span>
        <span class="diary-alert__total">
          {props.cause.point.total} из {props.cause.point.max}
        </span>
        <span class="diary-alert__headline">{props.cause.point.headline}</span>
      </p>
      <ul class="diary-alert__list">
        <For each={props.cause.point.alertDetails}>
          {(detail) => (
            <li class="diary-alert__item">
              <span class="diary-alert__title">{detail.title}</span>
              <span class="diary-alert__message">{detail.message}</span>
            </li>
          )}
        </For>
      </ul>
      <p class="diary-dash__quiet">Ответ дан {when(props.cause.point.at)}.</p>
    </>
  );
}

/**
 * What an alert is about. The server only knows that and when it was raised; the answers that
 * raised it are found and scored here, on the doctor's device, with the questionnaire's own alert
 * notices. Call, open the day, or mark it seen.
 */
export function AlertDialog(props: {
  readonly workspace: DoctorDiaries;
  readonly alert: DiaryAlert;
  readonly onOpenDay: (day: string) => void;
  readonly onClose: () => void;
}): JSX.Element {
  const patient = () => props.workspace.patient(props.alert.patientId);
  const name = () =>
    `${patient()?.replica.profile?.emoji ?? ''} ${patient()?.replica.profile?.label ?? 'Пациент'}`.trim();
  const phone = () => patient()?.replica.profile?.phone;
  const [cause] = createResource(
    () => (props.alert.kind === 'urgent' ? patient() : undefined),
    async (current) => {
      const results = replicaResults(current.replica);
      if (!results) return null;
      const series = await questionnaireSeries(results.invitation, results.entries);
      return alertCause(series, props.alert.at) ?? null;
    },
  );
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const seen = (): void => {
    setBusy(true);
    props.workspace
      .ackAlert(props.alert.id)
      .then(() => props.onClose())
      .catch((cause: unknown) => setError(errorText(cause, 'Не удалось отметить.')))
      .finally(() => setBusy(false));
  };

  return (
    <OverlayDialog
      open
      title={props.alert.kind === 'withdrawn' ? 'Согласие отозвано' : 'Срочная отметка'}
      subtitle={`${name()} · ${when(props.alert.at)}`}
      class="diary-dash-dialog"
      onClose={props.onClose}
    >
      <div class="diary-alert">
        <Show
          when={props.alert.kind === 'urgent'}
          fallback={
            <p class="diary-alert__text">
              Пациент отозвал согласие: его записи удалены с сервера, новые не приходят.
            </p>
          }
        >
          <Show
            when={!cause.loading}
            fallback={<p class="diary-dash__quiet">Расшифровываем ответы…</p>}
          >
            <Show
              when={cause()}
              fallback={
                <p class="diary-alert__text">
                  Ответа, поднявшего отметку, на этом устройстве нет — он мог быть удалён или
                  исправлен.
                </p>
              }
            >
              {(found) => <AlertNotices cause={found()} />}
            </Show>
          </Show>
        </Show>
        <Show when={error()}>
          <p class="diary-dash__error" role="alert">
            {error()}
          </p>
        </Show>
        <div class="diary-alert__actions">
          <Show when={phone()}>
            {(number) => (
              <a class="ui-button ui-button--secondary diary-alert__call" href={telHref(number())}>
                <AppGlyph name="phone" class="diary-dash__glyph" />
                Позвонить
              </a>
            )}
          </Show>
          <Show when={props.alert.kind === 'urgent'}>
            <Button
              type="button"
              icon={<AppGlyph name="calendar" class="diary-dash__glyph" />}
              onClick={() => props.onOpenDay(dayKey(cause()?.point.at ?? props.alert.at))}
            >
              Открыть день
            </Button>
          </Show>
          <Button type="button" variant="primary" disabled={busy()} onClick={seen}>
            Просмотрено
          </Button>
        </div>
      </div>
    </OverlayDialog>
  );
}
