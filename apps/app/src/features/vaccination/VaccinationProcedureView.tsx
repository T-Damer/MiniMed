import { For, type JSX, Show } from 'solid-js';
import { VaccinationSourceLink } from '@/features/vaccination/VaccinationSourceLink';
import type {
  ProcedureItem,
  VaccinationCalendar,
} from '@/features/vaccination/vaccination-calendar';

/** One paragraph of Appendix 3 with its footnote and source page. */
export function VaccinationProcedureParagraph(props: {
  readonly calendar: VaccinationCalendar;
  readonly item: ProcedureItem;
}): JSX.Element {
  return (
    <article class="vax-procedure__item" data-item-id={props.item.id}>
      <For each={props.item.blocks}>
        {(block, index) => (
          <p class="vax-procedure__text">
            <Show when={index() === 0}>
              <span class="vax-procedure__number">{props.item.number}.</span>{' '}
            </Show>
            {block}
          </p>
        )}
      </For>
      <Show when={props.item.footnote}>
        {(footnote) => (
          <p class="vax-procedure__footnote">
            <sup>{footnote().number}</sup> {footnote().text}
          </p>
        )}
      </Show>
      <Show when={props.item.amendedBy}>
        <p class="vax-procedure__amended">В редакции приказа № {props.item.amendedBy}.</p>
      </Show>
      <VaccinationSourceLink
        calendar={props.calendar}
        source={props.item.source}
        rowLabel={`пункт ${props.item.number} приложения № 3`}
      />
    </article>
  );
}
