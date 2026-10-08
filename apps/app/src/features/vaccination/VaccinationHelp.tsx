import { For, type JSX } from 'solid-js';

import { Disclosure } from '@/components/Disclosure';
import { VaccinationProcedureParagraph } from '@/features/vaccination/VaccinationProcedureView';
import type { VaccinationCalendar } from '@/features/vaccination/vaccination-calendar';

/** Behind the header «?»: how the table works, how dates are counted, the order of procedure. */
export function VaccinationHelp(props: { readonly calendar: VaccinationCalendar }): JSX.Element {
  return (
    <>
      <p class="vax-help__text">
        Нажмите на ячейку: сделана, затем запланирована, затем снова пусто. Удерживайте ячейку или
        нажмите на возраст — дата, текст приказа и страница PDF.
      </p>
      <p class="vax-help__text">
        V — вакцинация, RV — ревакцинация, цифра — номер прививки, * — для групп риска. Прививка
        сразу от нескольких инфекций отмечается один раз.
      </p>
      <p class="vax-help__text">
        Даты считаются от даты рождения по возрасту из приказа; сроков и интервалов приказ не
        называет, их определяет врач. Месяцы календарные, «4,5 месяца» — 4 месяца и 15 дней (≈).
      </p>
      <p class="vax-help__text">
        С карточкой пациента отметки сохраняются в ней; по одной дате рождения — только на этой
        странице.
      </p>
      <Disclosure variant="inline" title="Порядок проведения прививок (приложение № 3)">
        <For each={props.calendar.procedure.items}>
          {(item) => <VaccinationProcedureParagraph calendar={props.calendar} item={item} />}
        </For>
      </Disclosure>
    </>
  );
}
