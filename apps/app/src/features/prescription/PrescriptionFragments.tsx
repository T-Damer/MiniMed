import { createMemo, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Disclosure } from '@/components/Disclosure';
import { QuoteBlock } from '@/features/medication-safety/SafetyBlocks';
import { CARD_NOTICE, type IntentView } from '@/features/medication-safety/safety-view';
import { pluralRu } from '@/i18n/labels';
import { buildOfficialDocumentHash } from '@/state/document-route';
import type { ResolvedRule } from './dose-document';
import { type FragmentGroup, foldedFragments, fragmentCount } from './prescription-fragments';
import { type ItemAnalysis, indicationLabel, populationText } from './prescription-model';
import { ageText } from './prescription-safety';
import '@/styles/prescription.css';

/** The sentence a number or a quotation comes from, with the way into the instruction. */
export function RuleQuote(props: {
  readonly documentId: string;
  readonly resolved: ResolvedRule;
  /** In the fold the section is the group heading: the line keeps only the link. */
  readonly inGroup?: boolean;
  /** The sentence is the patient's own: why («по возрасту и массе»). */
  readonly fitMark?: string | undefined;
}): JSX.Element {
  return (
    <blockquote
      class="prescription__quote"
      classList={{ 'prescription__quote--fit': props.fitMark !== undefined }}
      data-testid="prescription-quote"
    >
      <Show when={props.fitMark}>
        {(mark) => (
          <p class="prescription__quote-fit" data-testid="prescription-quote-fit">
            <AppGlyph name="check" class="prescription__quote-fit-icon" />
            Подходит пациенту {mark()}
          </p>
        )}
      </Show>
      <Show when={props.resolved.context}>
        {(context) => <p class="prescription__quote-context">{context()}</p>}
      </Show>
      <p class="prescription__quote-text">{props.resolved.quote}</p>
      <p class="prescription__quote-source">
        <Show when={props.inGroup !== true}>{props.resolved.sectionTitle}</Show>
        <Show when={props.resolved.anchor}>
          {(anchor) => (
            <>
              <Show when={props.inGroup !== true}>{' · '}</Show>
              <a
                class="prescription__link"
                href={buildOfficialDocumentHash(props.documentId, anchor())}
              >
                Открыть в инструкции
              </a>
            </>
          )}
        </Show>
      </p>
    </blockquote>
  );
}

function FragmentRows(props: {
  readonly documentId: string;
  readonly groups: readonly FragmentGroup[];
  readonly onPick: (key: string) => void;
}): JSX.Element {
  return (
    <For each={props.groups}>
      {(group) => (
        <section class="prescription__fragment-group" data-testid="prescription-fragment-group">
          <h5 class="prescription__fragment-section">{group.title}</h5>
          <For each={group.fragments}>
            {(fragment) => (
              <div class="prescription__fragment" data-kind={fragment.kind}>
                <Show when={fragment.option}>
                  {(option) => (
                    <button
                      type="button"
                      class="prescription__fragment-pick"
                      data-testid="prescription-rule-option"
                      onClick={() => props.onPick(option().key)}
                    >
                      <AppGlyph name="circle" />
                      <span class="prescription__rule-summary">
                        {option().summary}
                        <Show when={populationText(option().resolved.rule)}>
                          {(who) => <span class="prescription__rule-who">{who()}</span>}
                        </Show>
                        <Show when={indicationLabel(option())}>
                          {(why) => <span class="prescription__rule-indication">{why()}</span>}
                        </Show>
                      </span>
                    </button>
                  )}
                </Show>
                <Show when={fragment.note}>
                  {(note) => <p class="prescription__note">{note()}</p>}
                </Show>
                <RuleQuote
                  documentId={props.documentId}
                  resolved={fragment.resolved}
                  fitMark={fragment.fitMark}
                  inGroup
                />
              </div>
            )}
          </For>
        </section>
      )}
    </For>
  );
}

/**
 * «Ещё N фрагментов из инструкции»: every dose sentence that is not the answer, once, grouped by
 * section. A fragment that is another computable rule for the patient can be picked.
 */
export function FragmentsDisclosure(props: {
  readonly analysis: ItemAnalysis;
  readonly documentId: string;
  readonly open: boolean;
  readonly onPick: (key: string) => void;
}): JSX.Element {
  const groups = createMemo(() => foldedFragments(props.analysis));
  const count = (): number => fragmentCount(groups());
  return (
    <Show when={count() > 0}>
      <Disclosure
        variant="inline"
        class="prescription__fragments"
        defaultOpen={props.open}
        title={`Ещё ${count()} ${pluralRu(count(), 'фрагмент', 'фрагмента', 'фрагментов')} из инструкции`}
      >
        <div class="prescription__fragment-list" data-testid="prescription-fragments">
          <FragmentRows documentId={props.documentId} groups={groups()} onPick={props.onPick} />
        </div>
      </Disclosure>
    </Show>
  );
}

/** Calculated lines shown beside a view at most; the rest sit with the quotations. */
const VISIBLE_LINES = 3;

/**
 * What the instruction says about the patient's state (age limits, pregnancy, feeding): the
 * calculated lines and what is not said in a short list, the quotations behind one disclosure.
 */
export function SafetySummary(props: {
  readonly views: readonly IntentView[];
  readonly documentId: string;
  readonly ageDays: number | undefined;
}): JSX.Element {
  const quoteCount = createMemo(() =>
    props.views.reduce(
      (sum, view) => sum + view.groups.reduce((inner, group) => inner + group.quotes.length, 0),
      0,
    ),
  );
  return (
    <section class="prescription__safety" data-testid="prescription-safety">
      <h4 class="prescription__safety-title">
        Из инструкции о состоянии пациента
        <Show when={props.ageDays !== undefined}>
          {' · '}
          {ageText(props.ageDays ?? 0)}
        </Show>
      </h4>
      <ul class="prescription__safety-list">
        <For each={props.views}>
          {(view) => (
            <li class="prescription__safety-item" data-intent={view.intent}>
              <span class="prescription__safety-intent">{view.title}</span>
              <Show when={view.nothingSaid}>
                <span class="prescription__note">В инструкции об этом не сказано</span>
              </Show>
              <For each={view.ageSummary.slice(0, VISIBLE_LINES)}>
                {(line) => (
                  <span class="prescription__safety-line" data-relation={line.relation}>
                    {line.text}
                  </span>
                )}
              </For>
            </li>
          )}
        </For>
      </ul>
      <Show when={quoteCount() > 0}>
        <Disclosure
          variant="inline"
          title="Цитаты из инструкции"
          meta={<span>{quoteCount()}</span>}
        >
          <p class="prescription__note">{CARD_NOTICE}</p>
          <For each={props.views}>
            {(view) => (
              <div class="prescription__safety-view" data-intent={view.intent}>
                <h5 class="prescription__safety-intent">{view.title}</h5>
                <For each={view.ageSummary}>
                  {(line) => (
                    <p class="prescription__note" data-relation={line.relation}>
                      {line.text} («{line.words}», {line.sectionLabel})
                    </p>
                  )}
                </For>
                <For each={view.groups}>
                  {(group) => (
                    <For each={group.quotes}>
                      {(quote) => <QuoteBlock documentId={props.documentId} quote={quote} />}
                    </For>
                  )}
                </For>
              </div>
            )}
          </For>
        </Disclosure>
      </Show>
    </section>
  );
}
