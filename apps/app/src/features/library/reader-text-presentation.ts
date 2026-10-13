import { CLEANED_SECTION_TITLES } from '@/features/library/document-display';
import { documentTextSearchText } from '@/features/library/document-text-search';
import { presentSourceChunkText } from '@/features/search/search-result-presentation';

/**
 * Reader words for catalogue text. The registry (ЕСКЛП) and the card builders write their lines as
 * «key: value» dumps with internal codes; a doctor reads «Таблетки, 500 мг · АО АВВА РУС». Only the
 * display changes: the stored text, its checksum and its anchors stay as they were.
 */

/** A registry code that stands for one dosage form: «21.20.10.191-000003-1-00167-0000000000000». */
const SMNN_CODE_PATTERN = /\d{2}\.\d{2}\.\d{2}\.\d{3}-\d{6}-\d-\d{5}-\d{13}/u;

/** «500.0мг» → «500 мг», «0.25г» → «0,25 г»: one way to write a strength. */
export function normalizeStrength(value: string): string {
  return value
    .trim()
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

/** «ТАБЛЕТКИ (500 мг)» → «Таблетки, 500 мг». */
export function normalizePresentation(value: string): string {
  const match = /^(.*?)\s*\((.+)\)\s*$/u.exec(value.trim());
  if (!match) return sentenceCaseUpper(value);
  return `${sentenceCaseUpper(match[1] ?? '')}, ${normalizeStrength(match[2] ?? '')}`;
}

function isEmptyValue(value: string | undefined): boolean {
  const text = (value ?? '').trim().toLocaleLowerCase('ru-RU');
  return text === '' || text === '~' || text === '-' || text.startsWith('не указан');
}

/** Section headings of a drug card made of a registry code: «Таблетки, 500 мг». */
export function presentReaderSectionTitle(title: string): string {
  const match = new RegExp(`^${SMNN_CODE_PATTERN.source}\\s*[—–-]\\s*(.+)$`, 'u').exec(
    title.trim(),
  );
  if (!match) return title;
  const parts = (match[1] ?? '').split(/\s+[—–]\s+/u).map((part) => part.trim());
  const [form = '', ...strengths] = parts;
  return [sentenceCaseUpper(form), ...strengths.map(normalizeStrength)]
    .filter((part) => part !== '')
    .join(', ');
}

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
  const formText = isEmptyValue(form) ? '' : sentenceCaseUpper(form ?? '');
  const strengthText = isEmptyValue(strength) ? '' : normalizeStrength(strength ?? '');
  return [formText, strengthText].filter((part) => part !== '').join(', ');
}

function priceText(value: string | undefined): string {
  if (isEmptyValue(value)) return '';
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
      forms && !isEmptyValue(forms)
        ? `Формы: ${forms.split(/;\s*/u).map(sentenceCaseUpper).join('; ')}`
        : '',
      strengths && !isEmptyValue(strengths)
        ? `Дозировки: ${strengths.split(/;\s*/u).map(normalizeStrength).join('; ')}`
        : '',
    ].filter((part) => part !== '');
    return parts.length > 0 ? `${bullet}${parts.join('. ')}.` : null;
  }
  const compact = values.get('форма/дозировка');
  const name = values.get('ТН');
  const details = compact
    ? compact.split(/;\s*/u).map(normalizePresentation).join('; ')
    : presentation(values.get('Лекарственная форма'), values.get('Дозировка/концентрация'));
  const lead = isEmptyValue(name) ? '' : sentenceCaseUpper(name ?? '');
  const holder = values.get('Держатель регистрации');
  const maker = values.get('Производитель');
  const unitCount = values.get('Количество единиц');
  const unit = values.get('Единица');
  const quantity =
    !isEmptyValue(unitCount) && !isEmptyValue(unit)
      ? `${(unitCount ?? '').replace(/\.0+$/u, '')} ${(unit ?? '').replace(/\s*\(.*\)$/u, '')}`
      : '';
  const packaging = [values.get('Первичная упаковка'), values.get('Вторичная упаковка')]
    .filter((value): value is string => !isEmptyValue(value))
    .map((value) => value.toLocaleLowerCase('ru-RU'))
    .join(', ');
  const tail = [
    quantity,
    packaging,
    isEmptyValue(holder) ? '' : (holder ?? ''),
    !isEmptyValue(maker) && maker !== holder ? `производитель ${maker ?? ''}` : '',
    values.get('Жизненно необходимый препарат')?.toLocaleLowerCase('ru-RU') === 'да' ? 'ЖНВЛП' : '',
    priceText(values.get('Цена')),
  ].filter((part) => part !== '');
  const registration = values.get('Регистрация');
  // Under a heading that already says «Таблетки, 500 мг» the trade name is enough.
  const shownDetails = lead !== '' && details === sameAsHeading ? '' : details;
  const head = [lead, shownDetails].filter((part) => part !== '').join(' — ');
  const text = [
    head,
    ...(registration && !isEmptyValue(registration) && !values.has('КЛП')
      ? [`рег. ${registration}`]
      : []),
    ...tail,
  ]
    .filter((part) => part !== '')
    .join(' · ');
  return text === '' ? null : `${bullet}${text}`;
}

/** The raw link a card builder appends to its source line: the reader keeps the source's name. */
const SOURCE_LINK_LINES: readonly (readonly [RegExp, string])[] = [
  [/^(Источник: [^—\n]+?)\s+[—-]\s+https?:\/\/\S+\s*$/gmu, '$1'],
  [/^Официальная страница записи: https?:\/\/\S+\s*$\n?/gmu, ''],
];

/**
 * A chunk's text as the reader shows it. Technical cards lose their catalogue labels, identifiers
 * and empty fields; registry dumps become one readable line each. Returns the text unchanged when
 * nothing applies, so the caller can keep exact highlight offsets in that case.
 */
export function presentReaderChunkText(
  text: string,
  sectionTitle: string,
  sourceType: string,
): string {
  let result = text;
  if (CLEANED_SECTION_TITLES.has(sectionTitle.trim())) {
    result = presentSourceChunkText(result, [sectionTitle.trim()]);
  }
  if (
    sourceType === 'official_registry_summary' ||
    sourceType === 'core_catalog_pointer' ||
    /ТН:|КЛП:|СМНН:/u.test(result)
  ) {
    result = result
      .split('\n')
      .map((line) => presentRegistryLine(line, presentReaderSectionTitle(sectionTitle)) ?? line)
      .join('\n');
  }
  for (const [pattern, replacement] of SOURCE_LINK_LINES) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * The text in-document find searches for one plain-text chunk: exactly what the reader shows
 * (reader words, parsed blocks), never the stored text with its hidden labels and identifiers.
 */
export function readerChunkFindText(
  text: string,
  sectionTitle: string,
  sourceType: string,
  sourceSpans?: unknown,
): string {
  return documentTextSearchText(
    presentReaderChunkText(text, sectionTitle, sourceType),
    sourceSpans,
  );
}
