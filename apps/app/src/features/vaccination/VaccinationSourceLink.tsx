import type { JSX } from 'solid-js';

import {
  pdfPagesLabel,
  sourceOrderNumber,
  type VaccinationCalendar,
  type VaccinationSourceRef,
} from '@/features/vaccination/vaccination-calendar';

/** «Проверить по источнику»: the official PDF opened at the page the row is printed on. */
export function VaccinationSourceLink(props: {
  readonly calendar: VaccinationCalendar;
  readonly source: VaccinationSourceRef;
  /** What the row is, for the accessible name: «строка 4 приложения № 1». */
  readonly rowLabel: string;
}): JSX.Element {
  const pages = (): string => pdfPagesLabel(props.source.pdfPages);
  return (
    <span class="vax-source">
      <a
        class="vax-source__link"
        href={props.source.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Проверить по источнику: ${props.rowLabel}, приказ № ${sourceOrderNumber(
          props.calendar,
          props.source,
        )}, ${pages()} официального PDF`}
      >
        Проверить по источнику
      </a>
      <span class="vax-source__page">
        приказ № {sourceOrderNumber(props.calendar, props.source)}, {pages()}
      </span>
    </span>
  );
}
