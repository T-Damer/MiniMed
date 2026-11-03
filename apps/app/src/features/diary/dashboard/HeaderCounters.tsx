import { For, type JSX } from 'solid-js';

import { RollingNumber } from '@/components/RollingNumber';
import { pluralize } from '@/diary/diary-format';
import type { PatientCounters, PatientFilter } from '@/features/diary/dashboard/patient-list';

interface CounterSpec {
  readonly id: PatientFilter;
  readonly label: string;
  /** What the counter says to a screen reader and in the tooltip. */
  readonly spoken: (count: number) => string;
}

const COUNTERS: readonly CounterSpec[] = [
  {
    id: 'urgent',
    label: 'Срочные',
    spoken: (count) => `Срочные отметки: ${count}`,
  },
  {
    id: 'today',
    label: 'Сегодня',
    spoken: (count) =>
      `Записали сегодня: ${count} ${pluralize(count, 'пациент', 'пациента', 'пациентов')}`,
  },
  {
    id: 'silent',
    label: 'Давно нет',
    spoken: (count) =>
      `Не отмечались больше двух дней: ${count} ${pluralize(count, 'пациент', 'пациента', 'пациентов')}`,
  },
];

/**
 * The day's numbers in the header's room: urgent marks, who wrote today, who has been silent for
 * two days. Each is a toggle that filters the list below; the numbers roll when they change.
 */
export function HeaderCounters(props: {
  readonly counters: PatientCounters;
  readonly active: PatientFilter | undefined;
  readonly onToggle: (filter: PatientFilter) => void;
}): JSX.Element {
  return (
    <div class="diary-counters">
      <For each={COUNTERS}>
        {(spec) => {
          const count = (): number => props.counters[spec.id];
          return (
            <button
              type="button"
              class="diary-counters__chip"
              classList={{
                'diary-counters__chip--urgent': spec.id === 'urgent' && count() > 0,
                'diary-counters__chip--active': props.active === spec.id,
                'diary-counters__chip--empty': count() === 0 && props.active !== spec.id,
              }}
              aria-pressed={props.active === spec.id}
              aria-label={spec.spoken(count())}
              title={spec.spoken(count())}
              onClick={() => props.onToggle(spec.id)}
            >
              <span class="diary-counters__label">{spec.label}</span>
              <RollingNumber value={count()} class="diary-counters__count" />
            </button>
          );
        }}
      </For>
    </div>
  );
}
