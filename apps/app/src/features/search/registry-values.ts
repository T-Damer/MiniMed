/**
 * Registry (ЕСКЛП) values in reader words. A leaf module: the search snippets and the reader both
 * write a dosage the same way, so neither imports the other.
 *
 * Only the display changes; stored text, checksums and anchors stay as the module built them.
 */

/**
 * The registry's «Кол-во» placeholder «1.0» that older modules glued to a combination drug's
 * dosage («1.0 650 мг+10 мг+20 мг», «1.0325 мг+10 мг+20 мг», «1.01.42 мг+18.26 мг+20 мг/мл»).
 * The spaced form is unambiguous; the glued one is read as the placeholder only in front of a
 * composite dosage («число единица +»), where «1.0» + a digit is never a real quantity.
 */
const PLACEHOLDER_QUANTITY = /^1\.0(?:\s+(?=[\d(])|(?=[\d.,]+\s*[А-Яа-яA-Za-zµ%/]+\s*\+))/u;
/** «1.0~», «1.0 НЕ УКАЗАНО»: the placeholder in front of a dosage the registry does not state. */
const PLACEHOLDER_UNSTATED = /^1\.0\s*(?:~|не\s+указан\p{L}*)\s*$/iu;

/** True for a value that says nothing: empty, «~», «-», «НЕ УКАЗАНО» or the placeholder before one. */
export function isUnstatedValue(value: string | undefined | null): boolean {
  const text = (value ?? '').trim().toLocaleLowerCase('ru-RU');
  return (
    text === '' ||
    text === '~' ||
    text === '-' ||
    text.startsWith('не указан') ||
    isPlaceholder(text)
  );
}

function isPlaceholder(text: string): boolean {
  return PLACEHOLDER_UNSTATED.test(text);
}

/** A strength without the registry's placeholder quantity glued in front of it. */
export function dropPlaceholderQuantity(value: string): string {
  return value.trim().replace(PLACEHOLDER_QUANTITY, '');
}

/** «500.0мг» → «500 мг», «0.25г» → «0,25 г»: one way to write a strength. */
export function normalizeStrength(value: string): string {
  return dropPlaceholderQuantity(value)
    .replace(/(\d)\.0+(?!\d)/gu, '$1')
    .replace(/(\d)\.(\d)/gu, '$1,$2')
    .replace(/(\d)(?=[А-Яа-яA-Za-zЁё%])/gu, '$1 ')
    .replace(/\s+/gu, ' ');
}

/** «ТАБЛЕТКИ ДИСПЕРГИРУЕМЫЕ» → «Таблетки диспергируемые»; mixed case is already written by a person. */
export function sentenceCaseUpper(value: string): string {
  const text = value.trim();
  if (text === '' || text !== text.toLocaleUpperCase('ru-RU')) return text;
  const lower = text.toLocaleLowerCase('ru-RU');
  return `${lower.charAt(0).toLocaleUpperCase('ru-RU')}${lower.slice(1)}`;
}

/** «ТАБЛЕТКИ (500 мг)» → «Таблетки, 500 мг»; a dosage the registry does not state is left out. */
export function normalizePresentation(value: string): string {
  const match = /^(.*?)\s*\((.+)\)\s*$/u.exec(value.trim());
  if (!match) return sentenceCaseUpper(value);
  const form = sentenceCaseUpper(match[1] ?? '');
  const strength = match[2] ?? '';
  if (isUnstatedValue(strength)) return form;
  return `${form}, ${normalizeStrength(strength)}`;
}

/** One «ФОРМА (дозировка)» entry of a pointer line, a form that may itself hold commas. */
const FORM_STRENGTH_ENTRY = /\s*,?\s*([^()]+?)\s*\(([^()]*)\)/gu;

/**
 * The «форма/дозировка» value of a registry pointer line: one or several «ФОРМА (дозировка)»
 * entries («ТАБЛЕТКИ, ПОКРЫТЫЕ ОБОЛОЧКОЙ (10 мг), КАПСУЛЫ (НЕ УКАЗАНО)») as «Таблетки, покрытые
 * оболочкой, 10 мг; Капсулы». A value that is not in that shape is returned in reader case only.
 */
export function presentFormStrengths(compact: string): string {
  const entries = [...compact.matchAll(FORM_STRENGTH_ENTRY)];
  const covered = entries.reduce((total, entry) => total + entry[0].length, 0);
  if (entries.length === 0 || covered < compact.trim().length - 1) {
    return compact.split(/;\s*/u).map(normalizePresentation).join('; ');
  }
  const shown = entries.map((entry) => normalizePresentation(`${entry[1]} (${entry[2]})`));
  return [...new Set(shown)].join('; ');
}

/**
 * A list of strengths as a card text writes it («A, B, НЕ УКАЗАНО»): each one in reader words,
 * the unstated ones and the repeats left out, joined by «; ». Empty when nothing is stated.
 */
export function presentStrengthList(list: string): string {
  const shown = list
    .split(/\s*[;,]\s+/u)
    .filter((item) => !isUnstatedValue(item))
    .map(normalizeStrength);
  const spelledOnce = new Map<string, string>();
  for (const item of shown) {
    const key = item.replace(/\s+/gu, '');
    if (!spelledOnce.has(key)) spelledOnce.set(key, item);
  }
  return [...spelledOnce.values()].join('; ');
}

/** «АМЛОДИПИН+РОЗУВАСТАТИН [НАБОР]» → «амлодипин + розувастатин [набор]» for a sentence. */
export function substanceWords(name: string): string {
  return name
    .trim()
    .toLocaleLowerCase('ru-RU')
    .split('+')
    .map((part) => part.trim())
    .join(' + ');
}

// ---------------------------------------------------------------------------------------------
// One registry line as a reader sentence.
// ---------------------------------------------------------------------------------------------

const REGISTRY_LABELS = [
  'КЛП',
  'ТН',
  'Регистрация',
  'СМНН',
  'smnnCode',
  'Лекарственная форма',
  'Дозировка/концентрация',
  'Единица',
  'Количество единиц',
  'Первичная упаковка',
  'Вторичная упаковка',
  'Содержимое упаковки',
  'Держатель регистрации',
  'Производитель',
  'Жизненно необходимый препарат',
  'Период действия',
  'Цена',
  'Нормализованные МНН',
  'Нормализованные формы/дозировки',
  'Формы',
  'Дозировки/концентрации',
  'форма/дозировка',
] as const;

const LABEL_ALTERNATION = REGISTRY_LABELS.map((label) =>
  label.replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&'),
).join('|');
const LABEL_PATTERN = new RegExp(`(?:^|(?<=[.;]\\s))(${LABEL_ALTERNATION}):\\s*`, 'gu');

/** The «Label: value» pairs of one registry line, in order; a value runs to the next label. */
function labelledValues(line: string): ReadonlyMap<string, string> {
  const marks = [...line.matchAll(LABEL_PATTERN)];
  const values = new Map<string, string>();
  marks.forEach((mark, index) => {
    const label = mark[1] ?? '';
    const start = (mark.index ?? 0) + mark[0].length;
    const end = marks[index + 1]?.index ?? line.length;
    const value = line
      .slice(start, end)
      .trim()
      .replace(/[.;]+$/u, '')
      .trim();
    if (!values.has(label)) values.set(label, value);
  });
  return values;
}

function presentation(form: string | undefined, strength: string | undefined): string {
  const formText = isUnstatedValue(form) ? '' : sentenceCaseUpper(form ?? '');
  const strengthText = presentStrengthList(strength ?? '');
  return [formText, strengthText].filter((part) => part !== '').join(', ');
}

function priceText(value: string | undefined): string {
  if (isUnstatedValue(value)) return '';
  const text = (value ?? '').replace(/\s*р\.?$/iu, '').trim();
  return text === '' ? '' : `${text} ₽`;
}

/**
 * One registry line in reader words, or `null` when the line is none of the known shapes.
 * «- ТН: X; форма/дозировка: ТАБЛЕТКИ (500 мг)», the full trade-name line and the packaging line
 * all become «X — Таблетки, 500 мг · …»; the node line keeps its forms and strengths.
 */
export function presentRegistryLine(line: string, sameAsHeading = ''): string | null {
  const bullet = /^(\s*[-*]\s+)/u.exec(line)?.[1] ?? '';
  const body = line.slice(bullet.length).trim();
  if (!/^(?:КЛП|ТН|СМНН):/u.test(body)) return null;
  const values = labelledValues(body);
  if (body.startsWith('СМНН:')) {
    const forms = values.get('Формы');
    const strengths = values.get('Дозировки/концентрации');
    const parts = [
      forms && !isUnstatedValue(forms)
        ? `Формы: ${forms.split(/;\s*/u).map(sentenceCaseUpper).join('; ')}`
        : '',
      strengths && presentStrengthList(strengths) !== ''
        ? `Дозировки: ${presentStrengthList(strengths)}`
        : '',
    ].filter((part) => part !== '');
    return parts.length > 0 ? `${bullet}${parts.join('. ')}.` : null;
  }
  const compact = values.get('форма/дозировка');
  const name = values.get('ТН');
  const details = compact
    ? presentFormStrengths(compact)
    : presentation(values.get('Лекарственная форма'), values.get('Дозировка/концентрация'));
  const lead = isUnstatedValue(name) ? '' : sentenceCaseUpper(name ?? '');
  const holder = values.get('Держатель регистрации');
  const maker = values.get('Производитель');
  const unitCount = values.get('Количество единиц');
  const unit = values.get('Единица');
  const quantity =
    !isUnstatedValue(unitCount) && !isUnstatedValue(unit)
      ? `${(unitCount ?? '').replace(/\.0+$/u, '')} ${(unit ?? '').replace(/\s*\(.*\)$/u, '')}`
      : '';
  const packaging = [values.get('Первичная упаковка'), values.get('Вторичная упаковка')]
    .filter((value): value is string => !isUnstatedValue(value))
    .map((value) => value.toLocaleLowerCase('ru-RU'))
    .join(', ');
  const tail = [
    quantity,
    packaging,
    isUnstatedValue(holder) ? '' : (holder ?? ''),
    !isUnstatedValue(maker) && maker !== holder ? `производитель ${maker ?? ''}` : '',
    values.get('Жизненно необходимый препарат')?.toLocaleLowerCase('ru-RU') === 'да' ? 'ЖНВЛП' : '',
    priceText(values.get('Цена')),
  ].filter((part) => part !== '');
  const registration = values.get('Регистрация');
  // Under a heading that already says «Таблетки, 500 мг» the trade name is enough.
  const shownDetails = lead !== '' && details === sameAsHeading ? '' : details;
  const head = [lead, shownDetails].filter((part) => part !== '').join(' — ');
  const text = [
    head,
    ...(registration && !isUnstatedValue(registration) && !values.has('КЛП')
      ? [`рег. ${registration}`]
      : []),
    ...tail,
  ]
    .filter((part) => part !== '')
    .join(' · ');
  return text === '' ? null : `${bullet}${text}`;
}
