import { createMemo, For, type JSX, Show } from 'solid-js';
import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { DiarySheet } from '@/diary/DiarySheet';
import { keepUnits, pluralize } from '@/diary/diary-format';
import { assignmentScheduleWords } from '@/features/diary/diary-assignments';
import { dayKey } from '@/features/diary/diary-care';
import { DIARY_MEAL_LABEL, type DiaryInvitation } from '@/features/diary/diary-model';
import '@/diary/diary-plan.css';

interface PlanSection {
  readonly id: string;
  readonly title: string;
  readonly icon: AppGlyphName;
  readonly rows: readonly {
    readonly title: string;
    readonly detail: string;
    readonly instruction?: string | undefined;
  }[];
}

export function planSections(invitation: DiaryInvitation): readonly PlanSection[] {
  const tip = (id: string) => invitation.tips?.find((item) => item.target === id)?.text;
  const today = dayKey(new Date());
  return [
    {
      id: 'medicines',
      title: 'Лечение',
      icon: 'pill',
      rows: (invitation.plan ?? [])
        .filter(
          (item) =>
            !item.ended &&
            (!item.course?.length || item.course.some((course) => course.to >= today)),
        )
        .map((item) => ({
          title: keepUnits([item.name, item.dose, item.form].filter(Boolean).join(' ')),
          detail: [
            item.asNeeded
              ? 'По необходимости'
              : item.times
                  ?.map((slot) =>
                    [slot.time, slot.dose, slot.meal ? DIARY_MEAL_LABEL[slot.meal] : undefined]
                      .filter(Boolean)
                      .join(' '),
                  )
                  .join(' · '),
            item.schedule,
          ]
            .filter(Boolean)
            .join(' · '),
          instruction: [
            item.signa,
            item.course?.map((course) => `${course.from} — ${course.to}`).join(', '),
            tip(item.id),
          ]
            .filter(Boolean)
            .join('\n'),
        })),
    },
    {
      id: 'checks',
      title: 'Что отмечать',
      icon: 'list-checks',
      rows: (invitation.checkpoints ?? [])
        .filter((item) => !item.ended)
        .map((item) => ({
          title: item.label,
          detail:
            item.times?.join(' · ') ||
            (item.everyDays
              ? `Каждые ${item.everyDays} ${pluralize(item.everyDays, 'день', 'дня', 'дней')}`
              : 'В течение дня'),
          instruction: tip(item.id),
        })),
    },
    {
      id: 'assignments',
      title: 'Задания',
      icon: 'note-pencil',
      rows: (invitation.assignments ?? [])
        .filter((item) => !item.ended && (!item.until || item.until >= today))
        .map((item) => ({
          title: item.worksheet.title,
          detail: assignmentScheduleWords(item),
          instruction: [item.why, item.what, item.worksheet.patientNote].filter(Boolean).join('\n'),
        })),
    },
    {
      id: 'visits',
      title: 'Приёмы и анализы',
      icon: 'calendar',
      rows: [
        ...(invitation.appointments ?? [])
          .filter((item) => item.day >= today)
          .map((item) => ({
            title: 'Приём врача',
            detail: [item.day, item.time, item.place].filter(Boolean).join(' · '),
            instruction: item.note,
          })),
        ...(invitation.labs ?? []).map((item) => ({
          title: item.name,
          detail: item.by ? `До ${item.by}` : '',
          instruction: item.why,
        })),
      ],
    },
  ];
}

function PlanDetails(props: { readonly sections: readonly PlanSection[] }): JSX.Element {
  return (
    <For each={props.sections.filter((section) => section.rows.length)}>
      {(section) => (
        <section class="diary-plan-overview__group">
          <h3 class="diary-plan-overview__group-title">{section.title}</h3>
          <For each={section.rows}>
            {(row) => (
              <div class="diary-plan-overview__detail-row">
                <strong class="diary-plan-overview__row-title">{row.title}</strong>
                <Show when={row.detail}>
                  <span class="diary-plan-overview__secondary">{row.detail}</span>
                </Show>
                <Show when={row.instruction}>
                  <p class="diary-plan-overview__instruction">{row.instruction}</p>
                </Show>
              </div>
            )}
          </For>
        </section>
      )}
    </For>
  );
}

export function DiaryPlanGuide(props: {
  readonly invitation: DiaryInvitation;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <DiarySheet title="Ваш план" subtitle={props.invitation.doctor} onClose={props.onClose}>
      <DiaryPlanDetails invitation={props.invitation} />
    </DiarySheet>
  );
}

export function DiaryPlanDetails(props: { readonly invitation: DiaryInvitation }): JSX.Element {
  const sections = createMemo(() => planSections(props.invitation));
  return (
    <>
      <Show when={props.invitation.note}>
        <p class="diary-plan-overview__instruction">{props.invitation.note}</p>
      </Show>
      <PlanDetails sections={sections()} />
    </>
  );
}
