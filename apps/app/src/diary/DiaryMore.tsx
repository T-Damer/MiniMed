import type { JSX } from 'solid-js';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { ScreenHeader } from '@/diary/diary-ui';
import { InstallCard } from '@/diary/InstallCard';
import { PasteLinkCard } from '@/diary/PasteLinkCard';
import { RestoreCard } from '@/diary/RestoreCard';
import type { DiaryOpenResult, DiaryStore } from '@/features/diary/diary-storage';

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
}): JSX.Element {
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
      <Button class="diary-button" type="button" onClick={props.onList}>
        Мои дневники
      </Button>
    </main>
  );
}
