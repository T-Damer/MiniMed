import type { MedicalDocument, PrescriptionItem } from '@localmed/contracts';
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { ChoiceChip, ChoiceChipList } from '@/components/ChoiceChip';
import { Disclosure } from '@/components/Disclosure';
import { TextArea } from '@/components/TextArea';
import { SafetyDownloadOffer } from '@/features/medication-safety/SafetyDownloadOffer';
import { sourceLine } from '@/features/medication-safety/safety-view';
import { displayDrugName } from '@/features/medications/drug-screen';
import { buildOfficialDocumentHash } from '@/state/document-route';
import { assumedGroup } from './dose-population';
import { FragmentsDisclosure, RuleQuote, SafetySummary } from './PrescriptionFragments';
import {
  type ItemAnalysis,
  indicationLabel,
  intakeRows,
  populationText,
  quantityText,
  type RuleOption,
} from './prescription-model';
import { type PatientStateFacts, safetyViewsFor } from './prescription-safety';
import { amountText, decimalText } from './prescription-text';
import '@/styles/prescription.css';

const COURSE_DAYS: readonly number[] = [3, 5, 7, 10, 14];

/** «возраст», «вес» or «возраст и вес»: what the rules waiting for a number ask for. */
function missingData(pending: readonly RuleOption[]): string {
  const missing = new Set(pending.flatMap((option) => option.match.missing));
  return [...missing].map((what) => (what === 'age' ? 'возраст' : 'вес')).join(' и ');
}

function optionNote(option: RuleOption): string | null {
  if (option.match.boundary) return 'Возраст пациента на границе группы: сверьте с предложением';
  if (option.match.unstated) return 'В предложении группа пациентов не названа';
  if (option.match.fit === 'yes' && option.resolved.rule.h !== undefined) {
    return 'Группа взята из заголовка выше предложения';
  }
  return null;
}

/** The editable Rp. and sign lines; with computed doses off they are the doctor's own text. */
function RecipeTextEditor(props: {
  readonly item: PrescriptionItem;
  readonly analysis: ItemAnalysis;
  readonly onChange: (patch: Partial<PrescriptionItem>) => void;
}): JSX.Element {
  return (
    <Disclosure variant="inline" title="Текст рецепта">
      <div class="prescription__edit">
        <TextArea
          label="Rp."
          rows={2}
          value={props.analysis.rp}
          onInput={(event) => props.onChange({ rp: event.currentTarget.value })}
        />
        <TextArea
          label="Способ применения"
          rows={2}
          value={props.analysis.signa}
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
  );
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
  const pickRule = (key: string): void => {
    props.onChange({ ruleKey: key, position: null, intakesPerDay: null, singleOverride: null });
  };

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
              when={analysis().chosen}
              fallback={
                <div class="prescription__none" data-testid="prescription-no-rule">
                  <p class="prescription__status">
                    {analysis().numbersOff
                      ? 'Расчёт доз в этой версии выключен: предложения приведены как напечатано.'
                      : analysis().quoted.length > 0
                        ? 'Число по инструкции не посчитано: предложение приведено как напечатано.'
                        : 'В инструкции нет дозы для этого пациента, которую можно рассчитать.'}
                  </p>
                  <Show when={analysis().quoted[0]}>
                    {(lead) => <RuleQuote documentId={documentId()} resolved={lead()} />}
                  </Show>
                  <Show when={analysis().pending.length > 0}>
                    <p class="prescription__note" data-testid="prescription-pending">
                      {`Чтобы рассчитать, нужен ${missingData(analysis().pending)}.`}
                    </p>
                  </Show>
                  <Show
                    when={
                      analysis().quoted.length === 0 &&
                      analysis().restricted.length === 0 &&
                      analysis().pending.length === 0
                    }
                  >
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
                            href={buildOfficialDocumentHash(
                              instruction().documentId,
                              section.anchor,
                            )}
                          >
                            Открыть в инструкции
                          </a>
                        </Disclosure>
                      )}
                    </For>
                  </Show>
                  <FragmentsDisclosure
                    analysis={analysis()}
                    documentId={documentId()}
                    open={props.expandRestricted === true && analysis().restricted.length > 0}
                    onPick={pickRule}
                  />
                  <Show when={analysis().numbersOff && analysis().form !== null}>
                    <RecipeTextEditor
                      item={props.item}
                      analysis={analysis()}
                      onChange={props.onChange}
                    />
                  </Show>
                </div>
              }
            >
              {(chosen) => (
                <>
                  <fieldset
                    class="prescription__rule prescription__rule--selected"
                    aria-label="Доза из инструкции"
                    data-testid="prescription-rules"
                  >
                    <div class="prescription__rule-head" data-testid="prescription-rule">
                      <AppGlyph name="check" />
                      <span class="prescription__rule-summary">
                        {chosen().summary}
                        <Show when={populationText(chosen().resolved.rule)}>
                          {(who) => <span class="prescription__rule-who">{who()}</span>}
                        </Show>
                        <Show when={indicationLabel(chosen())}>
                          {(why) => (
                            <span
                              class="prescription__rule-indication"
                              data-testid="prescription-indication"
                            >
                              {why()}
                            </span>
                          )}
                        </Show>
                      </span>
                    </div>
                    <Show when={optionNote(chosen())}>
                      {(note) => <p class="prescription__note">{note()}</p>}
                    </Show>
                    <RuleQuote documentId={documentId()} resolved={chosen().resolved} />
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
                  <Show when={plan()?.status === 'strength-mismatch'}>
                    <p class="prescription__status" data-testid="prescription-strength-mismatch">
                      В предложении количество дано для другой дозировки: выберите дозировку из
                      инструкции или ориентируйтесь на приведённое предложение.
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
                            accent={
                              analysis().days === hint().low && !COURSE_DAYS.includes(hint().low)
                            }
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

                  <Show when={plan()?.notes.includes('rounding-refused')}>
                    <p class="prescription__note" data-testid="prescription-rounding-refused">
                      Выбранная дозировка не позволяет отмерить расчётную дозу точно: число
                      таблеток, миллилитров или флаконов не указано.
                    </p>
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
                            <dd
                              class="prescription__result-value"
                              data-testid="prescription-quantity"
                            >
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
                      <p
                        class="prescription__cap-line"
                        classList={{ 'prescription__cap-line--over': cap.check.exceeded }}
                        data-testid="prescription-cap"
                        data-exceeded={cap.check.exceeded}
                      >
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
                    )}
                  </For>

                  <FragmentsDisclosure
                    analysis={analysis()}
                    documentId={documentId()}
                    open={props.expandRestricted === true && analysis().restricted.length > 0}
                    onPick={pickRule}
                  />

                  <Show when={plan()?.status === 'ok' || plan()?.status === 'strength-mismatch'}>
                    <RecipeTextEditor
                      item={props.item}
                      analysis={analysis()}
                      onChange={props.onChange}
                    />
                  </Show>
                </>
              )}
            </Show>

            <Show when={!props.hideSafety && safety().length > 0}>
              <SafetySummary
                views={safety()}
                documentId={documentId()}
                ageDays={props.facts.ageDays}
              />
            </Show>
          </>
        )}
      </Show>
    </article>
  );
}
