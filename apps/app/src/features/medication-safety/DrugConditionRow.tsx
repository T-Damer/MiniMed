import type { MedicalDocument } from '@localmed/contracts';
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { OverlayDialog } from '@/components/OverlayDialog';
import { jumpReaderTo } from '@/features/library/document-reader-scroll';
import { buildOfficialDocumentHash } from '@/state/document-route';
import {
  CONDITION_LABELS,
  CONDITION_SHORT_LABELS,
  type ConditionFinding,
  type ConditionId,
  type ConditionMention,
  documentConditions,
  LEVEL_LABELS,
} from './drug-conditions';
import '@/features/medication-safety/drug-conditions.css';

const CONDITION_GLYPHS: Readonly<Record<ConditionId, AppGlyphName>> = {
  pregnancy: 'pregnant',
  lactation: 'drop',
  children: 'baby',
  elderly: 'elderly',
  liver: 'liver',
  kidney: 'kidney',
  driving: 'steering-wheel',
};

/** The sentences of one condition, grouped by the section they were found in. */
function bySection(
  mentions: readonly ConditionMention[],
): readonly { title: string; mentions: readonly ConditionMention[] }[] {
  const groups = new Map<string, ConditionMention[]>();
  for (const mention of mentions) {
    const list = groups.get(mention.sectionTitle) ?? [];
    list.push(mention);
    groups.set(mention.sectionTitle, list);
  }
  return [...groups].map(([title, list]) => ({ title, mentions: list }));
}

/**
 * The condition row of a drug card («как у Видаля», owner 2026-11-03): pregnancy, breastfeeding,
 * children, the elderly, liver, kidneys, driving — red, amber, green or grey from the instruction
 * open on screen (`drug-conditions.ts`). A tap opens a sheet with the sentences behind the colour.
 */
export function DrugConditionRow(props: { readonly document: MedicalDocument }): JSX.Element {
  const findings = createMemo(() => documentConditions(props.document) ?? []);
  const [openId, setOpenId] = createSignal<ConditionId | null>(null);
  const open = createMemo(() => findings().find((finding) => finding.id === openId()) ?? null);
  const hasAnything = () => findings().some((finding) => finding.mentions.length > 0);

  const badge = (finding: ConditionFinding, small = false): JSX.Element => (
    <span
      class={`drug-conditions__badge drug-conditions__badge--${finding.level}`}
      classList={{ 'drug-conditions__badge--small': small }}
    >
      <AppGlyph name={CONDITION_GLYPHS[finding.id]} class="drug-conditions__glyph" />
    </span>
  );

  return (
    <Show when={hasAnything()}>
      <ul class="drug-conditions" data-testid="drug-conditions">
        <For each={findings()}>
          {(finding) => (
            <li class="drug-conditions__cell">
              <button
                type="button"
                class="drug-conditions__item"
                aria-label={`${CONDITION_LABELS[finding.id]}: ${finding.summary}`}
                title={`${CONDITION_LABELS[finding.id]}: ${finding.summary}`}
                data-condition={finding.id}
                data-level={finding.level}
                onClick={() => setOpenId(finding.id)}
              >
                {badge(finding)}
                <span class="drug-conditions__label">{CONDITION_SHORT_LABELS[finding.id]}</span>
              </button>
            </li>
          )}
        </For>
      </ul>
      <OverlayDialog
        open={open() !== null}
        title={open() ? CONDITION_LABELS[open()?.id ?? 'pregnancy'] : ''}
        class="drug-conditions-sheet"
        onClose={() => setOpenId(null)}
      >
        <Show when={open()}>
          {(finding) => (
            <div class="drug-conditions-sheet__body" data-testid="drug-conditions-sheet">
              <div class="drug-conditions-sheet__switch" role="tablist">
                <For each={findings()}>
                  {(other) => (
                    <button
                      type="button"
                      role="tab"
                      class="drug-conditions-sheet__tab"
                      classList={{
                        'drug-conditions-sheet__tab--active': other.id === finding().id,
                      }}
                      aria-selected={other.id === finding().id}
                      aria-label={CONDITION_LABELS[other.id]}
                      onClick={() => setOpenId(other.id)}
                    >
                      {badge(other, true)}
                    </button>
                  )}
                </For>
              </div>
              <p
                class={`drug-conditions-sheet__verdict drug-conditions-sheet__verdict--${finding().level}`}
              >
                {finding().summary}
              </p>
              <Show
                when={finding().mentions.length > 0}
                fallback={
                  <p class="drug-conditions-sheet__empty">В инструкции об этом не сказано</p>
                }
              >
                <For each={bySection(finding().mentions)}>
                  {(group) => (
                    <section class="drug-conditions-sheet__group">
                      <h3 class="drug-conditions-sheet__section">{group.title}</h3>
                      <For each={group.mentions}>
                        {(mention) => (
                          <a
                            class="drug-conditions-sheet__quote"
                            href={buildOfficialDocumentHash(
                              props.document.id,
                              mention.anchor ?? undefined,
                            )}
                            onClick={(event) => {
                              const anchor = mention.anchor;
                              if (!anchor || event.button !== 0 || event.metaKey || event.ctrlKey)
                                return;
                              // The paragraph is in the text under the sheet: close it and scroll
                              // there, without a new history entry.
                              event.preventDefault();
                              setOpenId(null);
                              jumpReaderTo(() => document.getElementById(anchor), {
                                align: 'start',
                              });
                            }}
                          >
                            <span
                              class={`drug-conditions-sheet__dot drug-conditions-sheet__dot--${mention.level ?? 'unknown'}`}
                              title={mention.level ? LEVEL_LABELS[mention.level] : undefined}
                            />
                            <span class="drug-conditions-sheet__text">{mention.text}</span>
                          </a>
                        )}
                      </For>
                    </section>
                  )}
                </For>
              </Show>
            </div>
          )}
        </Show>
      </OverlayDialog>
    </Show>
  );
}
