import { createSignal, For, type JSX, Match, onMount, Switch } from 'solid-js';

import { Button } from '@/components/Button';
import { CrisisContent } from '@/diary/care-contacts';
import type { DiaryInvitation } from '@/features/diary/diary-model';

/**
 * Plain summaries of the two documents the patient signed on paper at the visit. The full texts
 * are the clinic's (drafts: docs/diary-consent/); the app records that the patient read these.
 */
const MONITORING_POINTS = [
  'Вы отмечаете лекарства, самочувствие, показатели и опросники, которые назначил врач.',
  'Записи видят только ваш врач и врачи, которых он подключит; список виден вам.',
  'Врач читает записи в рабочее время. Это не экстренная помощь.',
  'Отказаться можно в любой момент — на лечение это не влияет.',
];

// The offline diary: entries stay on the phone until the patient sends them.
const DATA_POINTS = [
  'В дневнике нет вашего имени: кто вы, знает только врач.',
  'Записи хранятся на вашем телефоне и уходят врачу, когда вы их отправите.',
  'Удалить дневник можно в любой момент вместе со всеми записями.',
];

// The connected diary (ADR-0026): encrypted on the phone, kept on a server in Russia.
const CONNECTED_DATA_POINTS = [
  'В дневнике нет вашего имени: кто вы, знает только врач.',
  'Записи шифруются на телефоне и уходят врачу сами; сервер хранит только шифр и прочитать его не может.',
  'Данные хранятся в России. Отозвать согласие можно в «Ещё» — записи удалятся с сервера.',
];

type Step = 'monitoring' | 'data' | 'crisis';

function Points(props: { readonly points: readonly string[] }): JSX.Element {
  return (
    <ul class="diary-intro__points">
      <For each={props.points}>{(point) => <li class="diary-intro__point">{point}</li>}</For>
    </ul>
  );
}

/** Before the first entry: two consent summaries and where to turn when it is very bad. */
export function CareIntro(props: {
  readonly invitation: DiaryInvitation;
  /** The diary syncs through the service rather than being sent by hand. */
  readonly connected?: boolean;
  readonly onDone: () => void;
}): JSX.Element {
  const [step, setStep] = createSignal<Step>('monitoring');
  let heading: HTMLHeadingElement | undefined;
  const go = (next: Step): void => {
    setStep(next);
    window.scrollTo(0, 0);
    queueMicrotask(() => heading?.focus({ preventScroll: true }));
  };
  onMount(() => heading?.focus({ preventScroll: true }));
  const number = (): number => ['monitoring', 'data', 'crisis'].indexOf(step()) + 1;

  return (
    <main class="diary-page diary-page--care diary-intro">
      <p class="diary-intro__step">Шаг {number()} из 3</p>
      <Switch>
        <Match when={step() === 'monitoring'}>
          <h1 class="diary-intro__title" tabindex="-1" ref={heading}>
            Согласие на наблюдение
          </h1>
          <p class="diary-intro__lead">
            {props.invitation.doctor
              ? `${props.invitation.doctor} будет следить за лечением по этому дневнику.`
              : 'Врач будет следить за лечением по этому дневнику.'}
          </p>
          <Points points={MONITORING_POINTS} />
          <Button
            class="diary-button diary-intro__next"
            variant="primary"
            onClick={() => go('data')}
          >
            Прочитал(а), согласен(на)
          </Button>
        </Match>
        <Match when={step() === 'data'}>
          <h1 class="diary-intro__title" tabindex="-1" ref={heading}>
            Согласие на обработку данных
          </h1>
          <Points points={props.connected ? CONNECTED_DATA_POINTS : DATA_POINTS} />
          <Button
            class="diary-button diary-intro__next"
            variant="primary"
            onClick={() => go('crisis')}
          >
            Прочитал(а), согласен(на)
          </Button>
        </Match>
        <Match when={step() === 'crisis'}>
          <h1 class="diary-intro__title" tabindex="-1" ref={heading}>
            Если станет очень плохо
          </h1>
          <CrisisContent invitation={props.invitation} />
          <p class="diary-intro__lead">Эти контакты всегда под кнопкой «Помощь» вверху дневника.</p>
          <Button class="diary-button diary-intro__next" variant="primary" onClick={props.onDone}>
            Начать дневник
          </Button>
        </Match>
      </Switch>
    </main>
  );
}
