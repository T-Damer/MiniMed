import type { MedicalDocument } from '@localmed/contracts';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  Show,
} from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Disclosure } from '@/components/Disclosure';
import { SheetPopover } from '@/components/SheetPopover';
import { type SickLeaveEntry, sickLeaveForCard } from '@/features/sick-leave/sick-leave-data';
import { createQuietResource } from '@/state/quiet-resource';
import {
  entryFootnotes,
  formatPeriod,
  HELP_TITLE,
  headerText,
  moreEntriesText,
  shownEntries,
  sickLeaveDocumentCodes,
} from '@/features/sick-leave/sick-leave-view';
import '@/features/sick-leave/sick-leave-panel.css';

function EntryRows(props: {
  readonly entry: SickLeaveEntry;
  /** The sub-heading above the entry when it differs from the previous entry's. */
  readonly group: string | null;
  readonly showTitle: boolean;
}): JSX.Element {
  const notes = createMemo(() => entryFootnotes(props.entry));
  return (
    <section class="sick-leave__entry">
      <Show when={props.group}>{(group) => <p class="sick-leave__group">{group()}</p>}</Show>
      <Show when={props.showTitle}>
        <h3 class="sick-leave__entry-heading">
          <span class="sick-leave__code">{props.entry.code}</span>
          {' · '}
          {props.entry.title}
          <Show when={notes().titleMark}>
            {(mark) => <sup class="sick-leave__mark">{mark()}</sup>}
          </Show>
        </h3>
      </Show>
      <ul class="sick-leave__rows">
        <For each={props.entry.periods}>
          {(row, index) => (
            <li
              class="sick-leave__row"
              classList={{ 'sick-leave__row--heading': row.period === '' }}
            >
              <span class="sick-leave__features">{row.features}</span>
              <Show when={row.period !== '' || notes().rowMarks[index()]}>
                <span class="sick-leave__period">
                  {row.period === '' ? '' : formatPeriod(row.period)}
                  <Show when={notes().rowMarks[index()]}>
                    {(mark) => <sup class="sick-leave__mark">{mark()}</sup>}
                  </Show>
                </span>
              </Show>
            </li>
          )}
        </For>
      </ul>
      <Show when={notes().texts.length > 0}>
        <ol class="sick-leave__footnotes">
          <For each={notes().texts}>
            {(text, index) => (
              <li>
                <sup class="sick-leave__mark">{index() + 1}</sup> {text}
              </li>
            )}
          </For>
        </ol>
      </Show>
    </section>
  );
}

/**
 * «Больничный: 9–11 дней» under the title of an ICD-10 card: the letter's recommended periods of
 * temporary incapacity for the card's code, folded. Nothing is shown for a code the letter does not
 * list, for a range, or when the asset cannot be read.
 */
export function SickLeavePanel(props: { readonly document: MedicalDocument }): JSX.Element {
  const codes = createMemo(() => sickLeaveDocumentCodes(props.document));
  const card = createQuietResource(
    () => (codes().length > 0 ? codes() : false),
    (list) => sickLeaveForCard(list),
  );
  const [helpOpen, setHelpOpen] = createSignal(false);
  createEffect(() => {
    const failure: unknown = card.error();
    if (failure)
      console.warn(
        'Сроки нетрудоспособности не загрузились.',
        failure instanceof Error ? failure.name : 'unknown',
      );
  });
  const shown = createMemo(() => shownEntries(card.value()?.results ?? []));
  return (
    <Show when={shown().entries.length > 0 ? card.value()?.letter : undefined}>
      {(letter) => (
        <section class="sick-leave" data-testid="sick-leave-panel">
          <Disclosure
            title={
              <span class="sick-leave__title">{headerText(shown().entries, shown().rest)}</span>
            }
          >
            <div class="sick-leave__body">
              <For each={shown().entries}>
                {(entry, index) => (
                  <EntryRows
                    entry={entry}
                    group={
                      entry.group !== null && entry.group !== shown().entries[index() - 1]?.group
                        ? entry.group
                        : null
                    }
                    showTitle={shown().entries.length > 1 || shown().rest > 0}
                  />
                )}
              </For>
              <Show when={shown().rest > 0}>
                <p class="sick-leave__group">{moreEntriesText(shown().rest)}</p>
              </Show>
              <div class="sick-leave__footer">
                <p class="sick-leave__source">{letter().source.reference}</p>
                <SheetPopover
                  open={helpOpen()}
                  onOpenChange={setHelpOpen}
                  title={HELP_TITLE}
                  triggerClass="sick-leave__help-button"
                  triggerLabel={HELP_TITLE}
                  triggerTitle={HELP_TITLE}
                  trigger={<AppGlyph name="question" class="sick-leave__help-icon" />}
                  contentClass="sick-leave__help-panel"
                  placement="bottom-end"
                >
                  <div class="sick-leave__help-body">
                    <p class="sick-leave__help-text">{letter().notes.advisory}</p>
                    <p class="sick-leave__help-text">{letter().notes.deviation}</p>
                  </div>
                </SheetPopover>
              </div>
            </div>
          </Disclosure>
        </section>
      )}
    </Show>
  );
}
