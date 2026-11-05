import type {
  PsyStatusAssessment,
  PsyStatusDetail,
  PsyStatusEntry,
  PsyStatusModuleId,
  PsyStatusQuote,
  PsyStatusSuggestion,
} from '@localmed/contracts';
import { PSY_STATUS_ASSESSMENTS } from '@localmed/contracts';
import {
  acceptPsyStatusSuggestion,
  addPsyStatusCustomEntry,
  dismissPsyStatusSuggestion,
  editPsyStatusEntry,
  generatePsyStatusText,
  PSY_STATUS_CATALOG,
  psyStatusAssessment,
  psyStatusIssues,
  psyStatusPhrase,
  psyStatusSection,
  removePsyStatusEntry,
  togglePsyStatusPhrase,
  withPsyStatusAssessment,
} from '@localmed/core/psy-status';
import { createEffect, createMemo, createSignal, For, type JSX, onMount, Show } from 'solid-js';
import { toast } from 'solid-sonner';

import { PAGE_HEROES } from '@/app/page-heroes';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { ChoiceChip, ChoiceChipList } from '@/components/ChoiceChip';
import { NavBack } from '@/components/NavBack';
import { OverlayDialog } from '@/components/OverlayDialog';
import { Page } from '@/components/Page';
import { PatientPickerRow } from '@/components/PatientPickerRow';
import { SegmentedControl } from '@/components/SegmentedControl';
import { Heading } from '@/components/Text';
import { TextArea } from '@/components/TextArea';
import { conversationTitle } from '@/features/conversations/conversation-session';
import { usePatientVaultSnapshot } from '@/features/forms/use-patient-vault-snapshot';
import { savePsyStatus } from '@/features/psy-status/psy-status-record';
import {
  loadPsyStatusRecording,
  psyStatusSession,
  takePsyStatusText,
} from '@/features/psy-status/psy-status-session';
import {
  type ConversationRecording,
  listConversationRecordings,
} from '@/state/conversation-recordings';
import { FEEDBACK_MOMENTS, playFeedback } from '@/state/ui-feedback';

import './psy-status.css';

const MODULE_LABELS: Readonly<Record<PsyStatusModuleId, string>> = {
  mental: 'Психический',
  somatic: 'Соматический',
  pharma: 'Фармакология',
};

const DETAIL_OPTIONS: readonly { readonly value: PsyStatusDetail; readonly label: string }[] = [
  { value: 'brief', label: 'Кратко' },
  { value: 'standard', label: 'Стандартно' },
  { value: 'detailed', label: 'Подробно' },
];

function newId(): string {
  return crypto.randomUUID();
}

function plural(count: number, forms: readonly [string, string, string]): string {
  const tens = count % 100;
  const ones = count % 10;
  if (tens >= 11 && tens <= 14) return forms[2];
  if (ones === 1) return forms[0];
  if (ones >= 2 && ones <= 4) return forms[1];
  return forms[2];
}

/** One line of the transcript with the quoted part marked. */
function QuotedLine(props: {
  readonly line: string;
  readonly index: number;
  readonly quote: PsyStatusQuote | undefined;
}): JSX.Element {
  const range = (): { start: number; end: number } | undefined => {
    const quote = props.quote;
    if (!quote || props.index < quote.startLine || props.index > quote.endLine) return undefined;
    return {
      start: props.index === quote.startLine ? quote.start : 0,
      end: props.index === quote.endLine ? quote.end : props.line.length,
    };
  };
  return (
    <p
      class="psy-status__line"
      classList={{ 'psy-status__line--quoted': range() !== undefined }}
      data-line={props.index}
    >
      <span class="psy-status__line-number">{props.index + 1}</span>
      <span class="psy-status__line-text">
        <Show when={range()} fallback={props.line}>
          {(span) => (
            <>
              {props.line.slice(0, span().start)}
              <mark class="psy-status__mark">{props.line.slice(span().start, span().end)}</mark>
              {props.line.slice(span().end)}
            </>
          )}
        </Show>
      </span>
    </p>
  );
}

function TranscriptSheet(props: {
  readonly lines: readonly string[];
  readonly title: string;
  readonly quote: PsyStatusQuote | undefined;
  readonly open: boolean;
  readonly onClose: () => void;
}): JSX.Element {
  let body: HTMLDivElement | undefined;
  createEffect(() => {
    const quote = props.quote;
    if (!props.open || !quote) return;
    queueMicrotask(() => {
      body?.querySelector(`[data-line="${quote.startLine}"]`)?.scrollIntoView({ block: 'center' });
    });
  });
  return (
    <OverlayDialog open={props.open} title={props.title} onClose={props.onClose}>
      <div class="psy-status__transcript" ref={body}>
        <For each={props.lines}>
          {(line, index) => <QuotedLine line={line} index={index()} quote={props.quote} />}
        </For>
      </div>
    </OverlayDialog>
  );
}

function SuggestionCard(props: {
  readonly suggestion: PsyStatusSuggestion;
  readonly onAccept: () => void;
  readonly onDismiss: () => void;
  readonly onQuote: (quote: PsyStatusQuote) => void;
}): JSX.Element {
  const ref = () => psyStatusPhrase(props.suggestion.code);
  return (
    <li class="psy-status__suggestion">
      <span class="psy-status__suggestion-section">{ref()?.section.name}</span>
      <span class="psy-status__suggestion-text">{ref()?.phrase.text}</span>
      <span class="psy-status__quotes">
        <For each={props.suggestion.quotes}>
          {(quote) => (
            <button
              type="button"
              class="psy-status__quote"
              aria-label={`Показать в тексте беседы, строка ${quote.startLine + 1}`}
              onClick={() => props.onQuote(quote)}
            >
              «{quote.text}»
            </button>
          )}
        </For>
      </span>
      <span class="psy-status__suggestion-actions">
        <Button
          variant="icon"
          aria-label="Отклонить"
          icon={<AppGlyph name="close" />}
          onClick={props.onDismiss}
        />
        <Button
          variant="primary"
          icon={<AppGlyph name="check" />}
          aria-label="Принять"
          onClick={props.onAccept}
        >
          В статус
        </Button>
      </span>
    </li>
  );
}

function EntryRow(props: {
  readonly entry: PsyStatusEntry;
  readonly onEdit: (text: string) => void;
  readonly onRemove: () => void;
  readonly onQuote: (quote: PsyStatusQuote) => void;
}): JSX.Element {
  const [editing, setEditing] = createSignal(false);
  const section = () => psyStatusSection(props.entry.moduleId, props.entry.sectionId);
  return (
    <li class="psy-status__entry">
      <span class="psy-status__entry-section">{section()?.name}</span>
      <Show
        when={editing()}
        fallback={<span class="psy-status__entry-text">{props.entry.text}</span>}
      >
        <TextArea
          label="Формулировка"
          hideLabel
          class="psy-status__entry-editor"
          rows={3}
          maxLength={5_000}
          value={props.entry.text}
          ref={(element) => queueMicrotask(() => element.focus())}
          onChange={(event) => {
            const text = event.currentTarget.value.trim();
            if (text) props.onEdit(text);
            setEditing(false);
          }}
        />
      </Show>
      <span class="psy-status__entry-actions">
        <Show when={props.entry.quotes[0]}>
          {(quote) => (
            <Button
              variant="quiet"
              class="psy-status__entry-source"
              icon={<AppGlyph name="microphone" />}
              aria-label="Где это в беседе"
              onClick={() => props.onQuote(quote())}
            >
              из беседы
            </Button>
          )}
        </Show>
        <Button
          variant="icon"
          aria-label="Изменить формулировку"
          icon={<AppGlyph name="edit" />}
          onClick={() => setEditing(!editing())}
        />
        <Button
          variant="icon"
          aria-label="Убрать из статуса"
          icon={<AppGlyph name="trash" />}
          onClick={props.onRemove}
        />
      </span>
    </li>
  );
}

function PsyStatusHelp(): JSX.Element {
  return (
    <div class="psy-status__help">
      <p>
        Формулировки, разделы и правила проверки — из «Конструктора психиатрического статуса»{' '}
        {PSY_STATUS_CATALOG.source.version}.
      </p>
      <p>
        Из беседы предлагаются формулировки, слова которых прозвучали, — у каждой цитата из текста.
        Отрицание («голосов не слышу», «аллергии нет») предлагает формулировку отрицания. Вопрос
        учитывается, только если следующая строка начинается с «да» или «нет». В статус попадает
        только то, что вы приняли.
      </p>
    </div>
  );
}

export function PsyStatusWorkspace(props: {
  readonly recordingId?: string | undefined;
  readonly onBack: () => void;
}): JSX.Element {
  const session = psyStatusSession;
  const vault = usePatientVaultSnapshot();
  const [moduleId, setModuleId] = createSignal<PsyStatusModuleId>('mental');
  const [sectionId, setSectionId] = createSignal('appearance');
  const [customText, setCustomText] = createSignal('');
  const [viewing, setViewing] = createSignal<PsyStatusQuote | undefined>();
  const [transcriptOpen, setTranscriptOpen] = createSignal(false);
  const [pickingSource, setPickingSource] = createSignal(false);
  const [pasting, setPasting] = createSignal(false);
  const [pasted, setPasted] = createSignal('');
  const [recordings, setRecordings] = createSignal<readonly ConversationRecording[]>([]);
  const [saving, setSaving] = createSignal(false);

  onMount(() => {
    const id = props.recordingId;
    if (!id) return;
    void loadPsyStatusRecording(id)
      .then((found) => {
        if (!found) toast.error('В этой записи пока нет текста.');
      })
      .catch(() => toast.error('Не удалось открыть текст беседы.'));
  });

  const module = createMemo(
    () =>
      PSY_STATUS_CATALOG.modules.find((item) => item.id === moduleId()) ??
      PSY_STATUS_CATALOG.modules[0],
  );
  const section = createMemo(
    () => module()?.sections.find((item) => item.id === sectionId()) ?? module()?.sections[0],
  );
  const document = session.document;
  const pickedCodes = createMemo(
    () => new Set(document().entries.flatMap((entry) => (entry.code ? [entry.code] : []))),
  );
  const text = createMemo(() => generatePsyStatusText(document()));
  const issues = createMemo(() => psyStatusIssues(document()));
  const sectionCount = (id: string): number =>
    document().entries.filter((entry) => entry.moduleId === moduleId() && entry.sectionId === id)
      .length;

  const showQuote = (quote: PsyStatusQuote): void => {
    setViewing(quote);
    setTranscriptOpen(true);
  };
  const changeModule = (next: PsyStatusModuleId): void => {
    setModuleId(next);
    setSectionId(
      PSY_STATUS_CATALOG.modules.find((item) => item.id === next)?.sections[0]?.id ?? '',
    );
  };
  const openSourcePicker = (): void => {
    void listConversationRecordings()
      .then((items) => setRecordings(items.filter((item) => item.status !== 'recording')))
      .catch(() => setRecordings([]));
    setPickingSource(true);
  };
  const pickRecording = (recording: ConversationRecording): void => {
    setPickingSource(false);
    void loadPsyStatusRecording(recording.id)
      .then((found) => {
        if (!found) toast.error('В этой записи пока нет текста.');
      })
      .catch(() => toast.error('Не удалось открыть текст беседы.'));
  };
  const acceptAll = (): void => {
    let next = document();
    for (const suggestion of session.openSuggestions()) {
      next = acceptPsyStatusSuggestion(next, suggestion, newId());
    }
    session.setDocument(next);
  };
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text());
      toast.success('Текст скопирован');
    } catch {
      toast.error('Не удалось скопировать текст.');
    }
  };
  const save = async (): Promise<void> => {
    const patientId = session.patientId();
    if (!patientId || saving()) return;
    setSaving(true);
    try {
      await savePsyStatus({
        patientId,
        document: document(),
        recordingId: session.transcript()?.recordingId,
      });
      playFeedback(...FEEDBACK_MOMENTS.saved);
      toast.success('Статус сохранён в карту пациента');
    } catch {
      playFeedback(...FEEDBACK_MOMENTS.failed);
      toast.error('Не удалось сохранить статус.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="psy-status">
      <Page
        hero={PAGE_HEROES.psyStatus}
        navigation={<NavBack class="psy-status__back" aria-label="Назад" onClick={props.onBack} />}
        title={<Heading depth={1}>Психический статус</Heading>}
        help={<PsyStatusHelp />}
      />

      <PatientPickerRow
        class="psy-status__patient"
        profiles={vault.snapshot()?.profiles ?? []}
        patientId={session.patientId()}
        unlocked={vault.unlocked()}
        hint="Чтобы сохранить статус в карту"
        onPatientChange={session.setPatientId}
        onSnapshotChange={vault.adopt}
      />

      <section class="psy-status__panel psy-status__conversation" aria-label="Беседа">
        <Show
          when={session.transcript()}
          fallback={
            <div class="psy-status__source-empty">
              <AppGlyph name="microphone" class="psy-status__source-glyph" />
              <span class="psy-status__source-copy">Заполнить по беседе</span>
              <Button variant="primary" onClick={openSourcePicker}>
                Запись
              </Button>
              <Button variant="quiet" onClick={() => setPasting(true)}>
                Вставить текст
              </Button>
            </div>
          }
        >
          {(transcript) => (
            <>
              <div class="psy-status__source">
                <button
                  type="button"
                  class="psy-status__source-name"
                  onClick={() => {
                    setViewing(undefined);
                    setTranscriptOpen(true);
                  }}
                >
                  <AppGlyph name="microphone" class="psy-status__source-glyph" />
                  {transcript().label}
                </button>
                <Button
                  variant="icon"
                  aria-label="Другая беседа"
                  icon={<AppGlyph name="close" />}
                  onClick={() => session.setTranscript(undefined)}
                />
              </div>
              <Show
                when={session.openSuggestions().length > 0}
                fallback={
                  <p class="psy-status__source-done">
                    {session.suggestions().length === 0
                      ? 'В беседе нет слов, по которым можно предложить формулировки.'
                      : 'Все предложения из беседы разобраны.'}
                  </p>
                }
              >
                <div class="psy-status__suggestions-head">
                  <span class="psy-status__suggestions-count">
                    {session.openSuggestions().length}{' '}
                    {plural(session.openSuggestions().length, [
                      'предложение',
                      'предложения',
                      'предложений',
                    ])}
                  </span>
                  <Button variant="quiet" onClick={acceptAll}>
                    Принять все
                  </Button>
                </div>
                <ul class="psy-status__suggestions">
                  <For each={session.openSuggestions()}>
                    {(suggestion) => (
                      <SuggestionCard
                        suggestion={suggestion}
                        onQuote={showQuote}
                        onAccept={() =>
                          session.setDocument(
                            acceptPsyStatusSuggestion(document(), suggestion, newId()),
                          )
                        }
                        onDismiss={() =>
                          session.setDocument(
                            dismissPsyStatusSuggestion(document(), suggestion.code),
                          )
                        }
                      />
                    )}
                  </For>
                </ul>
              </Show>
            </>
          )}
        </Show>
      </section>

      <section class="psy-status__panel psy-status__builder" aria-label="Разделы">
        <SegmentedControl
          class="psy-status__modules"
          stretch
          label="Модуль"
          value={moduleId()}
          options={PSY_STATUS_CATALOG.modules.map((item) => ({
            value: item.id,
            label: MODULE_LABELS[item.id],
          }))}
          onChange={changeModule}
        />
        <ChoiceChipList label="Раздел" class="psy-status__sections">
          <For each={module()?.sections ?? []}>
            {(item) => (
              <ChoiceChip
                compact
                accent={item.id === section()?.id}
                aria-pressed={item.id === section()?.id}
                detail={sectionCount(item.id) > 0 ? String(sectionCount(item.id)) : undefined}
                onClick={() => setSectionId(item.id)}
              >
                {item.name}
              </ChoiceChip>
            )}
          </For>
        </ChoiceChipList>
        <Show when={section()}>
          {(current) => (
            <>
              <p class="psy-status__section-hint">{current().hint}</p>
              <ChoiceChipList label="Статус раздела" class="psy-status__assessments">
                <For each={PSY_STATUS_ASSESSMENTS}>
                  {(assessment: PsyStatusAssessment) => {
                    const active = () =>
                      psyStatusAssessment(document(), moduleId(), current().id) === assessment;
                    return (
                      <ChoiceChip
                        compact
                        accent={active()}
                        aria-pressed={active()}
                        onClick={() =>
                          session.setDocument(
                            withPsyStatusAssessment(
                              document(),
                              moduleId(),
                              current().id,
                              assessment,
                            ),
                          )
                        }
                      >
                        {PSY_STATUS_CATALOG.assessmentLabels[assessment]}
                      </ChoiceChip>
                    );
                  }}
                </For>
              </ChoiceChipList>
              <ul class="psy-status__phrases">
                <For each={current().phrases}>
                  {(phrase) => (
                    <li class="psy-status__phrase-item">
                      <button
                        type="button"
                        class="psy-status__phrase"
                        classList={{ 'psy-status__phrase--picked': pickedCodes().has(phrase.code) }}
                        aria-pressed={pickedCodes().has(phrase.code)}
                        onClick={() =>
                          session.setDocument(
                            togglePsyStatusPhrase(document(), phrase.code, newId()),
                          )
                        }
                      >
                        <span class="psy-status__phrase-text">{phrase.text}</span>
                        <span class="psy-status__phrase-evidence">
                          {PSY_STATUS_CATALOG.evidenceLabels[phrase.evidence]}
                        </span>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
              <form
                class="psy-status__custom"
                onSubmit={(event) => {
                  event.preventDefault();
                  session.setDocument(
                    addPsyStatusCustomEntry(document(), {
                      id: newId(),
                      moduleId: moduleId(),
                      sectionId: current().id,
                      text: customText(),
                      evidence: 'custom',
                    }),
                  );
                  setCustomText('');
                }}
              >
                <TextArea
                  label="Своя формулировка"
                  hideLabel
                  placeholder="Своя формулировка"
                  rows={2}
                  maxLength={800}
                  class="psy-status__custom-field"
                  value={customText()}
                  onInput={(event) => setCustomText(event.currentTarget.value)}
                />
                <Button
                  type="submit"
                  variant="icon"
                  aria-label="Добавить формулировку"
                  icon={<AppGlyph name="plus" />}
                  disabled={!customText().trim()}
                />
              </form>
            </>
          )}
        </Show>
      </section>

      <Show when={document().entries.length > 0}>
        <section class="psy-status__panel" aria-label="В статусе">
          <ul class="psy-status__entries">
            <For each={document().entries}>
              {(entry) => (
                <EntryRow
                  entry={entry}
                  onQuote={showQuote}
                  onEdit={(value) =>
                    session.setDocument(editPsyStatusEntry(document(), entry.id, value))
                  }
                  onRemove={() => session.setDocument(removePsyStatusEntry(document(), entry.id))}
                />
              )}
            </For>
          </ul>
          <Show when={issues().length > 0}>
            <ul class="psy-status__issues" aria-label="Проверка">
              <For each={issues()}>
                {(issue) => (
                  <li class={`psy-status__issue psy-status__issue--${issue.type}`}>{issue.text}</li>
                )}
              </For>
            </ul>
          </Show>
        </section>

        <section class="psy-status__panel psy-status__result" aria-label="Текст статуса">
          <SegmentedControl
            stretch
            label="Подробность"
            value={document().detail}
            options={DETAIL_OPTIONS}
            onChange={(detail) => session.setDocument({ ...document(), detail })}
          />
          <pre class="psy-status__text">{text()}</pre>
          <div class="psy-status__result-actions">
            <Button
              variant="icon"
              aria-label="Копировать текст"
              icon={<AppGlyph name="copy" />}
              onClick={() => void copy()}
            />
            <Button
              variant="primary"
              disabled={!session.patientId() || saving() || !text()}
              onClick={() => void save()}
            >
              {saving() ? 'Сохраняем…' : 'Сохранить'}
            </Button>
          </div>
        </section>
      </Show>

      <TranscriptSheet
        open={transcriptOpen()}
        title={session.transcript()?.label ?? 'Беседа'}
        lines={session.transcript()?.lines ?? []}
        quote={viewing()}
        onClose={() => setTranscriptOpen(false)}
      />

      <OverlayDialog
        open={pickingSource()}
        title="Запись беседы"
        onClose={() => setPickingSource(false)}
      >
        <Show
          when={recordings().length > 0}
          fallback={<p class="psy-status__source-done">На этом устройстве нет записей бесед.</p>}
        >
          <ul class="psy-status__recordings">
            <For each={recordings()}>
              {(recording) => (
                <li class="psy-status__recording-item">
                  <button
                    type="button"
                    class="psy-status__recording"
                    onClick={() => pickRecording(recording)}
                  >
                    <span class="psy-status__recording-name">{conversationTitle(recording)}</span>
                    <span class="psy-status__recording-date">
                      {new Date(recording.startedAt).toLocaleString('ru-RU', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </OverlayDialog>

      <OverlayDialog open={pasting()} title="Текст беседы" onClose={() => setPasting(false)}>
        <form
          class="psy-status__paste"
          onSubmit={(event) => {
            event.preventDefault();
            if (takePsyStatusText(pasted())) {
              setPasted('');
              setPasting(false);
            }
          }}
        >
          <TextArea
            label="Текст беседы"
            hideLabel
            placeholder="Вставьте расшифровку: каждая реплика с новой строки"
            rows={10}
            value={pasted()}
            onInput={(event) => setPasted(event.currentTarget.value)}
          />
          <Button type="submit" variant="primary" disabled={!pasted().trim()}>
            Разобрать
          </Button>
        </form>
      </OverlayDialog>
    </div>
  );
}
