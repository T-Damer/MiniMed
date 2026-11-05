import { createSignal, For, type JSX, Show } from 'solid-js';

import { Button } from '@/components/Button';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import { ActionRow, StateRow } from '@/diary/DiaryMore';
import { DiarySheet } from '@/diary/DiarySheet';
import '@/diary/carer.css';
import { carerLabel, type DiaryPhone, MAX_CARER_NAME } from '@/features/diary/connected/carer';
import type { PatientConnection } from '@/features/diary/connected/patient-connection';

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

function since(at: string): string {
  return `с ${new Date(at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`;
}

/**
 * The carer names their phone (DIARY25): the patient and the doctor see the name next to the
 * carer's marks. Asked once after pairing; changed later from «Настройки».
 */
export function CarerNameSheet(props: {
  readonly name: string;
  readonly onSave: (name: string) => Promise<unknown>;
  readonly onClose: () => void;
}): JSX.Element {
  const [value, setValue] = createSignal(props.name);
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const save = (): void => {
    if (!value().trim()) {
      setError('Напишите, как вас зовут.');
      return;
    }
    setBusy(true);
    props
      .onSave(value())
      .then(props.onClose)
      .catch((cause: unknown) => setError(errorText(cause, 'Не удалось сохранить имя.')))
      .finally(() => setBusy(false));
  };
  return (
    <DiarySheet
      title="Как вас зовут?"
      subtitle="Пациент и врач увидят это имя рядом с вашими отметками"
      onClose={props.onClose}
    >
      <form
        class="diary-carer-name"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <label class="diary-carer-name__field">
          <span class="diary-carer-name__label">Имя и кем приходитесь пациенту</span>
          <input
            class="diary-carer-name__input"
            value={value()}
            maxLength={MAX_CARER_NAME}
            placeholder="Например: Ирина, мама"
            autocomplete="name"
            enterkeyhint="done"
            aria-invalid={Boolean(error())}
            onInput={(event) => {
              setValue(event.currentTarget.value);
              setError('');
            }}
          />
        </label>
        <Show when={error()}>
          <p class="diary-error" role="alert">
            {error()}
          </p>
        </Show>
        <Button class="diary-button" type="submit" variant="primary" disabled={busy()}>
          Сохранить
        </Button>
      </form>
    </DiarySheet>
  );
}

/**
 * «Доступ к дневнику» in the diary's «Настройки» (DIARY25): the doctors and every phone with access.
 * On the patient's phone a carer can be removed (the diary then gets a new key); on a carer's
 * phone the carer changes their name or leaves. `revision` changes whenever a sync may have read
 * the list again.
 */
export function DiaryAccess(props: {
  readonly connection: PatientConnection;
  readonly revision: number;
  readonly onChanged: () => void;
  readonly onLeft: () => void;
}): JSX.Element {
  const carer = (): boolean => props.connection.kind === 'carer';
  const phones = (): DiaryPhone[] => {
    void props.revision;
    return props.connection.phones();
  };
  const doctors = () => {
    void props.revision;
    return props.connection.doctors().filter((member) => member.status === 'active');
  };
  const [removing, setRemoving] = createSignal<DiaryPhone | undefined>();
  const [leaving, setLeaving] = createSignal(false);
  const [naming, setNaming] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');

  const act = (action: () => Promise<void>, fallback: string, after: () => void): void => {
    setError('');
    setBusy(true);
    action()
      .then(after)
      .catch((cause: unknown) => setError(errorText(cause, fallback)))
      .finally(() => setBusy(false));
  };

  const phoneTitle = (phone: DiaryPhone): string => {
    if (phone.kind === 'carer') {
      const label = carerLabel(phone.name);
      return label.charAt(0).toUpperCase() + label.slice(1);
    }
    return phone.self ? 'Этот девайс' : 'Девайс пациента';
  };
  const phoneStatus = (phone: DiaryPhone): string =>
    phone.self ? 'вы' : phone.kind === 'carer' ? since(phone.createdAt) : 'пациент';

  return (
    <section class="diary-settings__section" aria-label="Доступ к дневнику">
      <h2 class="diary-carer-access__title">Доступ к дневнику</h2>
      <ul class="settings-list__group" data-testid="diary-access">
        <For each={doctors()}>
          {(member, index) => (
            <StateRow
              icon="users"
              tone="blue"
              title={member.doctor.name}
              status="врач"
              divided={index() > 0}
            />
          )}
        </For>
        <For each={phones()}>
          {(phone, index) => (
            <Show
              when={!carer() && phone.kind === 'carer'}
              fallback={
                <StateRow
                  icon={phone.kind === 'carer' ? 'users' : 'device-mobile'}
                  tone={phone.kind === 'carer' ? 'purple' : 'green'}
                  title={phoneTitle(phone)}
                  status={phoneStatus(phone)}
                  divided={doctors().length + index() > 0}
                />
              }
            >
              <ActionRow
                icon="users"
                tone="purple"
                title={phoneTitle(phone)}
                status="отключить"
                divided={doctors().length + index() > 0}
                onClick={() => {
                  setError('');
                  setRemoving(phone);
                }}
              />
            </Show>
          )}
        </For>
        <Show when={carer()}>
          <ActionRow
            icon="edit"
            tone="gray"
            title="Ваше имя"
            status={props.connection.name || 'не указано'}
            divided
            onClick={() => setNaming(true)}
          />
          <ActionRow
            icon="trash"
            tone="pink"
            title="Выйти из дневника"
            danger
            divided
            onClick={() => {
              setError('');
              setLeaving(true);
            }}
          />
        </Show>
      </ul>
      <p class="diary-settings__note">
        {carer()
          ? 'Вы опекун: видите дневник пациента и можете отмечать приёмы. Если приём не отмечен через 30 минут, придёт уведомление (включите уведомления выше).'
          : 'Опекуна добавляет врач с вашего согласия. Отключить его можно здесь в любой момент: дневник сразу получит новый ключ шифрования.'}
      </p>
      <Show when={error()}>
        <p class="diary-error" role="alert">
          {error()}
        </p>
      </Show>
      <ConfirmationDialog
        open={removing() !== undefined}
        title="Отключить опекуна?"
        description={
          <p>
            {phoneTitle(removing() ?? (phones()[0] as DiaryPhone))} больше не увидит дневник и не
            узнает о пропущенных приёмах. Его прежние отметки останутся.
          </p>
        }
        confirmLabel="Отключить"
        danger
        onConfirm={() => {
          const phone = removing();
          setRemoving(undefined);
          if (!phone || busy()) return;
          act(
            () => props.connection.removeCarer(phone.id),
            'Не удалось отключить опекуна.',
            props.onChanged,
          );
        }}
        onOpenChange={(open) => {
          if (!open) setRemoving(undefined);
        }}
      />
      <ConfirmationDialog
        open={leaving()}
        title="Выйти из дневника?"
        description={
          <p>
            Дневник пациента удалится с этого телефона, уведомления о пропусках приходить не будут.
            Чтобы вернуться, понадобится новая ссылка от врача.
          </p>
        }
        confirmLabel="Выйти"
        danger
        onConfirm={() => {
          setLeaving(false);
          act(() => props.connection.leave(), 'Не удалось выйти из дневника.', props.onLeft);
        }}
        onOpenChange={setLeaving}
      />
      <Show when={naming()}>
        <CarerNameSheet
          name={props.connection.name}
          onSave={async (name) => {
            await props.connection.setName(name);
            props.onChanged();
          }}
          onClose={() => setNaming(false)}
        />
      </Show>
    </section>
  );
}
