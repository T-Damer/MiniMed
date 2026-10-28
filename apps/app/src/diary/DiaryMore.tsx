import { createSignal, type JSX, Show } from 'solid-js';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import { Switch } from '@/components/Switch';
import { DiarySheet } from '@/diary/DiarySheet';
import { ScreenHeader } from '@/diary/diary-ui';
import { InstallWarning } from '@/diary/InstallWarning';
import { PasteLinkCard } from '@/diary/PasteLinkCard';
import { RestoreCard } from '@/diary/RestoreCard';
import type { DiaryOpenResult, DiaryStore } from '@/features/diary/diary-storage';
import type { SettingsTileTone } from '@/features/settings/settings-pages';
import {
  getSoundsEnabled,
  getVibrationEnabled,
  setSoundsEnabled,
  setVibrationEnabled,
} from '@/state/app-preferences';

type PushState = 'off' | 'on' | 'unsupported' | 'denied';

function Tile(props: { readonly icon: AppGlyphName; readonly tone: SettingsTileTone }) {
  return (
    <span class={`settings-tile settings-tile--${props.tone}`}>
      <AppGlyph name={props.icon} class="settings-tile__glyph" />
    </span>
  );
}

/** A row that opens something: the main Settings list's row with tile, title, state and chevron. */
function ActionRow(props: {
  readonly icon: AppGlyphName;
  readonly tone: SettingsTileTone;
  readonly title: string;
  readonly status?: string | undefined;
  readonly divided?: boolean;
  readonly danger?: boolean;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <li class="settings-list__item">
      <button
        type="button"
        class="settings-list__row settings-list__row--action"
        classList={{
          'settings-list__row--divided': Boolean(props.divided),
          'diary-settings__row--danger': Boolean(props.danger),
        }}
        onClick={() => props.onClick()}
      >
        <Tile icon={props.icon} tone={props.tone} />
        <span class="settings-list__title">{props.title}</span>
        <Show when={props.status}>
          <span class="settings-list__status diary-settings__status">{props.status}</span>
        </Show>
        <AppGlyph name="caret-right" class="settings-list__chevron" aria-hidden="true" />
      </button>
    </li>
  );
}

/** A row with a switch on the right. */
function SwitchRow(props: {
  readonly icon: AppGlyphName;
  readonly tone: SettingsTileTone;
  readonly title: string;
  readonly checked: boolean;
  readonly divided?: boolean;
  readonly onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <li class="settings-list__item">
      <div
        class="settings-list__row"
        classList={{ 'settings-list__row--divided': Boolean(props.divided) }}
      >
        <Tile icon={props.icon} tone={props.tone} />
        <span class="settings-list__title">{props.title}</span>
        <Switch
          class="diary-settings__switch"
          checked={props.checked}
          aria-label={props.title}
          onChange={props.onChange}
        />
      </div>
    </li>
  );
}

/** A row that only states something (notifications already on). */
function StateRow(props: {
  readonly icon: AppGlyphName;
  readonly tone: SettingsTileTone;
  readonly title: string;
  readonly status: string;
}): JSX.Element {
  return (
    <li class="settings-list__item">
      <div class="settings-list__row">
        <Tile icon={props.icon} tone={props.tone} />
        <span class="settings-list__title">{props.title}</span>
        <span class="settings-list__status diary-settings__status">{props.status}</span>
      </div>
    </li>
  );
}

/** How the diary works, behind the header «?»: connected diaries send by themselves. */
function DiaryHelp(props: { readonly connected: boolean }): JSX.Element {
  return (
    <Show
      when={props.connected}
      fallback={
        <ol class="diary-settings__help-steps">
          <li class="diary-settings__help-step">
            «Сегодня»: отмечайте приём лекарств и самочувствие. Время записи ставится само.
          </li>
          <li class="diary-settings__help-step">
            «Записи»: всё, что вы отметили. Ошибку можно исправить или удалить.
          </li>
          <li class="diary-settings__help-step">
            «Врачу»: перед визитом отправьте записи. Дневник запомнит, что уже у врача.
          </li>
          <li class="diary-settings__help-step">
            Записи хранятся только в этом браузере: не очищайте данные сайта до визита.
          </li>
        </ol>
      }
    >
      <ol class="diary-settings__help-steps">
        <li class="diary-settings__help-step">
          «Сегодня»: отмечайте приём лекарств и самочувствие. Время записи ставится само.
        </li>
        <li class="diary-settings__help-step">
          Отметки уходят врачу сами, зашифрованными, когда есть интернет. Без сети дневник работает
          и отправит всё позже.
        </li>
        <li class="diary-settings__help-step">
          «Записи»: всё, что вы отметили. Ошибку можно исправить или удалить.
        </li>
      </ol>
    </Show>
  );
}

/**
 * The patient's «Настройки» (owner 2026-10-28: as in the main app): inset groups of rows with a
 * coloured tile — notifications and reminders, sounds, the diary's files and copies, consent.
 * Explanations are behind the header «?»; cards that need room open in a sheet.
 */
export function DiaryMore(props: {
  readonly store: DiaryStore;
  readonly entries: number;
  /** Opened from the tab bar: no back arrow. */
  readonly onBack?: (() => void) | undefined;
  readonly onPrint: () => void;
  readonly onFhir: () => void;
  readonly onRestored: (diaryId: string) => void;
  readonly onOpened: (opened: DiaryOpenResult) => void;
  readonly onList: () => void;
  /** The phone keeps more than this diary: «Мои дневники» is worth a row. */
  readonly hasOtherDiaries?: boolean;
  /** Connected diary: stop the observation and delete the records on the server. */
  readonly onWithdraw?: (() => Promise<void>) | undefined;
  /** Connected diary: notifications when the doctor changes something. */
  readonly onEnablePush?: (() => Promise<'on' | 'unsupported' | 'denied'>) | undefined;
  /** Notifications were allowed on an earlier visit. */
  readonly pushOn?: boolean;
  /** Connected diary: dose and checkpoint reminders, and whether they name the medicines. */
  readonly reminders?: { readonly on: boolean; readonly names: boolean } | undefined;
  readonly onReminders?:
    | ((patch: { readonly on?: boolean; readonly names?: boolean }) => void)
    | undefined;
}): JSX.Element {
  const [push, setPush] = createSignal<PushState>(props.pushOn ? 'on' : 'off');
  const [sounds, setSounds] = createSignal(getSoundsEnabled());
  const [vibration, setVibration] = createSignal(getVibrationEnabled());
  const [confirming, setConfirming] = createSignal(false);
  const [withdrawError, setWithdrawError] = createSignal('');
  const [sheet, setSheet] = createSignal<'restore' | 'link' | undefined>();
  const connected = (): boolean => Boolean(props.onWithdraw);

  return (
    <main class="diary-page diary-page--more diary-settings">
      <ScreenHeader
        title="Настройки"
        onBack={props.onBack}
        help={<DiaryHelp connected={connected()} />}
        helpTitle="Как пользоваться дневником"
      />
      <InstallWarning store={props.store} entries={props.entries} />

      <Show when={props.onEnablePush}>
        {(enable) => (
          <section class="diary-settings__section" aria-label="Уведомления">
            <ul class="settings-list__group">
              <Show
                when={push() !== 'on'}
                fallback={
                  <StateRow icon="bell" tone="orange" title="Уведомления" status="включены" />
                }
              >
                <ActionRow
                  icon="bell"
                  tone="orange"
                  title="Включить уведомления"
                  status={
                    push() === 'unsupported'
                      ? 'недоступны'
                      : push() === 'denied'
                        ? 'запрещены'
                        : undefined
                  }
                  onClick={() => {
                    void enable()().then(setPush, () => setPush('unsupported'));
                  }}
                />
              </Show>
              <Show when={push() === 'on' && props.reminders}>
                {(reminders) => (
                  <>
                    <SwitchRow
                      icon="clock"
                      tone="green"
                      title="Напоминать о приёме"
                      checked={reminders().on}
                      divided
                      onChange={(on) => props.onReminders?.({ on })}
                    />
                    <Show when={reminders().on}>
                      <SwitchRow
                        icon="pill"
                        tone="teal"
                        title="Названия лекарств"
                        checked={reminders().names}
                        divided
                        onChange={(names) => props.onReminders?.({ names })}
                      />
                    </Show>
                  </>
                )}
              </Show>
            </ul>
            <Show when={push() === 'unsupported' || push() === 'denied'}>
              <p class="diary-settings__note">
                {push() === 'denied'
                  ? 'Уведомления запрещены в настройках телефона для этого сайта.'
                  : 'На iPhone уведомления приходят, когда дневник добавлен на экран «Домой».'}
              </p>
            </Show>
          </section>
        )}
      </Show>

      <section class="diary-settings__section" aria-label="Звуки и вибрация">
        <ul class="settings-list__group">
          <SwitchRow
            icon="speaker-high"
            tone="blue"
            title="Звуки"
            checked={sounds()}
            onChange={(checked) => {
              setSoundsEnabled(checked);
              setSounds(getSoundsEnabled());
            }}
          />
          <SwitchRow
            icon="vibrate"
            tone="purple"
            title="Вибрация"
            checked={vibration()}
            divided
            onChange={(checked) => {
              setVibrationEnabled(checked);
              setVibration(getVibrationEnabled());
            }}
          />
        </ul>
      </section>

      <section class="diary-settings__section" aria-label="Дневник">
        <ul class="settings-list__group">
          <ActionRow icon="printer" tone="gray" title="Распечатать" onClick={props.onPrint} />
          <Show when={props.entries > 0}>
            <ActionRow
              icon="file-arrow-down"
              tone="gray"
              title="Файл для другой программы"
              status="FHIR"
              divided
              onClick={props.onFhir}
            />
          </Show>
          <ActionRow
            icon="arrow-counter-clockwise"
            tone="blue"
            title="Вернуть записи из копии"
            divided
            onClick={() => setSheet('restore')}
          />
          <ActionRow
            icon="arrow-square-up-right"
            tone="teal"
            title="Ссылка от другого врача"
            divided
            onClick={() => setSheet('link')}
          />
          <Show when={props.hasOtherDiaries}>
            <ActionRow
              icon="books"
              tone="green"
              title="Мои дневники"
              divided
              onClick={props.onList}
            />
          </Show>
        </ul>
      </section>

      <Show when={props.onWithdraw}>
        {(withdraw) => (
          <section class="diary-settings__section" aria-label="Согласие на наблюдение">
            <ul class="settings-list__group">
              <ActionRow
                icon="trash"
                tone="pink"
                title="Отозвать согласие"
                danger
                onClick={() => {
                  setWithdrawError('');
                  setConfirming(true);
                }}
              />
            </ul>
            <Show when={withdrawError()}>
              <p class="diary-error" role="alert">
                {withdrawError()}
              </p>
            </Show>
            <ConfirmationDialog
              open={confirming()}
              title="Отозвать согласие?"
              description={
                <p>
                  Наблюдение прекратится, записи удалятся с сервера и с этого телефона. Врач увидит,
                  что вы отозвали согласие.
                </p>
              }
              confirmLabel="Отозвать и удалить"
              danger
              onConfirm={() => {
                setConfirming(false);
                withdraw()().catch((cause: unknown) =>
                  setWithdrawError(
                    cause instanceof Error ? cause.message : 'Не удалось отозвать согласие.',
                  ),
                );
              }}
              onOpenChange={setConfirming}
            />
          </section>
        )}
      </Show>

      <Show when={sheet() === 'restore'}>
        <DiarySheet title="Вернуть записи из копии" onClose={() => setSheet(undefined)}>
          <RestoreCard
            store={props.store}
            open
            // The sheet stays: its card says what was added («Новых записей нет» too).
            onRestored={props.onRestored}
          />
        </DiarySheet>
      </Show>
      <Show when={sheet() === 'link'}>
        <DiarySheet title="Ссылка от другого врача" onClose={() => setSheet(undefined)}>
          <PasteLinkCard
            store={props.store}
            prominent={false}
            open
            onOpened={(opened) => {
              // Open the diary once the sheet's history step is gone: done earlier, that Back
              // would land on the new diary and bring «Настройки» back over it.
              window.addEventListener('popstate', () => props.onOpened(opened), { once: true });
              setSheet(undefined);
            }}
          />
        </DiarySheet>
      </Show>
    </main>
  );
}
