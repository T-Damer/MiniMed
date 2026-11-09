/**
 * The doctor's «Лекарства раньше» on the patient page (MEDHIST1): one compact row that names what
 * matters (allergies, intolerance) and opens the list to read and edit. A reader sees, not edits.
 */
import { createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { OverlayDialog } from '@/components/OverlayDialog';
import {
  PAST_MED_CONCERN_LABEL,
  type PastMedConcern,
  type PastMedDraft,
  type PastMedication,
  pastMedConcern,
  pastMedWhenWords,
} from '@/features/diary/diary-med-history';
import { MedHistoryList, MedHistoryPanel } from '@/features/diary/med-history/MedHistory';
import { draftFromRemoval, type PlanRemoval } from '@/features/diary/med-history/plan-removals';

import '@/features/diary/med-history/med-history.css';

function pluralMedicines(count: number): string {
  const tens = count % 100;
  const ones = count % 10;
  if (tens >= 11 && tens <= 14) return 'препаратов';
  if (ones === 1) return 'препарат';
  if (ones >= 2 && ones <= 4) return 'препарата';
  return 'препаратов';
}

/** «Аллергия: амоксициллин · Непереносимость: рисперидон». */
export function concernSummary(items: readonly PastMedication[]): string {
  const groups = new Map<PastMedConcern, string[]>();
  for (const item of items) {
    const concern = pastMedConcern(item);
    if (concern !== 'allergy' && concern !== 'intolerance') continue;
    groups.set(concern, [...(groups.get(concern) ?? []), item.name.toLocaleLowerCase('ru-RU')]);
  }
  return [...groups]
    .map(([concern, names]) => `${PAST_MED_CONCERN_LABEL[concern]}: ${names.join(', ')}`)
    .join(' · ');
}

export function MedHistoryCard(props: {
  readonly items: readonly PastMedication[];
  readonly canEdit: boolean;
  readonly onSave: (item: PastMedication) => Promise<void>;
  readonly onDelete: (id: string) => Promise<void>;
  /** Medicines just taken off the plan: each offered for the history. */
  readonly offers: readonly PlanRemoval[];
  readonly onDismiss: (removal: PlanRemoval) => void;
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [start, setStart] = createSignal<PastMedDraft>();
  const concerns = () => concernSummary(props.items);
  const close = (): void => {
    setOpen(false);
    setStart(undefined);
  };
  return (
    <>
      <button
        type="button"
        class="med-history-card"
        classList={{ 'med-history-card--concern': Boolean(concerns()) }}
        data-testid="med-history-card"
        onClick={() => setOpen(true)}
      >
        <AppGlyph
          name={concerns() ? 'warning' : 'pill'}
          class={`med-history-card__icon${concerns() ? ' med-history-card__icon--concern' : ''}`}
        />
        <span class="med-history-card__text">
          <span class="med-history-card__title">
            Лекарства раньше
            <span class="med-history-card__count">
              {props.items.length
                ? `${props.items.length} ${pluralMedicines(props.items.length)}`
                : 'нет записей'}
            </span>
          </span>
          <Show when={concerns()}>
            <span class="med-history-card__concerns">{concerns()}</span>
          </Show>
        </span>
        <AppGlyph name="caret-right" class="med-history-card__chevron" />
      </button>
      <Show when={props.canEdit && props.offers.length}>
        <ul class="med-history-offers" aria-label="Убраны из плана">
          <For each={props.offers}>
            {(removal) => (
              <li class="med-history-offers__item" data-testid="med-history-offer">
                <AppGlyph name="history" class="med-history-offers__icon" />
                <span class="med-history-offers__text">
                  <strong class="med-history-offers__name">{removal.item.name}</strong> убран из
                  плана {pastMedWhenWords(removal.removedOn)} — перенести в историю?
                </span>
                <Button
                  variant="secondary"
                  class="med-history-offers__move"
                  data-testid="med-history-offer-move"
                  onClick={() => {
                    setStart(draftFromRemoval(removal));
                    setOpen(true);
                  }}
                >
                  Перенести
                </Button>
                <Button
                  variant="icon"
                  aria-label="Не переносить"
                  icon={<AppGlyph name="close" class="med-history-offers__icon" />}
                  onClick={() => props.onDismiss(removal)}
                />
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={open()}>
        <OverlayDialog open title="Лекарства раньше" onClose={close}>
          <Show
            when={props.canEdit}
            fallback={
              <Show
                when={props.items.length}
                fallback={<p class="med-history__empty-text">Прошлых препаратов пока нет.</p>}
              >
                <MedHistoryList items={props.items} viewer="doctor" showAuthor />
              </Show>
            }
          >
            <MedHistoryPanel
              items={props.items}
              author="doctor"
              viewer="doctor"
              start={start()}
              onSave={props.onSave}
              onDelete={props.onDelete}
              onDone={close}
            />
          </Show>
        </OverlayDialog>
      </Show>
    </>
  );
}
