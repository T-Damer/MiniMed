import { createSignal, For, Index, type JSX, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { Checkbox } from '@/components/Checkbox';
import { TextArea } from '@/components/TextArea';
import { TextField } from '@/components/TextField';
import {
  addBand,
  canAddBand,
  parseWeightInput,
  removeBand,
  setScoreBySection,
  updateBand,
} from '@/features/assessments/user-questionnaire-edit';
import {
  bandForScore,
  bandsInScope,
  formatScoreRange,
  type QuestionnaireIssue,
  questionnaireIsScored,
  questionnaireScopes,
  questionnaireScoreRange,
} from '@/state/user-questionnaire-rules';
import type { UserQuestionnaire, UserQuestionnaireBand } from '@/state/user-questionnaires';

import '@/features/assessments/user-questionnaire-editor.css';

function ScoreTester(props: {
  readonly questionnaire: UserQuestionnaire;
  readonly scope: string;
}): JSX.Element {
  const [text, setText] = createSignal('');
  const band = () => {
    const parsed = parseWeightInput(text());
    return parsed.ok && parsed.value !== undefined
      ? bandForScore(props.questionnaire, props.scope, parsed.value)
      : undefined;
  };
  const entered = () => {
    const parsed = parseWeightInput(text());
    return parsed.ok && parsed.value !== undefined;
  };
  return (
    <div class="questionnaire-bands__tester">
      <TextField
        class="questionnaire-bands__tester-field"
        label="Проверить балл"
        inputmode="decimal"
        placeholder="Например, 7"
        value={text()}
        onInput={(event) => setText(event.currentTarget.value)}
      />
      <Show when={entered()}>
        <p class="questionnaire-bands__tester-result" role="status">
          {band()
            ? `Результат: «${band()?.headline || 'без названия'}»`
            : 'Для этого балла диапазона нет — результат останется без пояснения.'}
        </p>
      </Show>
    </div>
  );
}

function BandRow(props: {
  readonly band: UserQuestionnaireBand;
  readonly number: number;
  readonly issues: readonly QuestionnaireIssue[];
  readonly onChange: (update: (band: UserQuestionnaireBand) => UserQuestionnaireBand) => void;
  readonly onRemove: () => void;
}): JSX.Element {
  const numberField = (
    label: string,
    value: number,
    set: (band: UserQuestionnaireBand, next: number) => UserQuestionnaireBand,
    testId: string,
  ): JSX.Element => (
    <TextField
      class="questionnaire-bands__number"
      label={label}
      inputmode="decimal"
      data-testid={testId}
      value={value}
      onInput={(event) => {
        const parsed = parseWeightInput(event.currentTarget.value);
        if (!parsed.ok || parsed.value === undefined) return;
        const next = parsed.value;
        props.onChange((current) => set(current, next));
      }}
    />
  );
  return (
    <article
      class="questionnaire-bands__band"
      classList={{ 'questionnaire-bands__band--invalid': props.issues.length > 0 }}
      data-testid="questionnaire-band"
    >
      <header class="questionnaire-bands__band-header">
        <h4 class="questionnaire-bands__band-title">Диапазон {props.number}</h4>
        <Button
          type="button"
          variant="icon"
          class="questionnaire-bands__remove"
          aria-label={`Удалить диапазон ${props.number}`}
          title="Удалить диапазон"
          onClick={props.onRemove}
          icon={<AppGlyph name="trash" class="questionnaire-bands__icon" />}
        />
      </header>
      <div class="questionnaire-bands__numbers">
        {numberField('Баллы от', props.band.min, (band, min) => ({ ...band, min }), 'band-min')}
        {numberField('до', props.band.max, (band, max) => ({ ...band, max }), 'band-max')}
      </div>
      <TextField
        class="questionnaire-bands__headline"
        label="Название результата"
        placeholder="Например, «Низкий уровень»"
        data-testid="band-headline"
        value={props.band.headline}
        onInput={(event) => {
          const headline = event.currentTarget.value;
          props.onChange((current) => ({ ...current, headline }));
        }}
      />
      <TextArea
        class="questionnaire-bands__message"
        label="Пояснение"
        rows={2}
        placeholder="Что означает такой результат и что делать дальше"
        data-testid="band-message"
        value={props.band.message}
        onInput={(event) => {
          const message = event.currentTarget.value;
          props.onChange((current) => ({ ...current, message }));
        }}
      />
      <Show when={props.issues.length > 0}>
        <ul class="questionnaire-bands__issues">
          <Index each={props.issues}>
            {(issue) => (
              <li
                class="questionnaire-bands__issue"
                classList={{
                  'questionnaire-bands__issue--warning': issue().severity === 'warning',
                }}
              >
                {issue().message}
              </li>
            )}
          </Index>
        </ul>
      </Show>
    </article>
  );
}

/**
 * Scoring and interpretation: one total or a score per section, and the ranges that turn a score
 * into a headline and an explanation. The result page shows the range the score falls into.
 */
export function UserQuestionnaireBandsEditor(props: {
  readonly questionnaire: UserQuestionnaire;
  readonly issues: readonly QuestionnaireIssue[];
  readonly onChange: (next: UserQuestionnaire) => void;
}): JSX.Element {
  const scored = () => questionnaireIsScored(props.questionnaire);
  const scopes = () => questionnaireScopes(props.questionnaire);
  const bandIssues = (bandId: string) => props.issues.filter((issue) => issue.bandId === bandId);
  /** Advice about the ranges as a whole: scores no range covers, ranges nobody can reach. */
  const generalIssues = () =>
    props.issues.filter((issue) => issue.part === 'bands' && !issue.bandId);
  const scopeNote = (scope: string): string => {
    const range = questionnaireScoreRange(props.questionnaire, scope);
    return range
      ? `Возможные баллы: ${formatScoreRange(range.min, range.max)}.`
      : 'Баллы у ответов этого раздела не указаны.';
  };
  return (
    <section
      class="questionnaire-bands paper-card"
      aria-label="Подсчёт баллов и результат"
      data-testid="questionnaire-bands"
    >
      <header class="questionnaire-bands__header">
        <h2 class="questionnaire-bands__title">Подсчёт и результат</h2>
        <p class="questionnaire-bands__text">
          Сумма баллов выбранных ответов показывается в результате. Диапазоны объясняют, что
          означает сумма.
        </p>
      </header>
      <Show
        when={scored()}
        fallback={
          <p class="questionnaire-bands__empty">
            Баллы у ответов не заданы, поэтому опросник только записывает выбранные ответы. Укажите
            баллы у всех ответов, чтобы получить сумму и задать диапазоны результата.
          </p>
        }
      >
        <Show when={props.questionnaire.sections.length > 0}>
          <Checkbox
            class="questionnaire-bands__by-section"
            label="Считать баллы отдельно по разделам"
            hint="Вместо одной суммы результат покажет сумму каждого раздела со своим пояснением."
            checked={props.questionnaire.scoreBySection}
            onChange={(event) =>
              props.onChange(setScoreBySection(props.questionnaire, event.currentTarget.checked))
            }
          />
        </Show>
        <For each={scopes()}>
          {(entry) => (
            <section
              class="questionnaire-bands__scope"
              aria-label={`Диапазоны: ${entry.label}`}
              data-testid="questionnaire-bands-scope"
            >
              <header class="questionnaire-bands__scope-header">
                <h3 class="questionnaire-bands__scope-title">{entry.label}</h3>
                <span class="questionnaire-bands__hint">{scopeNote(entry.scope)}</span>
              </header>
              <Index each={bandsInScope(props.questionnaire, entry.scope)}>
                {(band, index) => (
                  <BandRow
                    band={band()}
                    number={index + 1}
                    issues={bandIssues(band().id)}
                    onChange={(update) =>
                      props.onChange(updateBand(props.questionnaire, band().id, update))
                    }
                    onRemove={() => props.onChange(removeBand(props.questionnaire, band().id))}
                  />
                )}
              </Index>
              <div class="questionnaire-bands__footer">
                <Button
                  type="button"
                  variant="secondary"
                  class="questionnaire-bands__add"
                  data-testid="questionnaire-band-add"
                  disabled={!canAddBand(props.questionnaire, entry.scope)}
                  onClick={() => props.onChange(addBand(props.questionnaire, entry.scope))}
                  icon={<AppGlyph name="plus" class="questionnaire-bands__icon" />}
                >
                  Добавить диапазон
                </Button>
                <Show when={bandsInScope(props.questionnaire, entry.scope).length > 0}>
                  <ScoreTester questionnaire={props.questionnaire} scope={entry.scope} />
                </Show>
              </div>
            </section>
          )}
        </For>
        <Show when={generalIssues().length > 0}>
          <ul class="questionnaire-bands__issues">
            <Index each={generalIssues()}>
              {(issue) => (
                <li
                  class="questionnaire-bands__issue"
                  classList={{
                    'questionnaire-bands__issue--warning': issue().severity === 'warning',
                  }}
                >
                  {issue().message}
                </li>
              )}
            </Index>
          </ul>
        </Show>
      </Show>
    </section>
  );
}
