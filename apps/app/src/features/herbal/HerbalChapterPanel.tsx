import { createSignal, For, type JSX, Show } from 'solid-js';

import { SheetPopover } from '@/components/SheetPopover';
import {
  courseLongerThanEma,
  type EmaQuote,
  emaDoseLine,
  emaSourceLabel,
  evidenceLabel,
  factLabel,
  factsOfKind,
  type HerbalChapter,
  type HerbalLookalike,
  limitFacts,
  type QuotedValue,
  useTypeLabel,
} from './herbal-chapter';

/**
 * The top of a herbal chapter in the reader: how to brew (ГРЛС numbers), who must not take it
 * and the EMA doses and constituents. Every value opens the sentence it was read from — the
 * Russian instruction sentence or the English EMA quote with its document and page.
 */

function capitalize(value: string): string {
  return value.charAt(0).toLocaleUpperCase('ru') + value.slice(1);
}

interface QuoteSource {
  readonly quote: string;
  readonly label: string;
  readonly url: string | null;
  readonly english: boolean;
}

function QuoteCell(props: {
  readonly label: string;
  readonly value: string;
  readonly source: QuoteSource;
  readonly wide?: boolean;
  /** A short mark under the value: the evidence level, or a conflict with the other source. */
  readonly note?: string;
  readonly warn?: boolean;
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  return (
    <SheetPopover
      open={open()}
      onOpenChange={setOpen}
      title={props.label}
      triggerClass="herbal-cell"
      triggerClassList={{
        'herbal-cell--wide': props.wide === true,
        'herbal-cell--warn': props.warn === true,
      }}
      triggerLabel={`${props.label}: ${props.value}. Показать источник`}
      contentClass="herbal-quote"
      trigger={
        <>
          <span class="herbal-cell__label">{props.label}</span>
          <span class="herbal-cell__value">{props.value}</span>
          <Show when={props.note}>
            {(note) => (
              <span
                class="herbal-cell__note"
                classList={{ 'herbal-cell__note--warn': props.warn === true }}
              >
                {note()}
              </span>
            )}
          </Show>
        </>
      }
    >
      <blockquote class="herbal-quote__text" lang={props.source.english ? 'en' : 'ru'}>
        {props.source.quote}
      </blockquote>
      <Show
        when={props.source.url}
        fallback={<span class="herbal-quote__source">{props.source.label}</span>}
      >
        {(url) => (
          <a class="herbal-quote__source" href={url()} target="_blank" rel="noreferrer">
            {props.source.label}
          </a>
        )}
      </Show>
    </SheetPopover>
  );
}

export function HerbalChapterPanel(props: { readonly chapter: HerbalChapter }): JSX.Element {
  const ema = () => props.chapter.ema;
  const grlsSource = (value: QuotedValue): QuoteSource => ({
    quote: value.quote,
    label: 'Инструкция ГРЛС',
    url: null,
    english: false,
  });
  const emaSource = (item: EmaQuote): QuoteSource => ({
    quote: item.quote,
    label: emaSourceLabel(item),
    url: ema()?.documents[item.doc] ?? null,
    english: true,
  });
  interface BrewCell {
    readonly label: string;
    readonly value: QuotedValue;
    readonly wide?: boolean;
    readonly conflict?: boolean;
  }
  const brewCells = (): readonly BrewCell[] => {
    const brew = props.chapter.brew;
    const cells: {
      label: string;
      value: QuotedValue | null;
      wide?: boolean;
      conflict?: boolean;
    }[] = [
      { label: 'Сырьё', value: brew.herb },
      { label: 'Вода', value: brew.water },
      { label: 'Баня', value: brew.heat },
      { label: 'Настоять', value: brew.steep },
      { label: 'Сколько раз', value: brew.times },
      { label: 'Курс', value: brew.course, conflict: courseLongerThanEma(props.chapter) },
      { label: 'Разовая доза', value: brew.dose, wide: true },
    ];
    return cells.flatMap((cell) =>
      cell.value
        ? [
            {
              label: cell.label,
              value: cell.value,
              ...(cell.wide ? { wide: true } : {}),
              ...(cell.conflict ? { conflict: true } : {}),
            },
          ]
        : [],
    );
  };
  const posology = () => factsOfKind(ema(), 'posology');
  const indications = () => factsOfKind(ema(), 'indication');
  const limits = () => limitFacts(ema());
  const constituents = () => ema()?.constituents ?? [];

  const emaLookalikes = () => factsOfKind(ema(), 'lookalike');
  const sourceLookalikes = () => props.chapter.identification?.lookalikes ?? [];
  const lookalikeKey = () => props.chapter.identification?.key ?? null;
  const lookalikeLabel = (item: HerbalLookalike): string =>
    item.poisonous ? 'Ядовито' : item.source === 'gf' ? 'ГФ' : 'Пособие';
  const lookalikeSource = (item: HerbalLookalike): QuoteSource =>
    item.source === 'gf'
      ? {
          quote: item.text,
          label: props.chapter.identification?.sourceLabel ?? 'ГФ',
          url: props.chapter.identification?.url ?? null,
          english: false,
        }
      : { quote: item.text, label: item.sourceLabel ?? 'Пособие', url: null, english: false };
  const lookalikesBlock = (): JSX.Element => (
    <Show when={emaLookalikes().length + sourceLookalikes().length > 0}>
      <h2 class="herbal-chapter__heading">Не спутать</h2>
      <div class="herbal-chapter__cells">
        <Show when={lookalikeKey()}>
          {(key) => (
            <QuoteCell
              label="Признак"
              value={key().text}
              source={{ quote: key().text, label: key().sourceLabel, url: null, english: false }}
              wide
            />
          )}
        </Show>
        <For each={emaLookalikes()}>
          {(fact) => <QuoteCell label="EMA" value={fact.ru} source={emaSource(fact)} wide warn />}
        </For>
        <For each={sourceLookalikes()}>
          {(item) => (
            <QuoteCell
              label={lookalikeLabel(item)}
              value={item.name}
              source={lookalikeSource(item)}
              wide
              warn={item.poisonous}
            />
          )}
        </For>
      </div>
    </Show>
  );

  const limitsFirst = (): boolean => ema()?.useType === 'public-statement';
  const limitsBlock = (): JSX.Element => (
    <Show when={limits().length > 0}>
      <h2 class="herbal-chapter__heading">
        {limitsFirst() ? 'Позиция EMA' : 'Кому нельзя'}
        <Show when={ema()?.draft}>
          <span class="herbal-chapter__tag herbal-chapter__tag--draft">черновик</span>
        </Show>
      </h2>
      <div class="herbal-chapter__cells">
        <For each={limits()}>
          {(fact) => (
            <QuoteCell label={factLabel(fact.kind)} value={fact.ru} source={emaSource(fact)} wide />
          )}
        </For>
      </div>
    </Show>
  );

  return (
    <section class="herbal-chapter" aria-label="Кратко">
      <p class="herbal-chapter__identity">
        <em class="herbal-chapter__latin">{props.chapter.latin}</em>
        {` · ${props.chapter.family} · ${props.chapter.partRu}`}
      </p>
      <Show when={props.chapter.actions.length > 0}>
        <ul class="herbal-chapter__actions">
          <For each={props.chapter.actions}>
            {(action) => <li class="herbal-chapter__action">{action}</li>}
          </For>
        </ul>
      </Show>

      {/* EMA found no safe oral use (a public statement): its verdict comes before the recipe. */}
      <Show when={limitsFirst()}>{limitsBlock()}</Show>
      <Show when={brewCells().length > 0}>
        <h2 class="herbal-chapter__heading">
          Как заварить
          <Show when={props.chapter.brew.kind}>
            {(kind) => <span class="herbal-chapter__tag">{kind()}</span>}
          </Show>
          <Show when={props.chapter.grlsOcr}>
            <span class="herbal-chapter__tag herbal-chapter__tag--muted">скан</span>
          </Show>
        </h2>
        <div class="herbal-chapter__cells">
          <For each={brewCells()}>
            {(cell) => (
              <QuoteCell
                label={cell.label}
                value={cell.value.value}
                source={grlsSource(cell.value)}
                {...(cell.wide ? { wide: true } : {})}
                {...(cell.conflict ? { note: 'EMA: короче', warn: true } : {})}
              />
            )}
          </For>
        </div>
      </Show>
      <Show when={!limitsFirst()}>{limitsBlock()}</Show>
      {lookalikesBlock()}
      <Show when={posology().length > 0}>
        <h2 class="herbal-chapter__heading">
          Дозы EMA
          <Show when={useTypeLabel(ema()?.useType ?? null)}>
            {(label) => (
              <span class="herbal-chapter__tag herbal-chapter__tag--muted">{label()}</span>
            )}
          </Show>
        </h2>
        <div class="herbal-chapter__cells">
          <For each={posology()}>
            {(fact) => (
              <QuoteCell
                label={fact.dose ? capitalize(fact.dose.populationRu) : 'Как принимать'}
                value={
                  fact.dose
                    ? [fact.dose.preparationRu, emaDoseLine(fact.dose)].filter(Boolean).join(': ')
                    : fact.ru
                }
                source={emaSource(fact)}
                wide
              />
            )}
          </For>
        </div>
      </Show>

      <Show when={indications().length > 0}>
        <h2 class="herbal-chapter__heading">Показания EMA</h2>
        <div class="herbal-chapter__cells">
          <For each={indications()}>
            {(fact) => (
              <QuoteCell label="Показание" value={fact.ru} source={emaSource(fact)} wide />
            )}
          </For>
        </div>
      </Show>

      <Show when={constituents().length > 0}>
        <h2 class="herbal-chapter__heading">Действующие вещества</h2>
        <div class="herbal-chapter__cells">
          <For each={constituents()}>
            {(item) => (
              <QuoteCell
                label={[item.compoundRu, item.classRu]
                  .filter((part, index, parts): part is string =>
                    Boolean(part && parts.indexOf(part) === index),
                  )
                  .join(' · ')}
                value={capitalize(item.effectRu)}
                note={evidenceLabel(item.evidence)}
                source={emaSource(item)}
                wide
              />
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}
