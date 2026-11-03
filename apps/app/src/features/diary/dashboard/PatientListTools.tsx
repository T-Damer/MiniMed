import { createMemo, type JSX } from 'solid-js';

import {
  AppContextMenu,
  type AppContextMenuAction,
  requestContextMenu,
} from '@/components/AppContextMenu';
import { AppGlyph } from '@/components/AppGlyph';
import { SearchField } from '@/components/SearchField';
import { PATIENT_ORDER_LABEL, type PatientOrder } from '@/features/diary/dashboard/patient-order';

const ORDER_TITLE: Readonly<Record<PatientOrder, string>> = {
  patient: 'Пациент · по последней записи',
  doctor: 'Врач · по правкам плана',
  name: 'А–Я · по имени',
};

/**
 * The search above the patient list and, at its right, the button that opens the order's menu
 * (owner 2026-11-03: the «Пациент / Врач / А–Я» switch became a menu). The text the doctor types
 * is passed on as it comes; the list debounces it.
 */
export function PatientListTools(props: {
  readonly query: string;
  readonly onQuery: (value: string) => void;
  readonly placeholder: string;
  readonly order: PatientOrder;
  readonly onOrder: (order: PatientOrder) => void;
}): JSX.Element {
  const actions = createMemo((): readonly AppContextMenuAction[] =>
    (['patient', 'doctor', 'name'] as const).map((order) => ({
      id: order,
      label: ORDER_TITLE[order],
      icon: props.order === order ? 'check' : 'circle',
      testId: `diary-order-${order}`,
      onSelect: () => props.onOrder(order),
    })),
  );
  return (
    <div class="diary-list-tools">
      <SearchField
        class="diary-list-tools__search"
        label="Поиск пациента"
        hideLabel
        type="search"
        placeholder={props.placeholder}
        value={props.query}
        onInput={props.onQuery}
        onClear={() => props.onQuery('')}
        autocomplete="off"
      />
      <AppContextMenu actions={actions()} hideButton class="diary-list-tools__menu">
        <button
          type="button"
          class="diary-list-tools__sort"
          aria-label={`Порядок списка: ${PATIENT_ORDER_LABEL[props.order]}`}
          title="Порядок списка"
          onClick={requestContextMenu}
        >
          <AppGlyph name="sliders-horizontal" class="diary-list-tools__sort-icon" />
        </button>
      </AppContextMenu>
    </div>
  );
}
