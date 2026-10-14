/**
 * The model of one prescription item (RX1): the drug, its dosage form and strength from the
 * registry, the dose rules of its official instruction that fit the patient, the chosen rule, the
 * computed intake, the length of the course, the quantity, and the words that go on the blank. Pure:
 * the screen passes in what it has loaded (index, instruction, patient facts) and renders what comes
 * out. Nothing is invented: with no rule that fits, `chosen` stays empty and the quoted sections
 * are listed instead.
 */
import {
  DOSE_UNITS,
  type DoseRule,
  type DoseRuleCard,
  type DoseUnit,
  GROUP_ADULT,
  GROUP_CHILD,
  GROUP_NEWBORN,
  PACK_UNITS,
  type PackUnit,
  type PrescriptionItem,
  ROLE_LOADING,
  ROLE_SINGLE,
  RULE_CAP,
  RULE_DOSE,
  RULE_DURATION,
} from '@localmed/contracts';

import { cardDisplayName } from '@/features/drug-interactions/drug-candidates';
import { formatAgeDays, formatWeightTenths } from '@/features/medication-safety/age-limits';
import { pluralRu } from '@/i18n/labels';
import type { CapCheck, QuantityPlan } from './dose-compute';
import {
  checkCaps,
  type IntakePlan,
  type ProductChoice,
  planIntake,
  planQuantity,
  ROUNDING_TOLERANCE_PERCENT,
  type UnitsPlan,
} from './dose-compute';
import type { ResolvedInstruction, ResolvedRule } from './dose-document';
import { type DoseIndex, documentsForForm, formClassOf } from './dose-index';
import { matchPopulation, type PatientFacts, type PopulationMatch } from './dose-population';
import { PRESCRIPTION_SETTINGS, type PrescriptionSettings } from './prescription-settings';
import {
  amountText,
  countText,
  decimalText,
  frequencyPhrase,
  rpLine,
  signaText,
} from './prescription-text';
import { parseStrength, pieceWords, pieceWordsOfKind } from './product-strength';

export type { PrescriptionItem };

export function newItem(id: string, slug: string, label: string): PrescriptionItem {
  return {
    id,
    slug,
    label,
    form: null,
    strength: null,
    documentId: null,
    ruleKey: null,
    position: null,
    intakesPerDay: null,
    singleOverride: null,
    days: null,
    packSize: null,
    signa: null,
    rp: null,
  };
}

export interface RegistryForm {
  readonly form: string;
  readonly strengths: readonly {
    readonly strength: string;
    readonly packs: readonly number[];
    readonly packUnit: PackUnit;
  }[];
}

/** The registry rows of a card grouped by dosage form, forms with most strengths first. */
export function registryForms(
  card: DoseRuleCard,
  forms: readonly string[],
): readonly RegistryForm[] {
  const byForm = new Map<string, RegistryForm['strengths'][number][]>();
  for (const [formIndex, strength, unit, packs] of card.r) {
    const form = forms[formIndex] ?? '';
    if (form === '') continue;
    const list = byForm.get(form) ?? [];
    if (!list.some((entry) => entry.strength === strength)) {
      list.push({ strength, packs, packUnit: PACK_UNITS[unit] ?? 'other' });
    }
    byForm.set(form, list);
  }
  return [...byForm.entries()]
    .map(([form, strengths]) => ({
      form,
      strengths: strengths.toSorted((a, b) =>
        a.strength.localeCompare(b.strength, 'ru', { numeric: true }),
      ),
    }))
    .toSorted(
      (a, b) => b.strengths.length - a.strengths.length || a.form.localeCompare(b.form, 'ru'),
    );
}

/** The registry form that a query word names: the first form whose wording starts with it. */
export function pickForm(
  forms: readonly RegistryForm[],
  word: string | undefined,
): RegistryForm | null {
  if (!word) return null;
  const wanted = word.toLocaleLowerCase('ru-RU');
  return forms.find((entry) => entry.form.startsWith(wanted)) ?? null;
}

/** The strength of a form that equals the query's milligrams per unit. */
export function pickStrength(
  strengths: RegistryForm['strengths'],
  milligrams: number,
): string | null {
  for (const entry of strengths) {
    const parsed = parseStrength(entry.strength);
    const amount =
      parsed?.kind === 'solid'
        ? parsed.amount
        : parsed?.kind === 'liquid'
          ? parsed.perMl * parsed.volumeMl
          : null;
    if (amount !== null && amount !== undefined && Math.abs(amount - milligrams) < 1e-6)
      return entry.strength;
  }
  return null;
}

/** The form and the strength a query names, applied to an item that has chosen neither. */
export function applyQueryChoices(
  item: PrescriptionItem,
  index: DoseIndex,
  choices: { readonly formWord?: string | undefined; readonly strengthMg?: number | undefined },
): PrescriptionItem {
  if (item.form !== null || (!choices.formWord && choices.strengthMg === undefined)) return item;
  const cardIndex = index.cardBySlug.get(item.slug);
  const card = cardIndex === undefined ? undefined : index.asset.cards[cardIndex];
  if (!card) return item;
  const form = pickForm(registryForms(card, index.asset.forms), choices.formWord);
  if (!form) return item;
  const strength =
    choices.strengthMg === undefined ? null : pickStrength(form.strengths, choices.strengthMg);
  return { ...item, form: form.form, ...(strength ? { strength } : {}) };
}

export function ruleKeyOf(rule: DoseRule): string {
  return `${rule.s}:${rule.a}:${rule.k}`;
}

/** How many base units are in one displayed unit: 1000 for «г», 0.001 for «мкг». */
function unitScale(value: number, unit: DoseUnit): number {
  if (unit !== 'mg') return 1;
  if (value >= 1000 && value % 100 === 0) return 1000;
  if (value < 0.1) return 0.001;
  return 1;
}

/** «500–1000 мг · 3–4 раза в сутки»: the numbers of a rule in words, without instruction text. */
export function ruleSummary(rule: DoseRule): string {
  const parts: string[] = [];
  const unit = DOSE_UNITS[rule.u ?? 0] ?? 'mg';
  if (rule.d0 !== undefined || rule.d1 !== undefined) {
    const low = rule.d0 ?? rule.d1 ?? 0;
    const high = rule.d1 ?? rule.d0 ?? 0;
    const perBody = rule.pk === 1 ? '/кг' : rule.pk === 2 ? '/м²' : '';
    const label = unit === 'piece' ? 'шт.' : amountText(1, unit).replace(/^1\s*/u, '');
    // A dose per kilogram is written in the unit the instruction uses, never converted; a range
    // is written in one unit, the one of its upper end.
    const plain = perBody !== '' || unit === 'piece' || unit === 'drop' || unit === 'dose';
    const unitText = plain
      ? label
      : amountText(high || low, unit)
          .replace(/^[\d\s,]+/u, '')
          .trim();
    const scale = plain ? 1 : unitScale(high || low, unit);
    const number = (value: number): string =>
      plain && unit === 'piece' ? countText(value) : decimalText(value / scale);
    const numbers = rule.up
      ? `до ${number(high)}`
      : low === high || rule.d1 === undefined
        ? number(low)
        : `${number(low)}–${number(high)}`;
    parts.push(`${numbers} ${unitText}${perBody}`);
    if (rule.k === RULE_DOSE) parts.push(rule.bs === 1 ? 'в сутки' : 'на приём');
  }
  if (rule.f0 !== undefined) {
    const low = rule.f0;
    const high = rule.f1 ?? rule.f0;
    const range = low === high ? countText(low) : `${countText(low)}–${countText(high)}`;
    const period = rule.fp ?? 1;
    parts.push(
      period === 1
        ? `${range} ${pluralRu(high, 'раз', 'раза', 'раз')} в сутки`
        : period === 7
          ? `${range} ${pluralRu(high, 'раз', 'раза', 'раз')} в неделю`
          : `${range} ${pluralRu(high, 'раз', 'раза', 'раз')} в ${period} дн.`,
    );
  }
  if (rule.t0 !== undefined) {
    const low = rule.t0;
    const high = rule.t1 ?? rule.t0;
    parts.push(
      `${rule.tm ? 'не более ' : ''}${low === high ? decimalText(low) : `${decimalText(low)}–${decimalText(high)}`} дн.`,
    );
  }
  return parts.join(' · ');
}

/** «дети от 6 до 12 лет, до 40 кг»: who the sentence is for, in the numbers the parser read. */
export function populationText(rule: DoseRule): string | null {
  const parts: string[] = [];
  const age =
    rule.p0 !== undefined && rule.p1 !== undefined
      ? `от ${formatAgeDays(rule.p0, 'genitive')} до ${formatAgeDays(rule.p1, 'genitive')}`
      : rule.p0 !== undefined
        ? `от ${formatAgeDays(rule.p0, 'genitive')}`
        : rule.p1 !== undefined
          ? `до ${formatAgeDays(rule.p1, 'genitive')}`
          : null;
  const weight =
    rule.w0 !== undefined && rule.w1 !== undefined
      ? `${formatWeightTenths(rule.w0)}–${formatWeightTenths(rule.w1)}`
      : rule.w0 !== undefined
        ? `от ${formatWeightTenths(rule.w0)}`
        : rule.w1 !== undefined
          ? `до ${formatWeightTenths(rule.w1)}`
          : null;
  if (age) parts.push(age);
  if (weight) parts.push(weight);
  const group = rule.g ?? 0;
  const who =
    (group & GROUP_ADULT) !== 0 && (group & GROUP_CHILD) === 0
      ? 'взрослые'
      : (group & GROUP_CHILD) !== 0 && (group & GROUP_ADULT) === 0
        ? 'дети'
        : (group & GROUP_NEWBORN) !== 0
          ? 'новорождённые'
          : null;
  const bounds = parts.join(rule.or ? ' или ' : ', ');
  if (who && bounds) return `${who} ${bounds}`;
  return who ?? (bounds || null);
}

export interface RuleOption {
  readonly key: string;
  readonly resolved: ResolvedRule;
  /**
   * What the sentence is for («при амебиазе», «Для лечения»): the instruction states several regimens
   * and this is one of them, never its general dose. Null for a general sentence.
   */
  readonly indication: string | null;
  /** The sentence is bound to an indication or is one of several regimens of the population. */
  readonly bound: boolean;
  /** Position in the instruction's list of rules. */
  readonly position: number;
  readonly match: PopulationMatch;
  readonly plan: IntakePlan;
  readonly summary: string;
}

/** What is known of one instruction: still being read, not installed, or read. */
export type InstructionState = 'loading' | 'missing' | ResolvedInstruction;

export interface ItemInputs {
  readonly index: DoseIndex;
  readonly patient: PatientFacts;
  /** Release settings; the shipped ones when absent. */
  readonly settings?: PrescriptionSettings;
  /** The state of an instruction; undefined until its reading was asked for. */
  readonly instructionOf: (documentId: string) => InstructionState | undefined;
}

export type ItemState = 'pick-drug' | 'loading' | 'not-installed' | 'no-instruction' | 'ready';

export interface CapView {
  readonly check: CapCheck;
  readonly resolved: ResolvedRule;
}

export interface ItemAnalysis {
  /** Computed doses are switched off by the release settings: every dose sentence is quoted, none computed. */
  readonly numbersOff: boolean;
  readonly card: DoseRuleCard | undefined;
  readonly forms: readonly RegistryForm[];
  readonly form: string | null;
  readonly strength: string | null;
  readonly product: ProductChoice | null;
  readonly documentChoices: readonly { readonly id: string; readonly label: string }[];
  readonly documentId: string | null;
  readonly moduleToInstall: string | null;
  readonly state: ItemState;
  /** Rules that fit the patient and can be computed. */
  readonly options: readonly RuleOption[];
  /** Rules that would fit once the missing data is entered. */
  readonly pending: readonly RuleOption[];
  /** Dose sentences quoted only: conditions, or a population the sentence does not name. */
  readonly restricted: readonly ResolvedRule[];
  /**
   * Sentences the confidence gate keeps from producing numbers (tables, stages, alternatives,
   * borrowed populations …) that may be about this patient: quoted with a link, never computed.
   */
  readonly quoted: readonly ResolvedRule[];
  /**
   * Why a quoted sentence is marked as the patient's own («по возрасту и массе»): the sentence names
   * a population and the patient stands surely inside it. Quoted sentences come in this order: the
   * ones that fit the patient first, then those that might, in the instruction's order.
   */
  readonly quotedMarks: ReadonlyMap<ResolvedRule, string>;
  readonly chosen: RuleOption | null;
  readonly plan: IntakePlan | null;
  readonly caps: readonly CapView[];
  /** Lengths of treatment the instruction states for this patient. */
  readonly durations: readonly ResolvedRule[];
  readonly days: number | null;
  readonly quantity: QuantityPlan | null;
  readonly packSize: number | null;
  readonly signa: string;
  readonly rp: string;
  readonly divisible: boolean;
  /** The instruction the rules were read from, once it is installed and read. */
  readonly instruction: ResolvedInstruction | null;
}

/**
 * What to print beside the numbers of a regimen that is not the instruction's general dose: the
 * indication the sentence is bound to («при амебиазе»), else a plain statement that it is one of
 * several. Null for a general sentence.
 */
export function indicationLabel(option: Pick<RuleOption, 'indication' | 'bound'>): string | null {
  if (option.indication !== null) return option.indication;
  return option.bound ? 'один из режимов в инструкции' : null;
}

/** Rules that recommend a dose come before loading doses and ceilings. */
function completeness(rule: DoseRule): number {
  // A loading or one-off dose, or a «до X» ceiling, comes after the dose the instruction recommends.
  return rule.ro === ROLE_LOADING || rule.ro === ROLE_SINGLE || rule.up === 1 ? 0 : 1;
}

function specificity(rule: DoseRule): number {
  let score = 0;
  if (rule.p0 !== undefined) score += 1;
  if (rule.p1 !== undefined) score += 1;
  if (rule.w0 !== undefined) score += 1;
  if (rule.w1 !== undefined) score += 1;
  return score;
}

function documentLabel(index: DoseIndex, id: string): string {
  const document = index.asset.documents[id];
  const form = document?.f?.toLocaleLowerCase('ru-RU') ?? 'форма не указана';
  return document?.t ? `${form} · ${document.t}` : form;
}

function chooseProduct(
  forms: readonly RegistryForm[],
  form: string | null,
  strength: string | null,
): ProductChoice | null {
  if (form === null || strength === null) return null;
  const row = forms
    .find((entry) => entry.form === form)
    ?.strengths.find((entry) => entry.strength === strength);
  return row ? { form, strength, packs: row.packs, packUnit: row.packUnit } : null;
}

const SECTION_BY_DEFAULT_DAYS_UNKNOWN = null;

interface Choices {
  readonly cardIndex: number | undefined;
  readonly card: DoseRuleCard | undefined;
  readonly forms: readonly RegistryForm[];
  readonly form: string | null;
  readonly strength: string | null;
  readonly product: ProductChoice | null;
  readonly ids: readonly string[];
  readonly documentId: string | null;
}

/** What the item has chosen so far: card, form, strength, and the instruction that goes with them. */
export function choicesOf(item: PrescriptionItem, index: DoseIndex): Choices {
  const cardIndex = index.cardBySlug.get(item.slug);
  const card = cardIndex === undefined ? undefined : index.asset.cards[cardIndex];
  const forms = card ? registryForms(card, index.asset.forms) : [];
  const form = item.form ?? (forms.length === 1 ? (forms[0]?.form ?? null) : null);
  const strengthsOfForm = forms.find((entry) => entry.form === form)?.strengths ?? [];
  const strength =
    item.strength ?? (strengthsOfForm.length === 1 ? (strengthsOfForm[0]?.strength ?? null) : null);
  const product = chooseProduct(forms, form, strength);
  const ids = cardIndex === undefined ? [] : documentsForForm(index, cardIndex, form);
  const documentId =
    item.documentId && ids.includes(item.documentId) ? item.documentId : (ids[0] ?? null);
  return { cardIndex, card, forms, form, strength, product, ids, documentId };
}

/** The instructions the item may use: the one it chose, or every instruction of the card. */
export function documentIdsToRead(item: PrescriptionItem, index: DoseIndex): readonly string[] {
  const { ids } = choicesOf(item, index);
  return item.documentId !== null && ids.includes(item.documentId) ? [item.documentId] : ids;
}

interface Classified {
  readonly resolved: ResolvedRule;
  readonly position: number;
  readonly match: PopulationMatch;
}

/** Every dose rule of an instruction with how the patient stands to it. */
function classify(instruction: ResolvedInstruction, patient: PatientFacts): readonly Classified[] {
  return instruction.rules.map((resolved, position) => ({
    resolved,
    position,
    match: matchPopulation(resolved.rule, patient),
  }));
}

/** Doses that can be computed for the patient: the gate allows the rule, the population fits and no condition restricts it. */
function computable(entries: readonly Classified[], enabled: boolean): readonly Classified[] {
  return entries.filter(
    ({ resolved, match }) =>
      enabled &&
      resolved.computable &&
      resolved.rule.k === RULE_DOSE &&
      match.fit === 'yes' &&
      !match.conditional,
  );
}

/** One substance of a strength in a comparable form: «0.05 %» and «0.5 мг/мл» are the same concentration. */
function strengthPart(part: string): string {
  const text = part.toLocaleLowerCase('ru-RU').replace(/\s+/gu, ' ').trim();
  const parsed = parseStrength(text);
  if (parsed?.kind === 'solid') return `${parsed.unit}:${parsed.amount}`;
  if (parsed?.kind === 'liquid') return `${parsed.unit}/ml:${Math.round(parsed.perMl * 1e6) / 1e6}`;
  const percent = /^(\d+(?:[.,]\d+)?)\s*%$/u.exec(text);
  if (percent)
    return `mg/ml:${Math.round(Number((percent[1] ?? '').replace(',', '.')) * 10 * 1e6) / 1e6}`;
  return text;
}

/**
 * Strengths compare by what they say, not by how the registry spells them: the parts of a combination
 * may come in another order («50 мг+1000 МЕ» / «1000 МЕ+50 мг»), a percentage is a concentration.
 */
function sameStrengthText(left: string, right: string): boolean {
  const key = (text: string): string => text.split('+').map(strengthPart).toSorted().join('+');
  return key(left) === key(right);
}

/**
 * The part of a dosage form's wording that decides what the product is: tablets, capsules and the like
 * are one product whatever their coating («таблетки, покрытые оболочкой»); drops, solutions and sprays
 * are told apart by the wording up to the first comma («капли глазные», «капли ушные»).
 */
function formTieKey(form: string): string {
  const clean = form.toLocaleLowerCase('ru-RU').trim();
  const head = formClassOf(clean);
  return /^(?:таблетки|капсулы|драже|пастилки|леденцы)$/u.test(head)
    ? head
    : (clean.split(',')[0] ?? clean).trim();
}

/**
 * Whether the chosen product is one of the instruction's own: the counts of pieces and millilitres an
 * instruction prints are valid for the registry rows of its own registrations. An instruction matched
 * to the card by its substance only has none; then the card's single strength of the form is the only
 * one it can be about. `null`: no product chosen, nothing to compare.
 */
export function productTie(
  index: DoseIndex,
  documentId: string,
  forms: readonly RegistryForm[],
  form: string | null,
  strength: string | null,
): boolean | null {
  if (form === null || strength === null) return null;
  const own = index.asset.documents[documentId]?.ps;
  if (own !== undefined && own.length > 0) {
    return own.some(
      ([formIndex, ownStrength]) =>
        formTieKey(index.asset.forms[formIndex] ?? '') === formTieKey(form) &&
        sameStrengthText(ownStrength, strength),
    );
  }
  const strengths = forms.find((entry) => entry.form === form)?.strengths ?? [];
  return strengths.length === 1;
}

/** «по возрасту и массе»: what of the patient the sentence's population words surely match. */
export function populationFitMark(match: Pick<PopulationMatch, 'matched'>): string | null {
  const age = match.matched.includes('age');
  const weight = match.matched.includes('weight');
  if (age && weight) return 'по возрасту и массе';
  if (age) return 'по возрасту';
  if (weight) return 'по массе';
  return match.matched.includes('group') ? 'по возрастной группе' : null;
}

export function analyzeItem(item: PrescriptionItem, inputs: ItemInputs): ItemAnalysis {
  const { index, patient } = inputs;
  const enabled = (inputs.settings ?? PRESCRIPTION_SETTINGS).computedDoses;
  const { card, forms, form, strength, product, ids } = choicesOf(item, index);
  const documentChoices = ids.map((id) => ({ id, label: documentLabel(index, id) }));
  const base = {
    numbersOff: !enabled,
    card,
    forms,
    form,
    strength,
    product,
    documentChoices,
    documentId: null as string | null,
    options: [] as readonly RuleOption[],
    pending: [] as readonly RuleOption[],
    restricted: [] as readonly ResolvedRule[],
    quoted: [] as readonly ResolvedRule[],
    quotedMarks: new Map<ResolvedRule, string>() as ReadonlyMap<ResolvedRule, string>,
    chosen: null,
    plan: null,
    caps: [] as readonly CapView[],
    durations: [] as readonly ResolvedRule[],
    days: item.days,
    quantity: null,
    packSize: item.packSize,
    signa: item.signa ?? '',
    rp: item.rp ?? '',
    divisible: false,
    moduleToInstall: null,
    instruction: null as ResolvedInstruction | null,
  };
  if (!card) return { ...base, state: 'pick-drug' };
  if (ids.length === 0) return { ...base, state: 'no-instruction' };
  // The instruction to use: the one chosen, else the first of the card that has a dose for the patient.
  const forced = item.documentId !== null && ids.includes(item.documentId);
  let selectedId: string | null = null;
  let selected: ResolvedInstruction | null = null;
  let fallback: ResolvedInstruction | null = null;
  let firstMissing: string | null = null;
  let waiting = false;
  for (const id of forced ? [item.documentId as string] : ids) {
    const state = inputs.instructionOf(id);
    if (state === undefined || state === 'loading') {
      waiting = true;
      break;
    }
    if (state === 'missing') {
      firstMissing ??= id;
      continue;
    }
    fallback ??= state;
    if (forced || computable(classify(state, patient), enabled).length > 0) {
      selectedId = id;
      selected = state;
      break;
    }
  }
  if (!selected && waiting) return { ...base, state: 'loading' };
  const instruction = selected ?? fallback;
  const documentId = instruction?.documentId ?? selectedId ?? firstMissing ?? ids[0] ?? null;
  if (!instruction) {
    const missing = firstMissing ?? ids[0] ?? null;
    const entry = missing ? index.asset.documents[missing] : undefined;
    const moduleId = entry ? index.asset.modules[entry.m] : undefined;
    return {
      ...base,
      documentId: missing,
      state: 'not-installed',
      moduleToInstall: moduleId ?? null,
    };
  }
  base.documentId = documentId;

  const options: RuleOption[] = [];
  const pending: RuleOption[] = [];
  const restricted: ResolvedRule[] = [];
  const quoted: ResolvedRule[] = [];
  const quotedSeen = new Set<string>();
  // The sentence that names the patient's group and states a dose comes first.
  const quotedRank = new Map<ResolvedRule, number>();
  const quotedMarks = new Map<ResolvedRule, string>();
  const durations: ResolvedRule[] = [];
  const doseRules = instruction.rules.map((resolved) => resolved.rule);
  instruction.rules.forEach((resolved, position) => {
    const rule = resolved.rule;
    const match = matchPopulation(rule, patient);
    if (!enabled || !resolved.computable) {
      // Not trusted for numbers: a sentence that may be about this patient is quoted, nothing more.
      if (
        !match.conditional &&
        (match.fit !== 'no' || match.unstated) &&
        !quotedSeen.has(resolved.quote)
      ) {
        quotedSeen.add(resolved.quote);
        quoted.push(resolved);
        // A sentence the patient surely fits comes before one that only might apply (the adult band
        // of «взрослые и дети старше 13 лет и/или массой более 40 кг» is not the 20 kg child's).
        quotedRank.set(
          resolved,
          (match.fit === 'yes' ? 0 : 8) +
            Number(match.unstated) * 4 +
            (rule.k === RULE_DOSE ? 0 : rule.k === RULE_CAP ? 1 : 2),
        );
        if (match.fit === 'yes' && !match.unstated) {
          const mark = populationFitMark(match);
          if (mark) quotedMarks.set(resolved, mark);
        }
      }
      return;
    }
    if (rule.k === RULE_DURATION) {
      if (match.fit === 'yes' && !match.conditional) durations.push(resolved);
      return;
    }
    if (rule.k !== RULE_DOSE) return;
    if (match.conditional || (match.fit === 'no' && match.unstated)) {
      restricted.push(resolved);
      return;
    }
    if (match.fit === 'no') return;
    const plan = planIntake({
      rule,
      patient,
      product,
      productTied: productTie(index, instruction.documentId, forms, form, strength),
      divisible: instruction.divisible,
      ...(item.position ? { position: item.position } : {}),
      ...(item.intakesPerDay === null ? {} : { intakesPerDay: item.intakesPerDay }),
      ...(item.singleOverride === null ? {} : { singleOverride: item.singleOverride }),
    });
    const option: RuleOption = {
      key: ruleKeyOf(rule),
      resolved,
      indication: resolved.indication,
      bound: resolved.indication !== null || resolved.severalRegimens,
      position,
      match,
      plan,
      summary: ruleSummary(rule),
    };
    if (match.fit === 'yes') options.push(option);
    else pending.push(option);
  });
  quoted.sort((a, b) => (quotedRank.get(a) ?? 0) - (quotedRank.get(b) ?? 0));
  // Rules that name a population before those that name none; narrower populations first.
  options.sort(
    (a, b) =>
      Number(a.match.unstated) - Number(b.match.unstated) ||
      specificity(b.resolved.rule) - specificity(a.resolved.rule) ||
      // The instruction's general dose before a regimen of one indication.
      Number(a.bound) - Number(b.bound) ||
      completeness(b.resolved.rule) - completeness(a.resolved.rule) ||
      a.position - b.position,
  );
  const chosen = options.find((option) => option.key === item.ruleKey) ?? options[0] ?? null;
  const plan = chosen?.plan ?? null;

  const days =
    item.days ??
    (chosen?.resolved.rule.t0 !== undefined && !chosen.resolved.rule.tm
      ? chosen.resolved.rule.t0
      : SECTION_BY_DEFAULT_DAYS_UNKNOWN);
  const caps: CapView[] = [];
  if (plan?.status === 'ok') {
    // Only a cap the gate lets compute is compared; a rejected cap is quoted, not compared.
    const trusted = (_rule: DoseRule, at: number): boolean =>
      enabled && instruction.rules[at]?.computable === true;
    for (const check of checkCaps(doseRules, plan, patient, days, trusted)) {
      const resolved = instruction.rules[check.ruleIndex];
      if (resolved && resolved.rule.k === RULE_CAP) caps.push({ check, resolved });
    }
  }
  const quantity =
    plan && plan.status === 'ok' && days !== null ? planQuantity(plan, days, product) : null;
  const packSize =
    item.packSize !== null && quantity?.options.some((option) => option.size === item.packSize)
      ? item.packSize
      : (quantity?.best?.size ?? null);

  const routeBits = chosen?.resolved.rule.rt ?? 0;
  const label = card.n ? cardDisplayName(card.s) : item.label;
  const computedSigna =
    plan && plan.status === 'ok' && form !== null
      ? signaText({
          form,
          routeBits,
          units: plan.units,
          singleAmount:
            plan.actualSingle !== null &&
            plan.unit !== 'piece' &&
            plan.unit !== 'drop' &&
            plan.unit !== 'dose'
              ? { value: plan.actualSingle, unit: plan.unit }
              : null,
          intakesPerDay: plan.intakes,
          periodDays: plan.periodDays,
          days,
        })
      : '';
  const chosenPack =
    quantity?.options.find((option) => option.size === packSize) ?? quantity?.best ?? null;
  const computedRp =
    form !== null && strength !== null
      ? rpLine({
          latinName: card.l ?? null,
          russianName: label,
          form,
          strength,
          quantity:
            quantity === null
              ? null
              : quantity.unitKind === 'ml' && chosenPack
                ? chosenPack.size
                : quantity.totalUnits,
          quantityKind: quantity?.unitKind ?? null,
        })
      : '';

  return {
    ...base,
    state: 'ready',
    options,
    pending,
    restricted,
    quoted,
    quotedMarks,
    chosen,
    plan,
    caps,
    durations,
    days,
    quantity,
    packSize,
    signa: item.signa ?? computedSigna,
    rp: item.rp ?? computedRp,
    divisible: instruction.divisible,
    instruction,
  };
}

/** «21 шт. · 1 упаковка по 21 шт.»: the course in pieces (or millilitres) and in packages. */
export function quantityText(analysis: ItemAnalysis): string | null {
  const quantity = analysis.quantity;
  if (!quantity) return null;
  const unit = quantity.unitKind === 'ml' ? 'мл' : quantity.unitKind === 'piece' ? 'шт.' : 'доз';
  const total = `${decimalText(quantity.totalUnits)} ${unit}`;
  const pack =
    quantity.options.find((option) => option.size === analysis.packSize) ?? quantity.best;
  if (!pack) return total;
  const packages = `${pack.packages} ${pluralRu(pack.packages, 'упаковка', 'упаковки', 'упаковок')} по ${countText(pack.size)} ${unit}`;
  return `${total} · ${packages}`;
}

export { formClassOf };

export interface IntakeRow {
  readonly label: string;
  readonly value: string;
  /** A quiet second line: the rounding, the range the instruction allows. */
  readonly note?: string;
}

function unitNoun(
  count: number,
  kind: UnitsPlan['kind'],
  form: string | null,
  piece: UnitsPlan['piece'],
): string {
  if (kind === 'ml') return 'мл';
  if (kind === 'drop') return pluralRu(Math.round(count), 'капля', 'капли', 'капель');
  if (kind === 'dose') return pluralRu(Math.round(count), 'доза', 'дозы', 'доз');
  // What the instruction counts (a spoon, an ampoule) comes before the piece word of the dosage form.
  const words = pieceWordsOfKind(piece) ?? (form ? pieceWords(form) : null);
  if (!words) return 'шт.';
  if (!Number.isInteger(count)) return words.genitive;
  return pluralRu(count, words.nominative, words.few, words.many);
}

/** The computed intake as labelled rows for the screen; empty while the arithmetic is not possible. */
export function intakeRows(analysis: ItemAnalysis): readonly IntakeRow[] {
  const plan = analysis.plan;
  if (!plan || plan.status !== 'ok' || plan.single === null) return [];
  const rows: IntakeRow[] = [];
  const massLike = plan.unit !== 'piece' && plan.unit !== 'drop' && plan.unit !== 'dose';
  if (plan.units) {
    const count = `${countText(plan.units.count)} ${unitNoun(plan.units.count, plan.units.kind, analysis.form, plan.units.piece)}`;
    const deviation = plan.units.deviationPercent;
    const rounded =
      !plan.units.fromInstruction && deviation !== null && Math.abs(deviation) >= 1
        ? `округлено до доступной формы: ${deviation > 0 ? '+' : '−'}${Math.abs(Math.round(deviation))} % от ${amountText(plan.single, plan.unit)}`
        : undefined;
    rows.push({
      label: 'На приём',
      value:
        massLike && plan.units.amount !== null
          ? `${count} · ${amountText(plan.units.amount, plan.unit)}`
          : // «1 чайная ложка · 5 мл»: the instruction's own measure and its volume.
            massLike && plan.unit === 'ml' && plan.units.fromInstruction
            ? `${count} · ${amountText(plan.single, plan.unit)}`
            : count,
      ...(rounded ? { note: rounded } : {}),
    });
  } else if (massLike) {
    const refused = plan.refusedRounding;
    rows.push({
      label: 'На приём',
      value: amountText(plan.single, plan.unit),
      ...(refused
        ? {
            note: `число единиц не указано: ближайшая доза выбранной дозировки ${amountText(refused.amount, plan.unit)} (${refused.deviationPercent > 0 ? '+' : '−'}${Math.abs(Math.round(refused.deviationPercent))} %) отличается от расчётной больше чем на ${ROUNDING_TOLERANCE_PERCENT} %`,
          }
        : {}),
    });
  }
  if (plan.intakes !== null) {
    rows.push({ label: 'Приёмов', value: frequencyPhrase(plan.intakes, plan.periodDays) });
  }
  if (plan.actualDaily !== null && massLike && plan.periodDays === 1) {
    rows.push({ label: 'В сутки', value: amountText(plan.actualDaily, plan.unit) });
  }
  return rows;
}
