import type { MedicalDocument, PrescriptionItem } from '@localmed/contracts';
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { ChoiceChip, ChoiceChipList } from '@/components/ChoiceChip';
import { Disclosure } from '@/components/Disclosure';
import { TextArea } from '@/components/TextArea';
import { QuoteBlock } from '@/features/medication-safety/SafetyBlocks';
import { SafetyDownloadOffer } from '@/features/medication-safety/SafetyDownloadOffer';
import {
  CARD_NOTICE,
  NOTHING_SAID_TEXT,
  sourceLine,
} from '@/features/medication-safety/safety-view';
import { displayDrugName } from '@/features/medications/drug-screen';
import { buildOfficialDocumentHash } from '@/state/document-route';
import type { ResolvedRule } from './dose-document';
import { assumedGroup } from './dose-population';
import {
  type ItemAnalysis,
  intakeRows,
  populationText,
  quantityText,
  type RuleOption,
} from './prescription-model';
import { ageText, type PatientStateFacts, safetyViewsFor } from './prescription-safety';
import { amountText, decimalText } from './prescription-text';
import '@/styles/prescription.css';

const COURSE_DAYS: readonly number[] = [3, 5, 7, 10, 14];

function RuleQuote(props: {
  readonly documentId: string;
  readonly resolved: ResolvedRule;
}): JSX.Element {
  return (
    <blockquote class="prescription__quote" data-testid="prescription-quote">
      <Show when={props.resolved.context}>
        {(context) => <p class="prescription__quote-context">{context()}</p>}
      </Show>
      <p class="prescription__quote-text">{props.resolved.quote}</p>
      <p class="prescription__quote-source">
        {props.resolved.sectionTitle}
        <Show when={props.resolved.anchor}>
          {(anchor) => (
            <>
              {' · '}
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

function optionNote(option: RuleOption): string | null {
  if (option.match.boundary) return 'Возраст пациента на границе группы: сверьте с предложением';
  if (option.match.unstated) return 'В предложении группа пациентов не названа';
  if (option.match.fit === 'yes' && option.resolved.rule.h !== undefined) {
    return 'Группа взята из заголовка выше предложения';
  }
  return null;
}

/**
 * One drug of the prescription: its form and strength from the registry, the dose sentences of the
 * official instruction that fit the patient (each quoted), the computed intake, the course and the
 * quantity, and the words of the blank. A rule is never invented: with no fitting rule the quoted
 * section is shown instead.
 */
export function PrescriptionItemCard(props: {
  readonly item: PrescriptionItem;
  readonly analysis: ItemAnalysis;
  readonly facts: PatientStateFacts;
  readonly document: MedicalDocument | undefined;
  readonly onChange: (patch: Partial<PrescriptionItem>) => void;
  /** Absent in the search card, where the item cannot be removed. */
  readonly onRemove: (() => void) | undefined;
  /** Open the block of dose sentences with conditions (the query names a renal or hepatic state). */
  readonly expandRestricted?: boolean;
  /** The search card leaves out the age / pregnancy sections unless the query asked about them. */
  readonly hideSafety?: boolean;
  readonly onContentChanged: () => Promise<void>;
}): JSX.Element {
  const analysis = (): ItemAnalysis => props.analysis;
  const [customDays, setCustomDays] = createSignal('');
  const documentId = (): string => analysis().documentId ?? '';
  const form = (): ItemAnalysis['forms'][number] | undefined =>
    analysis().forms.find((entry) => entry.form === analysis().form);
  const rows = createMemo(() => intakeRows(analysis()));
  const quantity = createMemo(() => quantityText(analysis()));
  const safety = createMemo(() => {
    const document = props.document;
    return document ? safetyViewsFor(document, props.facts) : [];
  });
  const plan = () => analysis().plan;
  const intakeChoices = createMemo<readonly number[]>(() => {
    const current = plan();
    if (!current) return [];
    if (current.status === 'needs-intakes') return [1, 2, 3, 4];
    if (current.status === 'ok' && current.intakesMin === null) return [1, 2, 3, 4];
    if (current.intakesMin === null || current.intakesMax === null) return [];
    if (current.periodDays > 1) return [];
    const low = Math.ceil(current.intakesMin - 1e-9);
    const high = Math.floor(current.intakesMax + 1e-9);
    if (high <= low) return [];
    const list: number[] = [];
    for (let value = low; value <= high && list.length < 8; value += 1) list.push(value);
    return list;
  });
  const hasRange = (): boolean => {
    const current = plan();
    return (
      current?.status === 'ok' &&
      current.singleMin !== null &&
      current.singleMax !== null &&
      current.singleMax - current.singleMin > 1e-9
    );
  };
  const instructionHint = (): { low: number; high: number; max: boolean } | null => {
    const chosen = analysis().chosen?.resolved.rule;
    if (chosen?.t0 !== undefined) {
      return { low: chosen.t0, high: chosen.t1 ?? chosen.t0, max: chosen.tm === 1 };
    }
    const duration = analysis().durations[0]?.rule;
    return duration?.t0 === undefined
      ? null
      : { low: duration.t0, high: duration.t1 ?? duration.t0, max: duration.tm === 1 };
  };
  const unitLabel = (unit: Parameters<typeof amountText>[1]): string => unit;
  void unitLabel;

  return (
    <article class="prescription__item paper-card" data-testid="prescription-item">
      <header class="prescription__item-header">
        <AppGlyph name="pill" class="prescription__item-icon" />
        <h3 class="prescription__item-title">{displayDrugName(props.item.label)}</h3>
        <Show when={props.onRemove}>
          {(remove) => (
            <Button
              type="button"
              variant="icon"
              class="prescription__item-remove"
              aria-label={`Убрать «${props.item.label}»`}
              icon={<AppGlyph name="close" />}
              onClick={remove()}
            />
          )}
        </Show>
      </header>

      <Show when={analysis().forms.length > 1}>
        <ChoiceChipList label="Лекарственная форма" class="prescription__chips">
          <For each={analysis().forms}>
            {(entry) => (
              <ChoiceChip
                compact
                accent={entry.form === analysis().form}
                aria-pressed={entry.form === analysis().form}
                onClick={() =>
                  props.onChange({
                    form: entry.form,
                    strength: null,
                    documentId: null,
                    ruleKey: null,
                    packSize: null,
                  })
                }
              >
                {entry.form}
              </ChoiceChip>
            )}
          </For>
        </ChoiceChipList>
      </Show>
      <Show when={analysis().form !== null && (form()?.strengths.length ?? 0) > 1}>
        <ChoiceChipList label="Дозировка" class="prescription__chips">
          <For each={form()?.strengths ?? []}>
            {(entry) => (
              <ChoiceChip
                compact
                accent={entry.strength === analysis().strength}
                aria-pressed={entry.strength === analysis().strength}
                onClick={() => props.onChange({ strength: entry.strength, packSize: null })}
              >
                {entry.strength}
              </ChoiceChip>
            )}
          </For>
        </ChoiceChipList>
      </Show>

      <Show when={analysis().state === 'loading'}>
        <p class="prescription__note" role="status">
          Читаем установленную инструкцию…
        </p>
      </Show>
      <Show when={analysis().state === 'no-instruction'}>
        <p class="prescription__status" data-testid="prescription-no-instruction">
          Инструкции этого вещества в таких формах нет в источниках приложения: доз из неё не взять.
        </p>
      </Show>
      <Show when={analysis().state === 'not-installed'}>
        <p class="prescription__status" data-testid="prescription-not-installed">
          Инструкция не установлена: дозы читаются только из неё.
        </p>
        <Show when={analysis().moduleToInstall}>
          {(moduleId) => (
            <SafetyDownloadOffer moduleId={moduleId()} onContentChanged={props.onContentChanged} />
          )}
        </Show>
      </Show>

      <Show when={analysis().state === 'ready' ? analysis().instruction : null}>
        {(instruction) => (
          <>
            <p class="prescription__source" data-testid="prescription-source">
              {sourceLine({
                documentId: instruction().documentId,
                moduleId: null,
                tradeName: instruction().tradeName,
                dosageForm: instruction().dosageForm,
                info: instruction().info,
                own: false,
                substanceNote: null,
                checkedInstructions: analysis().documentChoices.length,
              })}
            </p>
            <Show when={props.facts.group === undefined ? assumedGroup(props.facts) : null}>
              {(group) => (
                <p class="prescription__note" data-testid="prescription-assumed-group">
                  Возраст не указан: по массе тела {props.facts.weightKg} кг пациент принят за{' '}
                  {group() === 'child' ? 'ребёнка' : 'взрослого'}. Укажите возраст, чтобы проверить.
                </p>
              )}
            </Show>
            <Show when={analysis().documentChoices.length > 1}>
              <Disclosure variant="inline" title="Другая инструкция">
                <ChoiceChipList label="Инструкция" class="prescription__chips">
                  <For each={analysis().documentChoices}>
                    {(choice) => (
                      <ChoiceChip
                        compact
                        accent={choice.id === analysis().documentId}
                        aria-pressed={choice.id === analysis().documentId}
                        onClick={() => props.onChange({ documentId: choice.id, ruleKey: null })}
                      >
                        {choice.label}
                      </ChoiceChip>
                    )}
                  </For>
                </ChoiceChipList>
              </Disclosure>
            </Show>

            <Show
              when={analysis().options.length > 0}
              fallback={
                <div class="prescription__none" data-testid="prescription-no-rule">
                  <p class="prescription__status">
                    В инструкции нет дозы для этого пациента, которую можно рассчитать. Раздел ниже
                    показан как напечатан.
                  </p>
                  <For each={analysis().pending}>
                    {(option) => (
                      <p class="prescription__note">
                        {option.summary}: нужен{' '}
                        {option.match.missing
                          .map((what) => (what === 'age' ? 'возраст' : 'вес'))
                          .join(' и ')}
                      </p>
                    )}
                  </For>
                  <For each={instruction().sections}>
                    {(section) => (
                      <Disclosure variant="inline" title={section.title}>
                        <p class="prescription__section-text">{section.text}</p>
                        <Show when={section.cut}>
                          <p class="prescription__note">
                            Раздел длиннее: откройте инструкцию целиком.
                          </p>
                        </Show>
                        <a
                          class="prescription__link"
                          href={buildOfficialDocumentHash(instruction().documentId, section.anchor)}
                        >
                          Открыть в инструкции
                        </a>
                      </Disclosure>
                    )}
                  </For>
                </div>
              }
            >
              <fieldset class="prescription__rules" data-testid="prescription-rules">
                <legend class="prescription__legend">Дозы из инструкции</legend>
                <For each={analysis().options}>
                  {(option) => {
                    const selected = (): boolean => analysis().chosen?.key === option.key;
                    return (
                      <div
                        class="prescription__rule"
                        classList={{ 'prescription__rule--selected': selected() }}
                        data-testid="prescription-rule"
                      >
                        <button
                          type="button"
                          class="prescription__rule-button"
                          aria-pressed={selected()}
                          onClick={() =>
                            props.onChange({
                              ruleKey: option.key,
                              position: null,
                              intakesPerDay: null,
                              singleOverride: null,
                            })
                          }
                        >
                          <AppGlyph name={selected() ? 'check' : 'circle'} />
                          <span class="prescription__rule-summary">
                            {option.summary}
                            <Show when={populationText(option.resolved.rule)}>
                              {(who) => <span class="prescription__rule-who">{who()}</span>}
                            </Show>
                          </span>
                        </button>
                        <Show when={optionNote(option)}>
                          {(note) => <p class="prescription__note">{note()}</p>}
                        </Show>
                        <Show when={selected()}>
                          <RuleQuote documentId={documentId()} resolved={option.resolved} />
                        </Show>
                      </div>
                    );
                  }}
                </For>
              </fieldset>

              <Show when={plan()?.status === 'needs-weight'}>
                <p class="prescription__status" data-testid="prescription-needs-weight">
                  Доза в инструкции на килограмм массы тела: введите массу пациента.
                </p>
              </Show>
              <Show when={plan()?.status === 'needs-bsa'}>
                <p class="prescription__status">
                  Доза в инструкции на площадь поверхности тела: введите рост и массу пациента.
                </p>
              </Show>
              <Show when={plan()?.status === 'needs-intakes'}>
                <p class="prescription__status">
                  В предложении указана суточная доза без числа приёмов: выберите число приёмов.
                </p>
              </Show>

              <Show when={hasRange()}>
                <ChoiceChipList
                  label="Разовая доза в пределах предложения"
                  class="prescription__chips"
                >
                  <ChoiceChip
                    compact
                    accent={
                      (props.item.position ??
                        (analysis().chosen?.resolved.rule.up ? 'max' : 'min')) === 'min'
                    }
                    aria-pressed={
                      (props.item.position ??
                        (analysis().chosen?.resolved.rule.up ? 'max' : 'min')) === 'min'
                    }
                    onClick={() => props.onChange({ position: 'min', singleOverride: null })}
                  >
                    {`от ${amountText(plan()?.singleMin ?? 0, plan()?.unit ?? 'mg')}`}
                  </ChoiceChip>
                  <ChoiceChip
                    compact
                    accent={
                      (props.item.position ??
                        (analysis().chosen?.resolved.rule.up ? 'max' : 'min')) === 'max'
                    }
                    aria-pressed={
                      (props.item.position ??
                        (analysis().chosen?.resolved.rule.up ? 'max' : 'min')) === 'max'
                    }
                    onClick={() => props.onChange({ position: 'max', singleOverride: null })}
                  >
                    {`до ${amountText(plan()?.singleMax ?? 0, plan()?.unit ?? 'mg')}`}
                  </ChoiceChip>
                </ChoiceChipList>
              </Show>
              <Show when={intakeChoices().length > 0}>
                <ChoiceChipList label="Приёмов в день" class="prescription__chips">
                  <For each={intakeChoices()}>
                    {(count) => (
                      <ChoiceChip
                        compact
                        accent={plan()?.intakes === count}
                        aria-pressed={plan()?.intakes === count}
                        onClick={() => props.onChange({ intakesPerDay: count })}
                      >
                        {`${count} раз${count > 1 && count < 5 ? 'а' : ''} в день`}
                      </ChoiceChip>
                    )}
                  </For>
                </ChoiceChipList>
              </Show>

              <Show when={plan()?.status === 'ok'}>
                <ChoiceChipList label="Курс, дней" class="prescription__chips">
                  <For each={COURSE_DAYS}>
                    {(days) => (
                      <ChoiceChip
                        compact
                        accent={analysis().days === days}
                        aria-pressed={analysis().days === days}
                        data-testid={`prescription-days-${days}`}
                        onClick={() => props.onChange({ days })}
                      >
                        {`${days} дн.`}
                      </ChoiceChip>
                    )}
                  </For>
                  <Show when={instructionHint()}>
                    {(hint) => (
                      <ChoiceChip
                        compact
                        accent={analysis().days === hint().low && !COURSE_DAYS.includes(hint().low)}
                        onClick={() => props.onChange({ days: hint().low })}
                      >
                        {`по инструкции: ${hint().max ? 'не более ' : ''}${
                          hint().low === hint().high
                            ? decimalText(hint().low)
                            : `${decimalText(hint().low)}–${decimalText(hint().high)}`
                        } дн.`}
                      </ChoiceChip>
                    )}
                  </Show>
                  <label class="prescription__custom-days">
                    <span class="sr-only">Своё число дней</span>
                    <input
                      class="prescription__days-input"
                      type="number"
                      min="1"
                      max="365"
                      inputmode="numeric"
                      placeholder="дней"
                      value={customDays()}
                      onInput={(event) => {
                        setCustomDays(event.currentTarget.value);
                        const days = Number(event.currentTarget.value);
                        if (Number.isInteger(days) && days > 0 && days <= 365)
                          props.onChange({ days });
                      }}
                    />
                  </label>
                </ChoiceChipList>
              </Show>

              <Show when={plan()?.notes.includes('pieces-without-strength')}>
                <p class="prescription__note" data-testid="prescription-pieces-note">
                  В предложении названо число единиц без дозировки: проверьте, что выбрана та
                  дозировка, о которой говорит инструкция.
                </p>
              </Show>
              <Show when={rows().length > 0}>
                <dl class="prescription__result" data-testid="prescription-result">
                  <For each={rows()}>
                    {(row) => (
                      <div class="prescription__result-row">
                        <dt class="prescription__result-label">{row.label}</dt>
                        <dd class="prescription__result-value">
                          {row.value}
                          <Show when={row.note}>
                            {(note) => <span class="prescription__result-note">{note()}</span>}
                          </Show>
                        </dd>
                      </div>
                    )}
                  </For>
                  <Show when={quantity()}>
                    {(text) => (
                      <div class="prescription__result-row">
                        <dt class="prescription__result-label">На курс</dt>
                        <dd class="prescription__result-value" data-testid="prescription-quantity">
                          {text()}
                        </dd>
                      </div>
                    )}
                  </Show>
                </dl>
                <Show when={(analysis().quantity?.options.length ?? 0) > 1}>
                  <ChoiceChipList label="Упаковка" class="prescription__chips">
                    <For each={analysis().quantity?.options ?? []}>
                      {(option) => (
                        <ChoiceChip
                          compact
                          accent={option.size === analysis().packSize}
                          aria-pressed={option.size === analysis().packSize}
                          onClick={() => props.onChange({ packSize: option.size })}
                        >
                          {`${option.packages} × ${decimalText(option.size)}`}
                        </ChoiceChip>
                      )}
                    </For>
                  </ChoiceChipList>
                </Show>
              </Show>

              <For each={analysis().caps}>
                {(cap) => (
                  <div
                    class="prescription__cap"
                    classList={{ 'prescription__cap--over': cap.check.exceeded }}
                    data-testid="prescription-cap"
                    data-exceeded={cap.check.exceeded}
                  >
                    <p class="prescription__cap-line">
                      <AppGlyph name={cap.check.exceeded ? 'info' : 'check'} />
                      <span>
                        {`В инструкции ${
                          cap.check.scope === 'single'
                            ? 'максимальная разовая доза'
                            : cap.check.scope === 'course'
                              ? 'предел на курс'
                              : 'максимальная суточная доза'
                        } — ${amountText(cap.check.limit, cap.check.unit)}. Рассчитано: ${amountText(cap.check.actual, cap.check.unit)}${cap.check.exceeded ? ' — больше указанного предела' : ''}.`}
                      </span>
                    </p>
                    <RuleQuote documentId={documentId()} resolved={cap.resolved} />
                  </div>
                )}
              </For>

              <Show when={analysis().restricted.length > 0}>
                <Disclosure
                  variant="inline"
                  defaultOpen={props.expandRestricted === true}
                  title="Коррекция дозы и особые группы"
                  meta={<span>{analysis().restricted.length}</span>}
                >
                  <For each={analysis().restricted}>
                    {(resolved) => <RuleQuote documentId={documentId()} resolved={resolved} />}
                  </For>
                </Disclosure>
              </Show>

              <Show when={plan()?.status === 'ok'}>
                <Disclosure variant="inline" title="Текст рецепта">
                  <div class="prescription__edit">
                    <TextArea
                      label="Rp."
                      rows={2}
                      value={analysis().rp}
                      onInput={(event) => props.onChange({ rp: event.currentTarget.value })}
                    />
                    <TextArea
                      label="Способ применения"
                      rows={2}
                      value={analysis().signa}
                      onInput={(event) => props.onChange({ signa: event.currentTarget.value })}
                    />
                    <Show when={props.item.rp !== null || props.item.signa !== null}>
                      <Button
                        type="button"
                        variant="quiet"
                        onClick={() => props.onChange({ rp: null, signa: null })}
                      >
                        Вернуть расчётный текст
                      </Button>
                    </Show>
                  </div>
                </Disclosure>
              </Show>
            </Show>

            <Show when={!props.hideSafety && safety().length > 0}>
              <section class="prescription__safety" data-testid="prescription-safety">
                <h4 class="prescription__safety-title">
                  Из инструкции о состоянии пациента
                  <Show when={props.facts.ageDays !== undefined}>
                    {' · '}
                    {ageText(props.facts.ageDays ?? 0)}
                  </Show>
                </h4>
                <p class="prescription__note">{CARD_NOTICE}</p>
                <For each={safety()}>
                  {(view) => (
                    <div class="prescription__safety-view" data-intent={view.intent}>
                      <h5 class="prescription__safety-intent">{view.title}</h5>
                      <Show when={view.nothingSaid}>
                        <p class="prescription__note">{NOTHING_SAID_TEXT}</p>
                      </Show>
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
                            {(quote) => <QuoteBlock documentId={documentId()} quote={quote} />}
                          </For>
                        )}
                      </For>
                    </div>
                  )}
                </For>
              </section>
            </Show>
          </>
        )}
      </Show>
    </article>
  );
}
