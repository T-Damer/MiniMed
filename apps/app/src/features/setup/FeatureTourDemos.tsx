import { createEffect, createMemo, createSignal, For, type JSX, onCleanup, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';

/**
 * Small, self-contained previews of real MiniMed screens for the first-run tour.
 * They carry no clinical claims: result snippets are skeleton lines and the
 * questionnaire is an unnamed example, so nothing here can be mistaken for content.
 */
export interface TourDemoProps {
  readonly active: boolean;
}

/** Remounts `stage` whenever the slide becomes active, so CSS animations replay. */
function Replay(props: {
  readonly active: boolean;
  readonly stage: (playing: boolean) => JSX.Element;
}): JSX.Element {
  return (
    <Show when={props.active} fallback={props.stage(false)}>
      {props.stage(true)}
    </Show>
  );
}

const SEARCH_QUERIES = ['артериальная гипертензия', 'амоксициллин детям', 'шкала боли'] as const;
const SEARCH_SOURCES = ['Клинические рекомендации', 'Справочник препаратов', 'Ваши файлы'] as const;

export function SearchDemo(props: TourDemoProps): JSX.Element {
  const [queryIndex, setQueryIndex] = createSignal(0);
  const [typed, setTyped] = createSignal(0);
  const query = () => SEARCH_QUERIES[queryIndex()] ?? SEARCH_QUERIES[0];
  const done = () => typed() >= query().length;

  createEffect(() => {
    if (!props.active) {
      setTyped(query().length);
      return;
    }
    queryIndex();
    setTyped(0);
    const typing = setInterval(() => {
      setTyped((value) => {
        if (value >= query().length) {
          clearInterval(typing);
          return value;
        }
        return value + 1;
      });
    }, 55);
    onCleanup(() => clearInterval(typing));
  });

  return (
    <div class="tour-demo tour-demo--search">
      <div class="tour-search__field">
        <AppGlyph name="search" class="tour-search__icon" />
        <span class="tour-search__query">{query().slice(0, typed())}</span>
        <span class="tour-search__caret" classList={{ 'tour-search__caret--idle': done() }} />
      </div>
      <div class="tour-search__chips">
        <For each={SEARCH_QUERIES}>
          {(item, index) => (
            <button
              class="tour-search__chip"
              classList={{ 'tour-search__chip--active': index() === queryIndex() }}
              type="button"
              onClick={() => setQueryIndex(index())}
            >
              {item}
            </button>
          )}
        </For>
      </div>
      <Show when={done()}>
        <ul class="tour-search__results">
          <For each={SEARCH_SOURCES}>
            {(source, index) => (
              <li class="tour-search__result" style={{ '--tour-order': index() }}>
                <span class="tour-search__source">{source}</span>
                <span class="tour-search__title">
                  <mark class="tour-search__mark">{query()}</mark>
                </span>
                <span class="tour-search__line" />
                <span class="tour-search__line tour-search__line--short" />
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

const PRESSURE_STEPS = [
  [148, 94],
  [142, 90],
  [139, 88],
  [135, 86],
  [131, 84],
  [128, 82],
  [133, 85],
  [126, 80],
] as const;

export function PatientDemo(props: TourDemoProps): JSX.Element {
  const [count, setCount] = createSignal(4);
  createEffect(() => {
    if (props.active) setCount(4);
  });
  const points = createMemo(() => PRESSURE_STEPS.slice(0, count()));
  const polyline = (pick: 0 | 1) =>
    points()
      .map((point, index) => {
        const x = 12 + index * (216 / (PRESSURE_STEPS.length - 1));
        const y = 96 - ((point[pick] - 70) / 90) * 84;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  const last = () => points()[points().length - 1] ?? PRESSURE_STEPS[0];
  return (
    <div class="tour-demo tour-demo--patient">
      <div class="tour-patient__header">
        <span class="tour-patient__avatar" aria-hidden="true">
          🙂
        </span>
        <span class="tour-patient__identity">
          <strong class="tour-patient__name">Пациент А.</strong>
          <span class="tour-patient__meta">Визит · дневник давления</span>
        </span>
        <span class="tour-patient__qr" aria-hidden="true">
          <For each={Array.from({ length: 9 })}>
            {(_, index) => (
              <span
                class="tour-patient__qr-cell"
                classList={{ 'tour-patient__qr-cell--on': [0, 2, 4, 5, 6, 8].includes(index()) }}
              />
            )}
          </For>
        </span>
      </div>
      <Replay
        active={props.active}
        stage={(playing) => (
          <svg
            class="tour-patient__chart"
            classList={{ 'tour-patient__chart--playing': playing }}
            viewBox="0 0 240 104"
            aria-hidden="true"
          >
            <line class="tour-patient__grid" x1="0" x2="240" y1="40" y2="40" />
            <line class="tour-patient__grid" x1="0" x2="240" y1="72" y2="72" />
            <polyline
              class="tour-patient__line tour-patient__line--systolic"
              points={polyline(0)}
            />
            <polyline
              class="tour-patient__line tour-patient__line--diastolic"
              points={polyline(1)}
            />
          </svg>
        )}
      />
      <div class="tour-patient__footer">
        <span class="tour-patient__reading">
          {last()[0]}/{last()[1]} <span class="tour-patient__unit">мм рт. ст.</span>
        </span>
        <button
          class="tour-patient__add"
          type="button"
          disabled={count() >= PRESSURE_STEPS.length}
          onClick={() => setCount((value) => Math.min(PRESSURE_STEPS.length, value + 1))}
        >
          <AppGlyph name="plus" class="tour-patient__add-icon" />
          Измерение
        </button>
      </div>
    </div>
  );
}

const DIALOGUE = [
  { speaker: 'Врач', text: 'Что вас беспокоит?', doctor: true },
  { speaker: 'Пациент', text: 'Плохо сплю уже месяц.', doctor: false },
  { speaker: 'Врач', text: 'Давление измеряли?', doctor: true },
] as const;

export function DictaphoneDemo(props: TourDemoProps): JSX.Element {
  return (
    <Replay
      active={props.active}
      stage={(playing) => (
        <div class="tour-demo tour-demo--dictaphone">
          <div class="tour-dictaphone__recorder">
            <span
              class="tour-dictaphone__dot"
              classList={{ 'tour-dictaphone__dot--live': playing }}
            />
            <span class="tour-dictaphone__wave" aria-hidden="true">
              <For each={Array.from({ length: 22 })}>
                {(_, index) => (
                  <span
                    class="tour-dictaphone__bar"
                    classList={{ 'tour-dictaphone__bar--live': playing }}
                    style={{ '--tour-order': index() % 7, '--tour-height': (index() * 37) % 11 }}
                  />
                )}
              </For>
            </span>
            <span class="tour-dictaphone__time">00:42</span>
          </div>
          <ul class="tour-dictaphone__transcript">
            <For each={DIALOGUE}>
              {(line, index) => (
                <li
                  class="tour-dictaphone__line"
                  classList={{
                    'tour-dictaphone__line--doctor': line.doctor,
                    'tour-dictaphone__line--playing': playing,
                  }}
                  style={{ '--tour-order': index() }}
                >
                  <span class="tour-dictaphone__speaker">{line.speaker}</span>
                  {line.text}
                </li>
              )}
            </For>
          </ul>
        </div>
      )}
    />
  );
}

export function CanvasDemo(props: TourDemoProps): JSX.Element {
  const [run, setRun] = createSignal(0);
  return (
    <button
      class="tour-demo tour-demo--canvas tour-canvas"
      type="button"
      aria-label="Повторить демонстрацию холста"
      onClick={() => setRun((value) => value + 1)}
    >
      <Show when={`${props.active}:${run()}`} keyed>
        <svg class="tour-canvas__drawing" viewBox="0 0 240 120" aria-hidden="true">
          <path
            class="tour-canvas__stroke"
            classList={{ 'tour-canvas__stroke--playing': props.active }}
            d="M18 78c14-30 30-44 44-38s4 34 20 30 20-40 38-38 8 36 26 34 18-22 30-26"
          />
          <path
            class="tour-canvas__stroke tour-canvas__stroke--late"
            classList={{ 'tour-canvas__stroke--playing': props.active }}
            d="M36 96h64"
          />
          <path class="tour-canvas__link" d="M150 70c20 0 26-26 46-30" />
        </svg>
      </Show>
      <span class="tour-canvas__note">Заметка к визиту</span>
      <span class="tour-canvas__chip">
        <AppGlyph name="book-open" class="tour-canvas__chip-icon" />
        Клин. рекомендации
      </span>
    </button>
  );
}

const QUESTIONS = ['Вопрос 1', 'Вопрос 2', 'Вопрос 3'] as const;
const OPTION_POINTS = [0, 1, 2, 3] as const;

export function ToolsDemo(props: TourDemoProps): JSX.Element {
  const [answers, setAnswers] = createSignal<readonly number[]>([1, 2, 0]);
  createEffect(() => {
    if (props.active) setAnswers([1, 2, 0]);
  });
  const total = () => answers().reduce((sum, value) => sum + value, 0);
  const max = QUESTIONS.length * 3;
  return (
    <div class="tour-demo tour-demo--tools">
      <For each={QUESTIONS}>
        {(question, row) => (
          <div class="tour-tools__row">
            <span class="tour-tools__question">{question}</span>
            <span class="tour-tools__options">
              <For each={OPTION_POINTS}>
                {(points) => (
                  <button
                    class="tour-tools__option"
                    classList={{ 'tour-tools__option--selected': answers()[row()] === points }}
                    type="button"
                    aria-pressed={answers()[row()] === points}
                    onClick={() =>
                      setAnswers(
                        answers().map((value, index) => (index === row() ? points : value)),
                      )
                    }
                  >
                    {points}
                  </button>
                )}
              </For>
            </span>
          </div>
        )}
      </For>
      <div class="tour-tools__score">
        <span class="tour-tools__total">
          {total()} из {max} баллов
        </span>
        <span class="tour-tools__meter">
          <span class="tour-tools__meter-fill" style={{ '--tour-fill': total() / max }} />
        </span>
      </div>
    </div>
  );
}
