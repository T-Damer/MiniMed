import { createSignal, type JSX, Show } from 'solid-js';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { Switch } from '@/components/Switch';
import { ScreenHeader } from '@/diary/diary-ui';
import { InstallCard } from '@/diary/InstallCard';
import { PasteLinkCard } from '@/diary/PasteLinkCard';
import { RestoreCard } from '@/diary/RestoreCard';
import type { DiaryOpenResult, DiaryStore } from '@/features/diary/diary-storage';
import {
  getSoundsEnabled,
  getVibrationEnabled,
  setSoundsEnabled,
  setVibrationEnabled,
} from '@/state/app-preferences';

function MoreAction(props: {
  readonly icon: AppGlyphName;
  readonly title: string;
  readonly text: string;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <div class="diary-more__row">
      <Button
        class="diary-button diary-more__button"
        type="button"
        icon={<AppGlyph name={props.icon} class="diary-more__icon" />}
        disabled={props.disabled ?? false}
        onClick={props.onClick}
      >
        {props.title}
      </Button>
      <p class="diary-more__text">{props.text}</p>
    </div>
  );
}

function PreferenceRow(props: {
  readonly icon: AppGlyphName;
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <div class="diary-more__preference">
      <AppGlyph name={props.icon} class="diary-more__icon" aria-hidden="true" />
      <span class="diary-more__preference-label">{props.label}</span>
      <Switch checked={props.checked} aria-label={props.label} onChange={props.onChange} />
    </div>
  );
}

/**
 * «Ещё»: what a patient needs rarely — print, a copy for another program, bringing records back,
 * adding the diary to the home screen, another doctor's link, a short how-to. Nothing here
 * competes with the three main actions.
 */
export function DiaryMore(props: {
  readonly store: DiaryStore;
  readonly entries: number;
  readonly onBack: () => void;
  readonly onPrint: () => void;
  readonly onFhir: () => void;
  readonly onRestored: (diaryId: string) => void;
  readonly onOpened: (opened: DiaryOpenResult) => void;
  readonly onList: () => void;
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
  const [push, setPush] = createSignal<'off' | 'on' | 'unsupported' | 'denied'>(
    props.pushOn ? 'on' : 'off',
  );
  const [sounds, setSounds] = createSignal(getSoundsEnabled());
  const [vibration, setVibration] = createSignal(getVibrationEnabled());
  const [confirming, setConfirming] = createSignal(false);
  const [withdrawError, setWithdrawError] = createSignal('');
  return (
    <main class="diary-page diary-page--more">
      <ScreenHeader title="Ещё" subtitle="Печать, копия, справка" onBack={props.onBack} />
      <section class="diary-more__group" aria-label="Печать и файлы">
        <MoreAction
          icon="printer"
          title="Распечатать дневник"
          text="Бумажная копия записей, чтобы взять с собой на приём."
          onClick={props.onPrint}
        />
        <MoreAction
          icon="file-arrow-down"
          title="Файл для другой программы (FHIR)"
          text="Для врача, который работает в другой медицинской программе."
          disabled={props.entries === 0}
          onClick={props.onFhir}
        />
      </section>
      <section class="diary-more__group" aria-label="Звуки и вибрация">
        <PreferenceRow
          icon="speaker-high"
          label="Звуки"
          checked={sounds()}
          onChange={(checked) => {
            setSoundsEnabled(checked);
            setSounds(getSoundsEnabled());
          }}
        />
        <PreferenceRow
          icon="vibrate"
          label="Вибрация"
          checked={vibration()}
          onChange={(checked) => {
            setVibrationEnabled(checked);
            setVibration(getVibrationEnabled());
          }}
        />
      </section>
      <RestoreCard store={props.store} onRestored={props.onRestored} />
      <InstallCard store={props.store} entries={props.entries} variant="section" />
      <PasteLinkCard store={props.store} prominent={false} onOpened={props.onOpened} />
      <section class="diary-card" aria-label="Как пользоваться дневником">
        <h2 class="diary-card__title">Как пользоваться дневником</h2>
        <ol class="diary-card__steps">
          <li class="diary-card__step">
            «Записать показания»: введите числа и нажмите «Сохранить». Время записи ставится само.
          </li>
          <li class="diary-card__step">
            «Мои записи»: здесь все записи, новые сверху. Ошибку можно исправить кнопкой «Изменить»
            или удалить запись.
          </li>
          <li class="diary-card__step">
            «Отправить врачу»: перед визитом выберите способ и отправьте записи. Дневник запомнит,
            что уже у врача.
          </li>
        </ol>
        <p class="diary-card__text">
          Записи хранятся только на этом устройстве, в браузере. Не очищайте данные сайта до визита
          к врачу.
        </p>
      </section>
      <Show when={props.onEnablePush}>
        {(enable) => (
          <section class="diary-more__group" aria-label="Уведомления">
            <MoreAction
              icon="vibrate"
              title={push() === 'on' ? 'Уведомления включены' : 'Включить уведомления'}
              text={
                push() === 'unsupported'
                  ? 'Этот браузер не умеет. На iPhone сначала добавьте дневник на экран «Домой».'
                  : push() === 'denied'
                    ? 'Уведомления запрещены в настройках телефона.'
                    : 'Напоминания о приёме, новая рекомендация или изменение лечения.'
              }
              disabled={push() === 'on'}
              onClick={() => {
                void enable()().then(setPush, () => setPush('unsupported'));
              }}
            />
            <Show when={push() === 'on' && props.reminders}>
              {(reminders) => (
                <>
                  <PreferenceRow
                    icon="bell"
                    label="Напоминать о приёме и отметках"
                    checked={reminders().on}
                    onChange={(on) => props.onReminders?.({ on })}
                  />
                  <Show when={reminders().on}>
                    <PreferenceRow
                      icon="pill"
                      label="Названия лекарств в уведомлении"
                      checked={reminders().names}
                      onChange={(names) => props.onReminders?.({ names })}
                    />
                  </Show>
                </>
              )}
            </Show>
          </section>
        )}
      </Show>
      <Show when={props.onWithdraw}>
        {(withdraw) => (
          <section class="diary-card" aria-label="Согласие на наблюдение">
            <h2 class="diary-card__title">Отозвать согласие</h2>
            <p class="diary-card__text">
              Наблюдение прекратится, записи удалятся с сервера и с этого телефона. Врач увидит, что
              вы отозвали согласие.
            </p>
            <Show
              when={confirming()}
              fallback={
                <Button
                  class="diary-button diary-button--danger"
                  type="button"
                  onClick={() => setConfirming(true)}
                >
                  Отозвать согласие
                </Button>
              }
            >
              <Button
                class="diary-button diary-button--danger"
                type="button"
                onClick={() => {
                  setWithdrawError('');
                  withdraw()().catch((cause: unknown) =>
                    setWithdrawError(
                      cause instanceof Error ? cause.message : 'Не удалось отозвать согласие.',
                    ),
                  );
                }}
              >
                Да, отозвать и удалить записи
              </Button>
              <Button class="diary-button" type="button" onClick={() => setConfirming(false)}>
                Отмена
              </Button>
            </Show>
            <Show when={withdrawError()}>
              <p class="diary-error" role="alert">
                {withdrawError()}
              </p>
            </Show>
          </section>
        )}
      </Show>
      <Button class="diary-button" type="button" onClick={props.onList}>
        Мои дневники
      </Button>
    </main>
  );
}
