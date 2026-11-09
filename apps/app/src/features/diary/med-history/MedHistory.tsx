/**
 * Medicines taken before (MEDHIST1): the list and the editor, shared by the patient's diary (and a
 * carer's phone) and the doctor's patient page. The parent owns where the items live and how a
 * save reaches the other devices; this file only shows and edits.
 */
import { errorStateOf } from '@localmed/contracts';
import { createResource, createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { ChoiceChip } from '@/components/ChoiceChip';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import { HelpSources } from '@/components/HelpSources';
import { SheetPopover } from '@/components/SheetPopover';
import { Switch } from '@/components/Switch';
import { TextArea } from '@/components/TextArea';
import { TextField } from '@/components/TextField';
import {
  draftOf,
  emptyPastMedDraft,
  PAST_MED_ALLERGY,
  PAST_MED_ALLERGY_LABEL,
  PAST_MED_AUTHOR_LABEL,
  PAST_MED_CONCERN_LABEL,
  PAST_MED_DRAFT_ERRORS,
  PAST_MED_EFFECT_LABEL,
  PAST_MED_EFFECTS,
  PAST_MED_SEVERITIES,
  PAST_MED_SEVERITY_LABEL,
  PAST_MED_STOP_LABEL,
  PAST_MED_STOPS,
  type PastMedAuthor,
  type PastMedDraft,
  type PastMedication,
  type PastMedWarning,
  pastMedConcern,
  pastMedFromDraft,
  pastMedOutcome,
  pastMedPeriod,
} from '@/features/diary/diary-med-history';
import {
  MED_HISTORY_HELP,
  type MedHistoryHelpKey,
  type MedHistoryViewer,
} from '@/features/diary/med-history/med-history-help';
import { DrugSearchField } from '@/features/drug-picker/DrugSearchField';
import { loadAtcNames } from '@/features/medications/atc-names';

import '@/features/diary/med-history/med-history.css';

/** The «?» of one field: the patient's or the doctor's words, the sources folded under them. */
export function MedHistoryHelp(props: {
  readonly topic: MedHistoryHelpKey;
  readonly viewer: MedHistoryViewer;
  readonly label: string;
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const help = () => MED_HISTORY_HELP[props.topic];
  return (
    <SheetPopover
      open={open()}
      onOpenChange={setOpen}
      title={props.label}
      triggerClass="med-history__help"
      triggerLabel={`Пояснение: ${props.label}`}
      trigger={<AppGlyph name="question" class="med-history__help-icon" />}
      contentClass="med-history__help-panel"
      placement="bottom-end"
    >
      <p class="med-history__help-text">
        {props.viewer === 'doctor' ? help().doctor : help().patient}
      </p>
      <Show when={props.viewer === 'doctor' && help().sources?.length}>
        <HelpSources sources={help().sources ?? []} />
      </Show>
    </SheetPopover>
  );
}

function FieldHead(props: {
  readonly label: string;
  readonly topic?: MedHistoryHelpKey;
  readonly viewer: MedHistoryViewer;
}): JSX.Element {
  return (
    <div class="med-history__field-head">
      <span class="med-history__field-label">{props.label}</span>
      <Show when={props.topic}>
        {(topic) => <MedHistoryHelp topic={topic()} viewer={props.viewer} label={props.label} />}
      </Show>
    </div>
  );
}

/** One choice of a few; tapping the chosen chip again clears it. */
function ChoiceRow<T extends string>(props: {
  readonly label: string;
  readonly options: readonly T[];
  readonly labels: Readonly<Record<T, string>>;
  readonly value: T | undefined;
  readonly onChange: (value: T | undefined) => void;
  readonly testId: string;
}): JSX.Element {
  return (
    <fieldset class="med-history__choices" data-testid={props.testId}>
      <legend class="med-history__sr">{props.label}</legend>
      <For each={props.options}>
        {(option) => (
          <ChoiceChip
            compact
            class="med-history__chip"
            accent={props.value === option}
            aria-pressed={props.value === option}
            onClick={() => props.onChange(props.value === option ? undefined : option)}
          >
            {props.labels[option]}
          </ChoiceChip>
        )}
      </For>
    </fieldset>
  );
}

const CONCERN_GLYPH = {
  allergy: 'warning',
  intolerance: 'warning',
  'side-effects': 'info',
} as const;

/** The list, allergies first; a row opens the editor. */
export function MedHistoryList(props: {
  readonly items: readonly PastMedication[];
  readonly viewer: MedHistoryViewer;
  readonly onOpen?: ((item: PastMedication) => void) | undefined;
  /** Rows show who entered them (the doctor's view and a shared diary). */
  readonly showAuthor?: boolean;
}): JSX.Element {
  return (
    <ul class="med-history__list" data-testid="med-history-list">
      <For each={props.items}>
        {(item) => {
          const concern = () => pastMedConcern(item);
          const body = (
            <>
              <AppGlyph name="pill" class="med-history__row-icon" />
              <span class="med-history__row-text">
                <span class="med-history__row-title">
                  <span class="med-history__row-name">{item.name}</span>
                  <Show when={item.dose}>
                    <span class="med-history__row-dose">{item.dose}</span>
                  </Show>
                  <Show when={concern()}>
                    {(kind) => (
                      <span
                        class="med-history__badge"
                        classList={{
                          'med-history__badge--danger': kind() !== 'side-effects',
                        }}
                      >
                        <AppGlyph name={CONCERN_GLYPH[kind()]} class="med-history__badge-icon" />
                        {PAST_MED_CONCERN_LABEL[kind()]}
                      </span>
                    )}
                  </Show>
                </span>
                <Show when={pastMedPeriod(item)}>
                  {(period) => <span class="med-history__row-line">{period()}</span>}
                </Show>
                <Show when={pastMedOutcome(item)}>
                  {(outcome) => <span class="med-history__row-line">{outcome()}</span>}
                </Show>
                <Show when={item.note}>
                  <span class="med-history__row-line med-history__row-note">{item.note}</span>
                </Show>
                <Show when={props.showAuthor}>
                  <span class="med-history__row-author">
                    внёс {PAST_MED_AUTHOR_LABEL[item.by]},{' '}
                    {new Date(item.updatedAt).toLocaleDateString('ru-RU')}
                  </span>
                </Show>
              </span>
            </>
          );
          return (
            <li class="med-history__item">
              <Show when={props.onOpen} fallback={<div class="med-history__row">{body}</div>}>
                {(open) => (
                  <button
                    type="button"
                    class="med-history__row med-history__row--button"
                    aria-label={`${item.name}: изменить`}
                    onClick={() => open()(item)}
                  >
                    {body}
                    <AppGlyph name="caret-right" class="med-history__row-chevron" />
                  </button>
                )}
              </Show>
            </li>
          );
        }}
      </For>
    </ul>
  );
}

/**
 * The editor: the name first, the rest once a name is there (owner: progressive input). «Сохранить»
 * signs the medicine as `author`; the trash removes a saved one.
 */
export function MedHistoryEditor(props: {
  readonly draft: PastMedDraft;
  readonly author: PastMedAuthor;
  readonly viewer: MedHistoryViewer;
  /** Saved before: the trash shows. */
  readonly existing: boolean;
  readonly onSave: (item: PastMedication) => Promise<void> | void;
  readonly onDelete: () => Promise<void> | void;
  readonly onCancel: () => void;
}): JSX.Element {
  const [draft, setDraft] = createSignal(props.draft);
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [confirming, setConfirming] = createSignal(false);
  const [named, setNamed] = createSignal(props.draft.name.trim() !== '');
  const patch = (next: Partial<PastMedDraft>): void => {
    setDraft({ ...draft(), ...next });
    setError('');
  };
  const reacted = (): boolean =>
    draft().reaction.trim() !== '' ||
    draft().stop === 'side-effects' ||
    draft().stop === 'intolerance' ||
    draft().severity !== undefined;
  const save = async (): Promise<void> => {
    const result = pastMedFromDraft(draft(), props.author);
    if (!result.ok) {
      setError(errorStateOf(PAST_MED_DRAFT_ERRORS, result.error).title);
      return;
    }
    setBusy(true);
    try {
      await props.onSave(result.value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось сохранить.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      class="med-history__editor"
      data-testid="med-history-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div
        class="med-history__field"
        onFocusOut={(event) => {
          const next = event.relatedTarget;
          if (next instanceof Node && event.currentTarget.contains(next)) return;
          if (draft().name.trim()) setNamed(true);
        }}
      >
        <FieldHead label="Препарат" topic="name" viewer={props.viewer} />
        <DrugSearchField
          label="Препарат"
          hideLabel
          placeholder="Начните вводить название"
          data-testid="med-history-name"
          value={draft().name}
          onInput={(name) => patch({ name, slug: undefined, atc: undefined })}
          onPick={(picked) => {
            patch({ name: picked.name, slug: picked.slug, atc: picked.atc });
            setNamed(true);
          }}
        />
      </div>
      <Show when={named()}>
        <div class="med-history__reveal">
          <TextField
            class="med-history__field"
            inputClass="med-history__input"
            label="Доза"
            placeholder="50 мг в день"
            value={draft().dose}
            onInput={(event) => patch({ dose: event.currentTarget.value })}
          />

          <div class="med-history__field">
            <FieldHead label="Когда принимали" topic="when" viewer={props.viewer} />
            <div class="med-history__pair">
              <TextField
                inputClass="med-history__input"
                label="С"
                placeholder="2022"
                inputMode="numeric"
                data-testid="med-history-from"
                value={draft().fromText}
                onInput={(event) => patch({ fromText: event.currentTarget.value })}
              />
              <TextField
                inputClass="med-history__input"
                label="По"
                placeholder="03.2023"
                inputMode="numeric"
                data-testid="med-history-to"
                value={draft().toText}
                onInput={(event) => patch({ toText: event.currentTarget.value })}
              />
            </div>
            <div class="med-history__pair med-history__pair--wide">
              <TextField
                inputClass="med-history__input"
                label="Сколько"
                placeholder="около года"
                data-testid="med-history-duration"
                value={draft().duration}
                onInput={(event) => patch({ duration: event.currentTarget.value })}
              />
              <span class="med-history__switch">
                <span class="med-history__switch-label">Примерно</span>
                <Switch
                  aria-label="Даты примерные"
                  checked={draft().approx}
                  onChange={(approx) => patch({ approx })}
                />
              </span>
            </div>
          </div>

          <div class="med-history__field">
            <FieldHead label="Почему перестали" topic="stop" viewer={props.viewer} />
            <ChoiceRow
              label="Почему перестали"
              testId="med-history-stop"
              options={PAST_MED_STOPS}
              labels={PAST_MED_STOP_LABEL}
              value={draft().stop}
              onChange={(stop) => patch({ stop })}
            />
            <Show when={draft().stop === 'other'}>
              <TextField
                inputClass="med-history__input"
                label="Какая причина"
                hideLabel
                placeholder="Какая причина"
                value={draft().stopNote}
                onInput={(event) => patch({ stopNote: event.currentTarget.value })}
              />
            </Show>
          </div>

          <div class="med-history__field">
            <FieldHead label="Реакция" topic="reaction" viewer={props.viewer} />
            <TextArea
              label="Реакция"
              hideLabel
              rows={2}
              placeholder="Что произошло и когда"
              data-testid="med-history-reaction"
              value={draft().reaction}
              onInput={(event) => patch({ reaction: event.currentTarget.value })}
            />
          </div>

          <Show when={reacted()}>
            <div class="med-history__field">
              <FieldHead label="Тяжесть реакции" topic="severity" viewer={props.viewer} />
              <ChoiceRow
                label="Тяжесть реакции"
                testId="med-history-severity"
                options={PAST_MED_SEVERITIES}
                labels={PAST_MED_SEVERITY_LABEL}
                value={draft().severity}
                onChange={(severity) => patch({ severity })}
              />
            </div>
          </Show>

          <div class="med-history__field">
            <FieldHead label="Аллергия" topic="allergy" viewer={props.viewer} />
            <ChoiceRow
              label="Аллергия"
              testId="med-history-allergy"
              options={PAST_MED_ALLERGY}
              labels={PAST_MED_ALLERGY_LABEL}
              value={draft().allergy}
              onChange={(allergy) => patch({ allergy })}
            />
          </div>

          <div class="med-history__field">
            <FieldHead
              label={props.viewer === 'doctor' ? 'Эффект по оценке пациента' : 'Помогло ли'}
              topic="effect"
              viewer={props.viewer}
            />
            <ChoiceRow
              label="Эффект"
              testId="med-history-effect"
              options={PAST_MED_EFFECTS}
              labels={PAST_MED_EFFECT_LABEL}
              value={draft().effect}
              onChange={(effect) => patch({ effect })}
            />
          </div>

          <TextArea
            class="med-history__field"
            label="Заметка"
            rows={2}
            placeholder="Что ещё важно"
            value={draft().note}
            onInput={(event) => patch({ note: event.currentTarget.value })}
          />
        </div>
      </Show>

      <p class="med-history__error" role="status" data-testid="med-history-error">
        {error()}
      </p>
      <div class="med-history__actions">
        <Show when={props.existing}>
          <Button
            type="button"
            variant="icon"
            class="med-history__delete"
            aria-label="Удалить из истории"
            icon={<AppGlyph name="trash" class="med-history__action-icon" />}
            onClick={() => setConfirming(true)}
          />
        </Show>
        <Button type="button" variant="quiet" onClick={() => props.onCancel()}>
          Отмена
        </Button>
        <Button type="submit" variant="primary" disabled={busy()} data-testid="med-history-save">
          Сохранить
        </Button>
      </div>
      <ConfirmationDialog
        open={confirming()}
        title="Удалить препарат из истории?"
        description={draft().name}
        confirmLabel="Удалить"
        danger
        onConfirm={() => {
          setConfirming(false);
          void Promise.resolve(props.onDelete()).catch((cause: unknown) =>
            setError(cause instanceof Error ? cause.message : 'Не удалось удалить.'),
          );
        }}
        onOpenChange={setConfirming}
      />
    </form>
  );
}

/**
 * The list with «+» and the editor in its place: one panel for a sheet. `start` opens it straight
 * on a draft (a medicine the doctor took off the plan).
 */
export function MedHistoryPanel(props: {
  readonly items: readonly PastMedication[];
  readonly author: PastMedAuthor;
  readonly viewer: MedHistoryViewer;
  readonly start?: PastMedDraft | undefined;
  readonly onSave: (item: PastMedication) => Promise<void> | void;
  readonly onDelete: (id: string) => Promise<void> | void;
  /** Called when the editor closes after a draft given by `start`. */
  readonly onDone?: () => void;
}): JSX.Element {
  const [editing, setEditing] = createSignal<
    { readonly draft: PastMedDraft; readonly existing: boolean } | undefined
  >(props.start ? { draft: props.start, existing: false } : undefined);
  const close = (): void => {
    const fromStart = props.start !== undefined;
    setEditing(undefined);
    if (fromStart) props.onDone?.();
  };
  return (
    <div class="med-history" data-testid="med-history">
      <Show
        when={editing()}
        keyed
        fallback={
          <>
            <Show
              when={props.items.length}
              fallback={
                <div class="med-history__empty">
                  <AppGlyph name="pill" class="med-history__empty-icon" />
                  <p class="med-history__empty-text">
                    {props.viewer === 'doctor'
                      ? 'Прошлых препаратов пока нет.'
                      : 'Какие лекарства вы принимали раньше? Отметьте и те, что не подошли.'}
                  </p>
                </div>
              }
            >
              <MedHistoryList
                items={props.items}
                viewer={props.viewer}
                showAuthor
                onOpen={(item) => setEditing({ draft: draftOf(item), existing: true })}
              />
            </Show>
            <Button
              variant="secondary"
              class="med-history__add"
              data-testid="med-history-add"
              icon={<AppGlyph name="plus" class="med-history__action-icon" />}
              onClick={() => setEditing({ draft: emptyPastMedDraft(), existing: false })}
            >
              Добавить препарат
            </Button>
          </>
        }
      >
        {(current) => (
          <MedHistoryEditor
            draft={current.draft}
            existing={current.existing}
            author={props.author}
            viewer={props.viewer}
            onCancel={close}
            onSave={async (item) => {
              await props.onSave(item);
              close();
            }}
            onDelete={async () => {
              await props.onDelete(current.draft.id);
              close();
            }}
          />
        )}
      </Show>
    </div>
  );
}

const WARNING_WORDS: Readonly<Record<PastMedWarning['concern'], string>> = {
  allergy: 'аллергия',
  intolerance: 'непереносимость',
  'side-effects': 'побочные эффекты',
};

/**
 * The prescribing warning (doctor's plan editor): a fact from the history, never a block. Group
 * names come from the NSI «АТХ» list when it is loaded.
 */
export function PastMedWarnings(props: {
  readonly warnings: readonly PastMedWarning[];
}): JSX.Element {
  // The NSI names (~110 kB) load only when a group matched.
  const [names] = createResource(
    () => props.warnings.some((warning) => warning.match === 'group') || undefined,
    () =>
      loadAtcNames()
        .then((catalog) => catalog.names)
        .catch((cause: unknown) => {
          console.warn('ATC group names are unavailable.', cause);
          return {} as Readonly<Record<string, string>>;
        }),
  );
  return (
    <Show when={props.warnings.length}>
      <div class="med-history__warnings" role="note" data-testid="med-history-warning">
        <div class="med-history__warnings-head">
          <AppGlyph name="warning" class="med-history__warnings-icon" />
          <span class="med-history__warnings-title">В истории препаратов</span>
          <MedHistoryHelp topic="warning" viewer="doctor" label="Как сравниваются препараты" />
        </div>
        <ul class="med-history__warnings-list">
          <For each={props.warnings}>
            {(warning) => (
              <li class="med-history__warnings-item">
                <strong class="med-history__warnings-name">{warning.item.name}</strong>
                {' — '}
                {WARNING_WORDS[warning.concern]}
                <Show when={warning.item.reaction}>{(reaction) => <>: {reaction()}</>}</Show>
                <Show when={warning.match === 'group' && warning.code}>
                  {(code) => (
                    <span class="med-history__warnings-group">
                      {' '}
                      · та же группа АТХ {code()}
                      <Show when={names.latest?.[code()]}>
                        {(name) => <> ({name().toLocaleLowerCase('ru-RU')})</>}
                      </Show>
                    </span>
                  )}
                </Show>
                <Show when={warning.match === 'same'}>
                  <span class="med-history__warnings-group"> · тот же препарат</span>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </div>
    </Show>
  );
}
