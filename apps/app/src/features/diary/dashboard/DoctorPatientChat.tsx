import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import { Button } from '@/components/Button';
import { CompanionMessageRow } from '@/diary/CompanionMessageUi';
import { DiaryChatComposer } from '@/diary/DiaryChatComposer';
import { DoctorMediaMessage } from '@/diary/DiaryMediaTransfer';
import { formatDate } from '@/diary/diary-format';
import type { DoctorDiaries, DoctorPatient } from '@/features/diary/connected/doctor-workspace';
import { DoctorPlanComposer } from '@/features/diary/dashboard/DoctorPlanComposer';
import { dayKey } from '@/features/diary/diary-care';
import {
  type DiaryEntry,
  type DiaryResults,
  describeDiaryEntry,
} from '@/features/diary/diary-model';
import { planChanges } from '@/features/diary/plan-changes';
import '@/diary/companion-chat.css';
import '@/diary/diary-thread.css';

const PAGE_SIZE = 40;
interface Event {
  readonly id: string;
  readonly at: string;
  readonly author?: string;
  readonly text?: string;
  readonly entry?: DiaryEntry;
  readonly outgoing: boolean;
}

export function DoctorPatientChat(props: {
  readonly patient: DoctorPatient;
  readonly results: DiaryResults;
  readonly workspace: DoctorDiaries;
  readonly editable: boolean;
  readonly mediaRequest: number | undefined;
  readonly stopMedia: () => void;
  readonly openDay: (day: string) => void;
  readonly openPlanDraft: () => void;
}): JSX.Element {
  const [limit, setLimit] = createSignal(PAGE_SIZE);
  const events = createMemo(() => {
    const messages: Event[] = (props.patient.replica.chat ?? []).map((message) => ({
      ...message,
      outgoing: message.author === `d:${props.workspace.doctorId}`,
      author: message.author.startsWith('d:') ? 'Врач' : 'Пациент',
    }));
    const marks: Event[] = props.results.entries.map((entry) => ({
      id: `mark-${entry.id}`,
      at: entry.at,
      outgoing: false,
      author: entry.answers || entry.assignment ? 'Отчёт' : 'Отметка',
      entry,
    }));
    const history = props.patient.replica.planHistory ?? [];
    const updates: Event[] = history.slice(1).flatMap((revision, i) => {
      const previous = history[i];
      if (!previous) return [];
      const lines = planChanges(previous.invitation, revision.invitation);
      return lines.length
        ? [
            {
              id: `plan-${revision.rev}`,
              at: revision.at,
              outgoing: revision.author === `d:${props.workspace.doctorId}`,
              author: 'План обновлён',
              text: lines.join('\n'),
            },
          ]
        : [];
    });
    return [...messages, ...marks, ...updates].sort((a, b) => a.at.localeCompare(b.at));
  });
  const visible = createMemo(() => {
    const selected = events().slice(-limit());
    return selected.map((event, index) => ({
      event,
      day:
        index === 0 || dayKey(selected[index - 1]?.at ?? '') !== dayKey(event.at)
          ? dayKey(event.at)
          : undefined,
    }));
  });
  const beforeMedia = () => {
    const request = props.mediaRequest;
    return request ? visible().filter(({ event }) => Date.parse(event.at) <= request) : visible();
  };
  const afterMedia = () => {
    const request = props.mediaRequest;
    return request ? visible().filter(({ event }) => Date.parse(event.at) > request) : [];
  };
  const render = (item: ReturnType<typeof visible>[number]) => {
    const { event, day } = item;
    const entry = event.entry;
    const text = entry
      ? [describeDiaryEntry(props.results.invitation, entry), entry.note]
          .filter(Boolean)
          .join('\n') || 'Запись в дневнике'
      : (event.text ?? '');
    return (
      <>
        <Show when={day}>
          <time class="diary-thread__day" dateTime={day}>
            {formatDate(event.at)}
          </time>
        </Show>
        <CompanionMessageRow
          outgoing={event.outgoing}
          at={event.at}
          text={text}
          author={event.author}
          actions={
            entry ? (
              <Button
                variant="quiet"
                class="diary-thread__day-action"
                onClick={() => props.openDay(dayKey(event.at))}
              >
                Открыть день
              </Button>
            ) : undefined
          }
        />
      </>
    );
  };
  const active = () => props.editable && props.patient.summary.status === 'active';
  let log: HTMLDivElement | undefined;
  let frame: number | undefined;
  let nearBottom = true;
  const scroll = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (log) log.scrollTop = log.scrollHeight;
    });
  };
  createEffect(
    on(
      () => events().at(-1)?.id,
      () => {
        if (nearBottom) scroll();
      },
    ),
  );
  createEffect(
    on(
      () => props.mediaRequest,
      (request) => {
        if (request) scroll();
      },
    ),
  );
  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame);
  });
  const loadEarlier = () => {
    if (!log) return;
    const before = log.scrollHeight;
    setLimit((current) => current + PAGE_SIZE);
    log.scrollTop += log.scrollHeight - before;
  };

  return (
    <section class="diary-thread" aria-label="Чат с пациентом">
      <div
        class="diary-thread__log"
        role="log"
        aria-label="Сообщения и отметки"
        ref={log}
        onScroll={(event) => {
          const node = event.currentTarget;
          nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 100;
        }}
      >
        <Show when={events().length > limit()}>
          <Button variant="quiet" onClick={loadEarlier}>
            Показать предыдущие
          </Button>
        </Show>
        <For each={beforeMedia()}>{render}</For>
        <Show when={props.mediaRequest} keyed>
          {(request) => (
            <DoctorMediaMessage
              requestAt={request}
              patientId={props.patient.summary.id}
              workspace={props.workspace}
              onClose={props.stopMedia}
              onReceived={() => {
                if (nearBottom) scroll();
              }}
            />
          )}
        </Show>
        <For each={afterMedia()}>{render}</For>
        <Show when={!events().length && !props.mediaRequest}>
          <p class="diary-thread__empty">Здесь появятся сообщения, отметки и отчёты пациента.</p>
        </Show>
      </div>
      <Show when={active()}>
        <div class="diary-thread__footer">
          <DoctorPlanComposer
            session={props.workspace.session}
            patientId={props.patient.summary.id}
            openDraft={props.openPlanDraft}
          />
          <DiaryChatComposer
            label="Сообщение пациенту"
            send={async (id, text) => {
              const patientId = props.patient.summary.id;
              await props.workspace.sendChat(patientId, id, text);
              void props.workspace.refreshPatient(patientId).catch(() => {
                /* The ordinary sync retries the read. */
              });
              scroll();
            }}
          />
        </div>
      </Show>
    </section>
  );
}
