import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import { AppGlyph } from '@/components/AppGlyph';
import { HorizontalScroller } from '@/components/HorizontalScroller';
import { SheetPopover } from '@/components/SheetPopover';
import {
  type ChatQuote,
  type ChatReaction,
  CompanionEmojiPicker,
  CompanionMessageAction,
  CompanionMessageRow,
  CompanionPlanUpdate,
  CompanionQuote,
} from '@/diary/CompanionMessageUi';
import type { CareSave } from '@/diary/care-sheets';
import { COMPANION_PHOTO_TYPES, createCompanionAttachments } from '@/diary/companion-attachments';
import { companionPresetId } from '@/diary/companion-avatar';
import { companionHelpIntent, companionReply } from '@/diary/companion-dialogue';
import {
  type ChatFormat,
  type ChatText,
  editCompanionFormat,
  parseCompanionText,
} from '@/diary/companion-message-format';
import { DiaryChatComposer } from '@/diary/DiaryChatComposer';
import { PatientMediaRequest } from '@/diary/DiaryMediaTransfer';
import { planSections } from '@/diary/DiaryPlanOverview';
import { DiarySheet, GrowingText } from '@/diary/DiarySheet';
import { formatDate, pluralize } from '@/diary/diary-format';
import { createSpokenTracker, type SpokenTracker } from '@/diary/spoken';
import { VoiceNote } from '@/diary/VoiceNote';
import type { DiaryChatMessage } from '@/features/diary/connected/diary-chat';
import type { MediaOffer } from '@/features/diary/connected/media-signaling';
import type { PatientConnection } from '@/features/diary/connected/patient-connection';
import {
  type AssignmentTask,
  type CheckTask,
  type DayPlan,
  type DoseTask,
  dayKey,
  doseValue,
  type QuestionnaireTask,
} from '@/features/diary/diary-care';
import {
  createDiaryId,
  type DiaryEntry,
  type DiaryInvitation,
  MAX_DIARY_NOTE,
} from '@/features/diary/diary-model';
import type { DiaryPlanChange } from '@/features/diary/plan-changes';
import '@/diary/companion-chat.css';

const images = import.meta.glob<string>('@/diary/companion-assets/*.webp', {
  eager: true,
  import: 'default',
  query: '?inline',
});
const mascotNames: Readonly<Record<string, string>> = {
  'bean-mint': 'Фасолинка',
  'bean-lilac': 'Лаванда',
  'bean-peach': 'Персинка',
  'cloud-mint': 'Пушинка',
  'cloud-lilac': 'Облачко',
  'cloud-peach': 'Зефирка',
};
const presets = Object.entries(images).map(([path, url]) => {
  const id = path.split('/').at(-1) ?? '';
  const key = id.split('-').slice(0, 2).join('-');
  return {
    id,
    url,
    name: mascotNames[key] ?? 'Фасолинка',
  };
});
const preferenceKey = 'minimed.diary.companion';
const snoozeKey = (id: string) => `${preferenceKey}.${id}.snooze`;

function readPreference(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function writePreference(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Session preferences still work when storage is unavailable.
  }
}

function useCompanionReminder(diaryId: string) {
  const [until, setUntil] = createSignal(Number(readPreference(snoozeKey(diaryId))));
  const [now, setNow] = createSignal(Date.now());
  const [visible, setVisible] = createSignal(document.visibilityState === 'visible');
  const refresh = () => {
    setVisible(document.visibilityState === 'visible');
    if (document.visibilityState === 'visible') setNow(Date.now());
  };
  document.addEventListener('visibilitychange', refresh);
  onCleanup(() => document.removeEventListener('visibilitychange', refresh));
  createEffect(() => {
    const remaining = until() - now();
    if (!visible() || !(remaining > 0)) return;
    const timer = window.setTimeout(() => setNow(Date.now()), remaining);
    onCleanup(() => window.clearTimeout(timer));
  });
  return {
    snoozed: () => until() > now(),
    later: () => {
      const current = Date.now();
      const next = current + 2 * 60 * 60 * 1000;
      setNow(current);
      setUntil(next);
      writePreference(snoozeKey(diaryId), String(next));
    },
  };
}

function mascot(diaryId: string) {
  const id = companionPresetId(diaryId);
  return presets.find((item) => item.id === id);
}

export function CompanionIdentity(props: { readonly diaryId: string }): JSX.Element {
  const selected = () => mascot(props.diaryId);
  return (
    <span class="companion-chat__identity">
      <img class="companion-chat__avatar" src={selected()?.url} alt="" />
      <span class="companion-chat__name">{selected()?.name ?? 'Фасолинка'}</span>
    </span>
  );
}

export function bindCompanionViewport(page: HTMLElement): void {
  const viewport = window.visualViewport;
  if (!viewport) return;
  const resize = () => {
    if (viewport.scale === 1) {
      const height = `${Math.round(viewport.height)}px`;
      if (page.style.getPropertyValue('--companion-viewport') !== height) {
        page.style.setProperty('--companion-viewport', height);
      }
    }
  };
  resize();
  viewport.addEventListener('resize', resize);
  onCleanup(() => viewport.removeEventListener('resize', resize));
}

type OpenBlock =
  | { kind: 'check'; task: CheckTask; label: string }
  | { kind: 'dose'; task: DoseTask; label: string }
  | { kind: 'quiz'; task: QuestionnaireTask; label: string }
  | { kind: 'assignment'; task: AssignmentTask; label: string };

function availableBlocks(plan: DayPlan): OpenBlock[] {
  return [
    ...plan.assignments
      .filter((task) => !task.entries.length)
      .map((task) => ({
        kind: 'assignment' as const,
        task,
        label: task.assignment.worksheet.title,
      })),
    ...plan.checks
      .filter((task) => !task.entry)
      .map((task) => ({
        kind: 'check' as const,
        task,
        label: [task.checkpoint.label, task.time].filter(Boolean).join(' · '),
      })),
    ...plan.questionnaires
      .filter((task) => task.due && !task.entry)
      .map((task) => ({
        kind: 'quiz' as const,
        task,
        label: task.checkpoint.label,
      })),
    ...plan.doses
      .filter((task) => !task.entry)
      .map((task) => ({
        kind: 'dose' as const,
        task,
        label: [task.item.name, task.time.time].join(' · '),
      })),
  ];
}

function isDue(block: OpenBlock): boolean {
  switch (block.kind) {
    case 'assignment':
      return block.task.due && (block.task.state === 'late' || !block.task.assignment.time);
    case 'check':
      return !block.task.time || block.task.state === 'late' || block.task.state === 'missed';
    case 'dose':
      return block.task.state === 'late' || block.task.state === 'missed';
    case 'quiz':
      return block.task.due;
  }
}

function PlanChip(props: { readonly block: OpenBlock; readonly onOpen: () => void }): JSX.Element {
  const due = () => isDue(props.block);
  return (
    <button
      type="button"
      class="companion-chat__chip"
      classList={{ 'companion-chat__chip--due': due() }}
      onClick={props.onOpen}
    >
      <AppGlyph
        name={due() ? 'warning' : 'note-pencil'}
        class={
          due()
            ? 'companion-chat__chip-icon companion-chat__chip-icon--due'
            : 'companion-chat__chip-icon'
        }
      />
      <span class="companion-chat__chip-copy">
        <strong>{props.block.label}</strong>
        <span class="companion-chat__chip-detail">
          {due()
            ? 'Пора заполнить'
            : props.block.kind === 'assignment' && !props.block.task.due
              ? 'По желанию'
              : 'По плану'}
        </span>
      </span>
      <AppGlyph name="caret-right" class="companion-chat__chip-icon" />
    </button>
  );
}

export interface CompanionResult {
  readonly entryId: string;
  readonly label: string;
  readonly detail: string;
}

interface Message {
  readonly id: string;
  readonly replyTo?: ChatQuote;
  readonly photos?: readonly string[] | undefined;
  readonly update?: DiaryPlanChange | undefined;
  readonly contact?: boolean;
  readonly role: 'patient' | 'companion';
  readonly text: string;
  readonly at: string;
  readonly spoken?: SpokenTracker;
  readonly blocks?: readonly ChatText[] | undefined;
  readonly kind?: 'intro' | 'welcome' | 'night' | 'night-draft' | 'action' | 'guide' | 'direct';
  readonly planKey?: string;
  readonly result?: CompanionResult;
  readonly help?: boolean;
}

/** The open diary owns this transient conversation across its own routes. */
export function createCompanionSession(diaryId: string) {
  const storageKey = `${preferenceKey}.${diaryId}.welcome`;
  const [acknowledgedPlan, setAcknowledgedPlan] = createSignal(readPreference(storageKey));
  let visit: { day: string; hour: number; firstToday: boolean } | undefined;
  return {
    visitToday() {
      const now = new Date();
      const day = dayKey(now);
      if (visit?.day === day) return visit;
      const key = `${preferenceKey}.${diaryId}.visit-day`;
      visit = { day, hour: now.getHours(), firstToday: readPreference(key) !== day };
      writePreference(key, day);
      return visit;
    },
    acknowledgedPlan,
    acknowledgePlan(key: string) {
      writePreference(storageKey, key);
      setAcknowledgedPlan(key);
    },
    messages: createSignal<readonly Message[]>([]),
    recordedNotes: createStore<Record<string, string>>({}),
    openedPlans: new Set<string>(),
    input: createSignal(''),
    review: createSignal<{ id: string; text: string; at: string; message: Message }>(),
    error: createSignal(''),
    spoken: createSpokenTracker(),
  };
}

export type CompanionSession = ReturnType<typeof createCompanionSession>;

export function CompanionChat(props: {
  readonly diaryId: string;
  readonly session: CompanionSession;
  readonly invitation: DiaryInvitation;
  readonly plan: DayPlan;
  readonly entries: readonly DiaryEntry[];
  readonly planChanges: readonly DiaryPlanChange[];
  readonly mediaConnection?: PatientConnection | undefined;
  readonly mediaOffer?: MediaOffer | undefined;
  readonly doctorMessages?: readonly DiaryChatMessage[] | undefined;
  readonly onDoctorMessage?: ((id: string, text: string) => Promise<void>) | undefined;
  readonly canContact: boolean;
  readonly onContact: () => void;
  readonly saved: CompanionResult | undefined;
  readonly blockOpen: boolean;
  readonly onSave: CareSave;
  readonly onCheck: (task: CheckTask) => void;
  readonly onDose: (task: DoseTask) => void;
  readonly onQuiz: (task: QuestionnaireTask) => void;
  readonly onAssignment: (task: AssignmentTask) => void;
  readonly onHelp: () => void;
  readonly onGuide: () => void;
  readonly hasResult: (id: string) => boolean;
  readonly onOpenResult: (id: string) => void;
}): JSX.Element {
  const [messages, setMessages] = props.session.messages;
  const [recordedNotes, setRecordedNote] = props.session.recordedNotes;
  const [input, setInput] = props.session.input;
  const [review, setReview] = props.session.review;
  const [error, setError] = props.session.error;
  const reminder = useCompanionReminder(props.diaryId);
  const [selectedDay, setSelectedDay] = createSignal<string>();
  const [datesOpen, setDatesOpen] = createSignal(false);
  const [emojiOpen, setEmojiOpen] = createSignal(false);
  const [writingDoctor, setWritingDoctor] = createSignal(false);
  const [replyTo, setReplyTo] = createSignal<ChatQuote>();
  const [reactions, setReactions] = createSignal<ReadonlyMap<string, ChatReaction>>(new Map());
  const attachments = createCompanionAttachments();
  const [attachmentMenuOpen, setAttachmentMenuOpen] = createSignal(false);
  const [draggingPhotos, setDraggingPhotos] = createSignal(false);
  let chooser: HTMLInputElement | undefined;
  const hasDraft = () => Boolean(input().trim() || attachments.draft().length);
  const currentDay = () => props.plan.day;
  const day = () => selectedDay() ?? currentDay();
  const live = () => day() === currentDay();
  const updates = createMemo(() =>
    props.planChanges.map(
      (change, i): Message => ({
        id: `change-${change.at}-${i}`,
        role: 'companion',
        text: 'Врач изменил назначение',
        at: change.at,
        update: change,
      }),
    ),
  );
  const directMessages = createMemo(() =>
    (props.doctorMessages ?? []).map(
      (message): Message => ({
        kind: 'direct',
        id: message.id,
        at: message.at,
        text: message.text,
        role: message.author.startsWith('d:') ? 'companion' : 'patient',
      }),
    ),
  );
  const dayMessages = createMemo(() =>
    [...messages(), ...updates(), ...directMessages()]
      .filter((message) => dayKey(message.at) === day())
      .sort((left, right) => left.at.localeCompare(right.at)),
  );
  const notes = createMemo(() =>
    props.entries.filter(
      (entry) =>
        !entry.check &&
        !entry.assignment &&
        !doseValue(entry) &&
        (typeof entry.values['state'] === 'string' || Boolean(entry.note)),
    ),
  );
  const dayNotes = createMemo(() => {
    const alreadyShown = new Set(dayMessages().map((message) => recordedNotes[message.id]));
    return notes().filter((entry) => dayKey(entry.at) === day() && !alreadyShown.has(entry.id));
  });
  const days = createMemo(() =>
    [
      ...new Set([
        currentDay(),
        ...notes().map((entry) => dayKey(entry.at)),
        ...messages().map((m) => dayKey(m.at)),
        ...updates().map((m) => dayKey(m.at)),
        ...directMessages().map((m) => dayKey(m.at)),
      ]),
    ]
      .filter((value) => value <= currentDay())
      .sort()
      .reverse(),
  );
  const dayLabel = (value: string) => {
    if (value === currentDay()) return 'Сегодня';
    const date = formatDate(`${value}T12:00:00`);
    return value.slice(0, 4) === currentDay().slice(0, 4) ? date : `${date} ${value.slice(0, 4)}`;
  };
  let composer: HTMLTextAreaElement | undefined;
  let transcript: HTMLDivElement | undefined;
  let revealFrame: number | undefined;
  const scroll = (end = true) => {
    if (revealFrame !== undefined) window.cancelAnimationFrame(revealFrame);
    revealFrame = window.requestAnimationFrame(() => {
      if (transcript) transcript.scrollTop = end ? transcript.scrollHeight : 0;
    });
  };
  onMount(() => {
    if (dayMessages().some((m) => m.role === 'patient' || m.update)) scroll();
  });
  onCleanup(() => {
    if (revealFrame !== undefined) window.cancelAnimationFrame(revealFrame);
  });
  const selectDay = (next: string) => {
    setSelectedDay(next === currentDay() ? undefined : next);
    setDatesOpen(false);
    scroll(false);
  };

  createEffect(
    on(
      () => props.planChanges.at(-1)?.at,
      (at) => {
        if (at && live() && dayKey(at) === currentDay()) scroll();
      },
      { defer: true },
    ),
  );

  createEffect(
    on(
      () => props.mediaOffer?.requestId,
      (request) => {
        if (request && live()) scroll();
      },
    ),
  );

  createEffect(
    on(
      () => directMessages().at(-1)?.id,
      (id) => {
        if (id && live()) scroll();
      },
    ),
  );
  const welcomeKey = () => `${props.diaryId}:${props.invitation.issuedAt}`;
  const needsWelcome = () =>
    props.session.acknowledgedPlan() !== welcomeKey() &&
    Boolean(
      props.invitation.note ||
        planSections(props.invitation).some((section) => section.rows.length),
    );
  const timestamp = () => new Date().toISOString();
  const speak = (text: string, kind?: Message['kind'], at = timestamp()): Message => ({
    role: 'companion',
    id: createDiaryId(),
    text,
    at,
    ...(kind ? { kind } : {}),
  });
  const nightHours = () => {
    const hour = props.session.visitToday().hour;
    return hour < 6 || hour >= 23;
  };
  const nightMessage = (at: string) =>
    speak(
      'Хотите отметить пробуждение или рассказать, что произошло ночью? Длительность сна можно записать утром.',
      'night',
      at,
    );
  const startNightNote = (label: string, text: string) => {
    setInput((current) => (current.trim() ? current : text));
    const at = timestamp();
    setMessages((items) => [
      ...items,
      { role: 'patient', id: createDiaryId(), kind: 'action', text: label, at },
      speak('Расскажите, что помешало спать или что вы заметили ночью.', 'night-draft', at),
    ]);
    composer?.focus();
    scroll();
  };

  createEffect(
    on(
      () => [currentDay(), welcomeKey()] as const,
      ([date, planKey]) => {
        const key = `${date}:${planKey}`;
        if (props.session.openedPlans.has(key)) return;
        props.session.openedPlans.add(key);
        const visit = props.session.visitToday();
        const greeting = !visit.firstToday
          ? 'Снова здравствуйте!'
          : nightHours()
            ? 'Здравствуйте!'
            : visit.hour < 12
              ? 'Доброе утро!'
              : visit.hour < 18
                ? 'Добрый день!'
                : 'Добрый вечер!';
        const remaining = Math.max(0, props.plan.total - props.plan.done);
        const summary = remaining
          ? `${visit.firstToday ? 'На сегодня' : 'Напомню, на сегодня осталось'} ${remaining} ${pluralize(remaining, 'дело', 'дела', 'дел')} по плану врача.`
          : props.plan.total
            ? 'На сегодня всё по плану отмечено.'
            : 'На сегодня в плане нет дел для отметки.';
        const at = timestamp();
        const intro = [speak(`${greeting} ${summary}`, 'intro', at)];
        if (needsWelcome()) {
          const section = planSections(props.invitation).find((item) => item.rows.length);
          const row = section?.rows[0];
          const text = row
            ? `${section.title}: ${[row.title, row.detail].filter(Boolean).join(' · ')}`
            : 'Указания врача можно открыть прямо здесь.';
          intro.push({ ...speak(text, 'welcome', at), planKey });
        } else if (nightHours()) {
          intro.push(nightMessage(at));
        }
        setMessages((items) => [...items, ...intro]);
      },
    ),
  );

  const answer = (label: string, text: string, kind?: Message['kind']) => {
    const at = timestamp();
    setMessages((items) => [
      ...items,
      { role: 'patient', id: createDiaryId(), kind: 'action', text: label, at },
      speak(text, kind, at),
    ]);
    scroll();
  };
  const acknowledge = () => {
    props.session.acknowledgePlan(welcomeKey());
    answer('Понятно', 'Хорошо. Отмечайте выполненные дела во вкладке «План».');
    if (nightHours() && !dayMessages().some((msg) => msg.kind === 'night')) {
      setMessages((items) => [...items, nightMessage(timestamp())]);
    }
  };
  const explain = () => {
    const details = planSections(props.invitation)
      .filter((section) => section.rows.length && section.id !== 'checks')
      .map((section) => `${section.title}: ${section.rows.map((row) => row.title).join(', ')}.`);
    answer(
      'Объяснить назначения',
      [props.invitation.note, ...details].filter(Boolean).join('\n\n') ||
        'В плане пока нет назначений.',
      'guide',
    );
  };
  const snooze = () => {
    reminder.later();
    answer(
      'Позже',
      'Хорошо. Напоминание снова появится через два часа, если дневник будет открыт.',
    );
  };
  const blocks = createMemo(() => availableBlocks(props.plan));
  const suggested = () =>
    dayMessages().at(-1)?.help
      ? undefined
      : (blocks().find(isDue) ??
        (dayMessages().some((message) => message.role === 'patient' && message.kind !== 'action')
          ? blocks().find((block) => block.kind === 'assignment')
          : undefined));
  let previousSaved = props.saved;
  createEffect(() => {
    if (props.saved !== previousSaved) {
      previousSaved = props.saved;
      const result = props.saved;
      if (result) {
        setMessages((items) => {
          const saved: Message = { ...speak(result.label), result };
          return [...items, saved];
        });
      }
    }
  });

  const composerReply = (message: Message) => {
    setReplyTo({
      id: message.id,
      author:
        message.role === 'patient'
          ? 'Вы'
          : message.update
            ? 'Врач'
            : (mascot(props.diaryId)?.name ?? 'Помощник'),
      text: message.text.slice(0, 140),
    });
    composer?.focus();
  };
  const jumpTo = (quote: ChatQuote) => {
    document.getElementById(`signum-message-${quote.id}`)?.scrollIntoView({ block: 'nearest' });
  };
  const react = (id: string, reaction: ChatReaction) => {
    setReactions((previous) => {
      const next = new Map(previous);
      if (next.get(id) === reaction) next.delete(id);
      else next.set(id, reaction);
      return next;
    });
  };
  const insertEmoji = (emoji: string) => {
    if (!composer) return;
    const { selectionStart, selectionEnd } = composer;
    const next = input().slice(0, selectionStart) + emoji + input().slice(selectionEnd);
    if (next.length > MAX_DIARY_NOTE) return;
    setInput(next);
    setEmojiOpen(false);
    composer.focus();
    composer.setSelectionRange(selectionStart + emoji.length, selectionStart + emoji.length);
  };
  const send = () => {
    const source = input().trim();
    const photos = attachments.draft();
    if (!hasDraft() || !live()) return;
    const formatted = parseCompanionText(source || 'Фото');
    const turn = dayMessages().filter(
      (message) =>
        message.role === 'patient' && message.kind !== 'action' && message.kind !== 'direct',
    ).length;
    const at = timestamp();
    const quote = replyTo();
    setMessages((items) => [
      ...items,
      {
        role: 'patient',
        id: createDiaryId(),
        ...formatted,
        spoken: props.session.spoken,
        at,
        ...(quote ? { replyTo: quote } : {}),
        ...(photos.length ? { photos } : {}),
      },
      ...(photos.length
        ? [
            {
              ...speak(
                props.canContact
                  ? 'Фото осталось на этом устройстве. Я не могу его посмотреть. Могу показать, как связаться с врачом.'
                  : 'Фото осталось на этом устройстве. Я не могу его посмотреть.',
                undefined,
                at,
              ),
              contact: props.canContact,
              help: Boolean(source && companionHelpIntent(formatted.text)),
            },
          ]
        : []),
      ...(source && !photos.length
        ? [
            {
              ...speak(companionReply(formatted.text, turn), undefined, at),
              help: companionHelpIntent(formatted.text),
            },
          ]
        : []),
    ]);
    setInput('');
    attachments.commit();
    setReplyTo(undefined);
    setEmojiOpen(false);
    props.session.spoken = createSpokenTracker();
    scroll();
  };
  const applyFormat = (format: ChatFormat) => {
    if (!composer) return;
    const next = editCompanionFormat(
      input(),
      composer.selectionStart,
      composer.selectionEnd,
      format,
    );
    if (next.text.length > MAX_DIARY_NOTE) return;
    setInput(next.text);
    composer.focus();
    composer.setSelectionRange(next.start, next.end);
  };
  const open = (block: OpenBlock) => {
    switch (block.kind) {
      case 'check':
        props.onCheck(block.task);
        break;
      case 'dose':
        props.onDose(block.task);
        break;
      case 'quiz':
        props.onQuiz(block.task);
        break;
      case 'assignment':
        props.onAssignment(block.task);
        break;
    }
  };
  const hasRecordedNote = (messageId: string): boolean => {
    const noteId = recordedNotes[messageId];
    return noteId !== undefined && props.hasResult(noteId);
  };
  const saveNote = () => {
    batch(() => {
      const draft = review();
      if (!draft?.text.trim()) return;
      const text = draft.text.trim();
      const marks = draft.message.spoken?.marks({ '#state': text });
      const problem = props.onSave({
        id: draft.id,
        at: draft.at,
        values: { state: text },
        ...(marks ? { spoken: marks } : {}),
      });
      setError(problem ?? '');
      if (!problem) {
        setRecordedNote(draft.message.id, draft.id);
        setReview(undefined);
      }
    });
  };
  return (
    <section
      class="companion-chat"
      aria-label="Разговор с помощником"
      onDragOver={(event) => {
        if (!event.dataTransfer?.types.includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = live() ? 'copy' : 'none';
        setDraggingPhotos(live());
      }}
      onDragLeave={(event) => {
        if (
          !(
            event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)
          )
        ) {
          setDraggingPhotos(false);
        }
      }}
      onDrop={(event) => {
        setDraggingPhotos(false);
        if (!event.dataTransfer?.files.length) return;
        event.preventDefault();
        if (live()) attachments.add(event.dataTransfer.files);
      }}
    >
      <div class="companion-chat__dates">
        <button
          type="button"
          class="companion-chat__day"
          aria-label={`Перейти к дате: ${dayLabel(day())}`}
          aria-haspopup="dialog"
          onClick={() => setDatesOpen(true)}
        >
          <time dateTime={day()}>{dayLabel(day())}</time>
        </button>
      </div>
      <div
        ref={transcript}
        class="companion-chat__messages"
        role="log"
        aria-label="Сообщения"
        aria-live="polite"
      >
        <For each={dayNotes()}>
          {(entry) => (
            <CompanionMessageRow
              outgoing
              at={entry.at}
              text={
                typeof entry.values['state'] === 'string'
                  ? entry.values['state']
                  : (entry.note ?? '')
              }
              diaryAction={
                <button
                  type="button"
                  class="companion-chat__save"
                  onClick={() => props.onOpenResult(entry.id)}
                >
                  В дневнике
                </button>
              }
            />
          )}
        </For>
        <For each={dayMessages()}>
          {(message) => (
            <CompanionMessageRow
              id={`signum-message-${message.id}`}
              outgoing={message.role === 'patient'}
              author={
                message.kind === 'direct'
                  ? message.role === 'companion'
                    ? 'Врач'
                    : 'Врачу'
                  : undefined
              }
              reaction={reactions().get(message.id)}
              onReact={(reaction) => react(message.id, reaction)}
              onReply={
                live() && message.kind !== 'direct' ? () => composerReply(message) : undefined
              }
              quote={
                <Show when={message.replyTo}>
                  {(quote) => <CompanionQuote quote={quote()} open={() => jumpTo(quote())} />}
                </Show>
              }
              at={message.at}
              text={message.text}
              blocks={message.blocks}
              card={(() => {
                if (message.update) return <CompanionPlanUpdate change={message.update} />;
                if (message.photos)
                  return (
                    <figure class="companion-chat__photo-message">
                      <For each={message.photos}>
                        {(url) => (
                          <img
                            class="companion-chat__photo"
                            src={url}
                            alt="Прикреплённое фото"
                            loading="lazy"
                          />
                        )}
                      </For>
                      <Show when={message.text !== 'Фото'}>
                        <figcaption>{message.text}</figcaption>
                      </Show>
                    </figure>
                  );
                const result = message.result;
                return result ? (
                  <button
                    type="button"
                    class="companion-chat__chip companion-chat__chip--saved"
                    disabled={!props.hasResult(result.entryId)}
                    onClick={() => props.onOpenResult(result.entryId)}
                  >
                    <AppGlyph
                      name="check"
                      class="companion-chat__chip-icon companion-chat__chip-icon--saved"
                    />
                    <span class="companion-chat__chip-copy">
                      <strong>{result.label}</strong>
                      <span class="companion-chat__chip-detail">
                        {props.hasResult(result.entryId) ? result.detail : 'Удалено'}
                      </span>
                    </span>
                  </button>
                ) : undefined;
              })()}
              details={
                <Show
                  when={
                    live() &&
                    message.kind === 'guide' &&
                    (props.plan.checks.length || props.plan.questionnaires.length)
                  }
                >
                  <p class="companion-chat__check-links">
                    <strong>Что отмечать:</strong>
                    <For each={props.plan.checks}>
                      {(task) => (
                        <button
                          type="button"
                          class="companion-chat__inline-link"
                          onClick={() => props.onCheck(task)}
                        >
                          {task.checkpoint.label}
                        </button>
                      )}
                    </For>
                    <For each={props.plan.questionnaires.filter((task) => task.due)}>
                      {(task) => (
                        <button
                          type="button"
                          class="companion-chat__inline-link"
                          onClick={() => props.onQuiz(task)}
                        >
                          {task.checkpoint.label}
                        </button>
                      )}
                    </For>
                  </p>
                </Show>
              }
              actions={
                <>
                  <Show
                    when={live() && message.planKey === welcomeKey() && message.kind === 'welcome'}
                  >
                    <fieldset class="companion-chat__keyboard" aria-label="Действия по назначению">
                      <Show when={props.session.acknowledgedPlan() !== welcomeKey()}>
                        <CompanionMessageAction
                          label="Понятно"
                          icon="check"
                          emphasis
                          run={acknowledge}
                        />
                      </Show>
                      <CompanionMessageAction
                        label="Объяснить назначения"
                        icon="list-checks"
                        run={explain}
                      />
                    </fieldset>
                  </Show>
                  <Show
                    when={
                      live() &&
                      message.kind === 'intro' &&
                      !dayMessages().some((m) => m.kind === 'welcome')
                    }
                  >
                    <fieldset class="companion-chat__keyboard" aria-label="Действия по плану">
                      <CompanionMessageAction
                        label="Объяснить назначения"
                        icon="list-checks"
                        run={explain}
                      />
                    </fieldset>
                  </Show>
                  <Show when={live() && message.kind === 'guide'}>
                    <fieldset class="companion-chat__keyboard" aria-label="Действия по плану">
                      <CompanionMessageAction
                        label="Открыть весь план"
                        icon="list-checks"
                        run={props.onGuide}
                      />
                    </fieldset>
                  </Show>
                  <Show
                    when={
                      live() &&
                      message.kind === 'night' &&
                      !dayMessages().some(
                        (item) =>
                          item.kind === 'night-draft' ||
                          (item.role === 'patient' && item.kind !== 'action'),
                      )
                    }
                  >
                    <fieldset class="companion-chat__keyboard" aria-label="Отметить ночь">
                      <CompanionMessageAction
                        label="Плохо спалось"
                        icon="clock"
                        emphasis
                        run={() => startNightNote('Плохо спалось', 'Ночной сон: плохо спалось.')}
                      />
                      <CompanionMessageAction
                        label="Что случилось"
                        icon="note-pencil"
                        run={() => startNightNote('Что случилось', 'Ночью: ')}
                      />
                    </fieldset>
                  </Show>
                  <Show when={message.contact}>
                    <div class="companion-chat__keyboard">
                      <CompanionMessageAction
                        label="Связаться с врачом"
                        icon="phone"
                        run={props.onContact}
                      />
                    </div>
                  </Show>
                  <Show when={message.help}>
                    <button
                      type="button"
                      class="companion-chat__chip companion-chat__chip--due"
                      onClick={props.onHelp}
                    >
                      <AppGlyph
                        name="lifebuoy"
                        class="companion-chat__chip-icon companion-chat__chip-icon--due"
                      />
                      Получить помощь
                    </button>
                  </Show>
                </>
              }
              diaryAction={
                <Show
                  when={
                    message.kind !== 'action' &&
                    message.kind !== 'direct' &&
                    (!message.photos || message.text !== 'Фото')
                  }
                >
                  <button
                    type="button"
                    class="companion-chat__save"
                    disabled={props.blockOpen || Boolean(review()) || hasRecordedNote(message.id)}
                    onClick={() => {
                      setError('');
                      setReview({
                        id: createDiaryId(),
                        text: message.text,
                        at: message.at,
                        message,
                      });
                    }}
                  >
                    {hasRecordedNote(message.id) ? 'В дневнике' : 'В дневник'}
                  </button>
                </Show>
              }
            />
          )}
        </For>
        <Show when={props.mediaConnection}>
          {(connection) => (
            <div
              class="companion-chat__media"
              classList={{ 'companion-chat__media--hidden': !live() }}
            >
              <PatientMediaRequest
                offer={props.mediaOffer}
                connection={connection()}
                onReview={scroll}
              />
            </div>
          )}
        </Show>
        <Show when={live() ? props.onDoctorMessage : undefined}>
          {(sendToDoctor) => (
            <div class="diary-thread__direct">
              <CompanionMessageAction
                label={writingDoctor() ? 'Закрыть сообщение врачу' : 'Написать врачу'}
                icon={writingDoctor() ? 'close' : 'note-pencil'}
                run={() => {
                  setWritingDoctor(!writingDoctor());
                  scroll();
                }}
              />
              <div class="diary-thread__direct-composer" hidden={!writingDoctor()}>
                <DiaryChatComposer
                  label="Сообщение врачу"
                  send={async (id, text) => {
                    await sendToDoctor()(id, text);
                    setWritingDoctor(false);
                  }}
                />
              </div>
            </div>
          )}
        </Show>
        <Show when={live() && !props.blockOpen && !review() && !reminder.snoozed() && suggested()}>
          {(block) => (
            <section class="companion-chat__offer" aria-label="Предложение помощника">
              <PlanChip block={block()} onOpen={() => open(block())} />
              <div class="companion-chat__keyboard">
                <CompanionMessageAction label="Позже" icon="clock" run={snooze} />
              </div>
            </section>
          )}
        </Show>
      </div>
      <Show
        when={live()}
        fallback={
          <CompanionMessageAction
            label="К сегодняшним сообщениям"
            icon="calendar"
            run={() => selectDay(currentDay())}
          />
        }
      >
        <form
          class="companion-chat__composer"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
          onPaste={(event) => {
            const files = event.clipboardData?.files;
            if (!files?.length) return;
            event.preventDefault();
            attachments.add(files);
          }}
        >
          <Show when={replyTo()}>
            {(quote) => (
              <div class="companion-chat__composer-preview">
                <CompanionQuote quote={quote()} open={() => jumpTo(quote())} />
                <button
                  type="button"
                  class="companion-chat__format"
                  aria-label="Отменить ответ"
                  onClick={() => setReplyTo(undefined)}
                >
                  <AppGlyph name="close" class="companion-chat__reply-icon" />
                </button>
              </div>
            )}
          </Show>
          <Show when={attachments.draft().length > 0}>
            <HorizontalScroller class="companion-chat__attachments" controlLabel="вложения">
              <div class="companion-chat__attachments-strip">
                <For each={attachments.draft()}>
                  {(url, index) => (
                    <div class="companion-chat__attachment">
                      <img
                        class="companion-chat__photo-preview"
                        src={url}
                        alt="Фото перед отправкой"
                      />
                      <button
                        type="button"
                        class="companion-chat__attachment-remove"
                        aria-label={`Убрать фото ${index() + 1} из черновика`}
                        onClick={() => attachments.remove(url)}
                      >
                        <AppGlyph name="close" class="companion-chat__attachment-remove-icon" />
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </HorizontalScroller>
          </Show>
          <Show when={attachments.error()}>
            <p class="companion-chat__attachment-error" role="alert">
              {attachments.error()}
            </p>
          </Show>
          <Show when={emojiOpen()}>
            <CompanionEmojiPicker insert={insertEmoji} />
          </Show>
          <input
            ref={chooser}
            type="file"
            hidden
            multiple
            accept={COMPANION_PHOTO_TYPES.join(',')}
            onChange={(event) => {
              if (event.currentTarget.files) attachments.add(event.currentTarget.files);
              event.currentTarget.value = '';
            }}
          />
          <div
            class="companion-chat__editor"
            classList={{ 'companion-chat__editor--dragging': draggingPhotos() }}
          >
            <SheetPopover
              open={attachmentMenuOpen()}
              onOpenChange={setAttachmentMenuOpen}
              title="Вложения"
              triggerClass="companion-chat__format"
              triggerLabel="Вложения"
              placement="top-start"
              contentClass="companion-chat__attachment-menu"
              trigger={
                <span
                  class="companion-chat__composer-icon companion-chat__composer-icon--attach"
                  aria-hidden="true"
                />
              }
            >
              <button
                type="button"
                class="companion-chat__attachment-choice"
                onClick={() => {
                  setAttachmentMenuOpen(false);
                  chooser?.click();
                }}
              >
                <span
                  class="companion-chat__composer-icon companion-chat__composer-icon--attach"
                  aria-hidden="true"
                />
                Прикрепить фото
              </button>
            </SheetPopover>
            <textarea
              ref={composer}
              class="companion-chat__input"
              aria-label="О чём хочется рассказать?"
              rows={1}
              maxLength={MAX_DIARY_NOTE}
              placeholder="Сообщение"
              value={input()}
              onInput={(event) => setInput(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (
                  (event.ctrlKey || event.metaKey) &&
                  !event.isComposing &&
                  (event.key.toLowerCase() === 'b' || event.key.toLowerCase() === 'i')
                ) {
                  event.preventDefault();
                  applyFormat(event.key.toLowerCase() === 'b' ? 'bold' : 'italic');
                  return;
                }
                if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
                  event.preventDefault();
                  send();
                }
              }}
            />
            <button
              type="button"
              class="companion-chat__format"
              classList={{ 'companion-chat__format--active': emojiOpen() }}
              aria-label="Смайлы"
              aria-expanded={emojiOpen()}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => setEmojiOpen(!emojiOpen())}
            >
              <span
                class="companion-chat__composer-icon companion-chat__composer-icon--emoji"
                aria-hidden="true"
              />
            </button>
            <Show when={hasDraft()}>
              <button type="submit" class="companion-chat__send" aria-label="Отправить">
                <span
                  class="companion-chat__composer-icon companion-chat__composer-icon--send"
                  aria-hidden="true"
                />
              </button>
            </Show>
            <div
              class="companion-chat__dictation"
              classList={{
                'companion-chat__dictation--busy-draft': hasDraft(),
              }}
            >
              <VoiceNote
                compact="Сообщение"
                idleIcon={
                  <span
                    class="companion-chat__composer-icon companion-chat__composer-icon--mic"
                    aria-hidden="true"
                  />
                }
                onText={(text, origin) => {
                  props.session.spoken.add('#state', text, origin);
                  setInput((current) =>
                    [current, text].filter(Boolean).join('\n').slice(0, MAX_DIARY_NOTE),
                  );
                }}
              />
            </div>
          </div>
        </form>
      </Show>
      <Show when={datesOpen()}>
        <DiarySheet title="Перейти к дате" onClose={() => setDatesOpen(false)}>
          <div class="companion-chat__date-list">
            <For each={days()}>
              {(value) => (
                <button
                  type="button"
                  class="companion-chat__reply companion-chat__date-option"
                  classList={{ 'companion-chat__date-option--selected': value === day() }}
                  aria-pressed={value === day()}
                  onClick={() => selectDay(value)}
                >
                  <AppGlyph name="calendar" class="companion-chat__reply-icon" />
                  <time dateTime={value}>{dayLabel(value)}</time>
                </button>
              )}
            </For>
          </div>
        </DiarySheet>
      </Show>
      <Show when={review()}>
        {(draft) => (
          <DiarySheet
            title="Запись в дневник"
            subtitle={new Date(draft().at).toLocaleDateString('ru-RU', {
              day: 'numeric',
              month: 'long',
            })}
            onClose={() => setReview(undefined)}
            footer={
              <div class="companion-chat__actions">
                <Show when={error()}>
                  <p role="alert" class="companion-chat__error">
                    {error()}
                  </p>
                </Show>
                <button
                  type="button"
                  class="companion-chat__primary"
                  disabled={!draft().text.trim()}
                  onClick={saveNote}
                >
                  Сохранить
                </button>
              </div>
            }
          >
            <GrowingText
              label="Что хотите рассказать врачу?"
              value={draft().text}
              onInput={(text) => setReview({ ...draft(), text })}
            />
          </DiarySheet>
        )}
      </Show>
    </section>
  );
}
