import { For, type JSX } from 'solid-js';

import '@/components/page-skeleton.css';
import '@/components/PatientRowsSkeleton.css';

/**
 * A list of patients while it loads: rows shaped like the coming ones — an avatar, a name and a
 * detail line (AGENTS.md «Loading is one state», «Never a lone spinner»). The diaries' list and the
 * patient vault, while it opens, show the same rows.
 */
export function PatientRowsSkeleton(props: {
  /** Says what is loading to assistive technology; nothing is printed on screen. */
  readonly label: string;
  readonly testId?: string;
}): JSX.Element {
  return (
    <ul
      class="patient-rows-skeleton"
      role="status"
      aria-busy="true"
      aria-label={props.label}
      data-testid={props.testId}
    >
      <For each={[72, 56, 64]}>
        {(width) => (
          <li class="patient-rows-skeleton__row" aria-hidden="true">
            <span class="patient-rows-skeleton__avatar" />
            <span class="patient-rows-skeleton__lines">
              <span class="page-skeleton__bar" style={{ width: `${width}%` }} />
              <span class="page-skeleton__bar patient-rows-skeleton__meta" />
            </span>
          </li>
        )}
      </For>
    </ul>
  );
}
