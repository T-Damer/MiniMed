/**
 * The registry rows of «Сравнение препаратов» (CMP1): МНН, ATC group (НСИ names), the registry's
 * pharmacotherapeutic group, dosage forms and strengths (ЕСКЛП), conditions of dispensing (ГРЛС),
 * the ЖНВЛП flag (ЕСКЛП) and the number of registrations and manufacturers (ЕСКЛП). Pure: the
 * values come from the build-time index and the НСИ «АТХ» names, every line names its source, and
 * nothing is worded as an advantage of one drug over another.
 */
import {
  type AtcNameCatalog,
  atcPrefixes,
  normalizeAtcCode,
} from '@/features/medications/atc-code';
import { displayDrugName } from '@/features/medications/drug-screen';
import { pluralRu } from '@/i18n/labels';
import {
  type AssetCard,
  type ComparisonIndexAsset,
  ESSENTIAL_LISTED,
  ESSENTIAL_NOT_LISTED,
} from './comparison-index';

export interface RegistryRowSpec {
  readonly id: 'mnn' | 'atc' | 'group' | 'forms' | 'dispensing' | 'essential' | 'counts';
  readonly title: string;
  /** Where the values come from, for the row's source line. */
  readonly source: string;
}

/** The registry rows, in reading order. */
export const REGISTRY_ROWS: readonly RegistryRowSpec[] = [
  { id: 'mnn', title: 'МНН', source: 'ЕСКЛП' },
  { id: 'atc', title: 'Код АТХ и группа', source: 'ЕСКЛП, названия групп: НСИ «АТХ»' },
  { id: 'group', title: 'Фармакотерапевтическая группа (реестр)', source: 'ЕСКЛП' },
  { id: 'forms', title: 'Лекарственные формы и дозировки', source: 'ЕСКЛП' },
  { id: 'dispensing', title: 'Условия отпуска (реестр)', source: 'ГРЛС' },
  { id: 'essential', title: 'Перечень ЖНВЛП', source: 'ЕСКЛП' },
  { id: 'counts', title: 'Регистрации и производители', source: 'ЕСКЛП' },
];

export interface RegistryCell {
  /** Lines shown at once. */
  readonly lines: readonly string[];
  /** Lines behind «ещё N». */
  readonly more: readonly string[];
  /** The registry has nothing for this drug in this row. */
  readonly empty: boolean;
}

const EMPTY: RegistryCell = { lines: ['В реестре не указано'], more: [], empty: true };
const VISIBLE_LINES = 4;

function sentenceCase(value: string): string {
  const text = value.trim();
  return text ? text.charAt(0).toLocaleUpperCase('ru-RU') + text.slice(1) : text;
}

function cell(lines: readonly string[], visible = VISIBLE_LINES): RegistryCell {
  if (lines.length === 0) return EMPTY;
  return { lines: lines.slice(0, visible), more: lines.slice(visible), empty: false };
}

/** «M01AE01 — … › Производные пропионовой кислоты»: the code and the НСИ names of its groups. */
function atcLine(code: string, catalog: AtcNameCatalog | null): string {
  const normalized = normalizeAtcCode(code);
  if (!normalized) return code;
  const names: string[] = [];
  for (const prefix of atcPrefixes(normalized.code)) {
    if (prefix.level < 3 || prefix.level > 4) continue;
    const name = catalog?.names[prefix.code]?.trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names.length > 0 ? `${normalized.code} — ${names.join(' › ')}` : normalized.code;
}

function formsLines(card: AssetCard, forms: readonly string[]): readonly string[] {
  return card.f.map(([form, strengths]) => {
    const name = sentenceCase(forms[form] ?? '');
    return strengths.length > 0 ? `${name}: ${strengths.join(', ')}` : name;
  });
}

function dispensingLines(card: AssetCard): readonly string[] {
  const counts = card.x;
  if (!counts) return [];
  const [rx, otc, mixed, unknown] = counts;
  const lines: string[] = [];
  const add = (count: number, label: string): void => {
    if (count > 0) lines.push(`${label}: ${count} ${registrationWord(count)}`);
  };
  add(rx, 'По рецепту');
  add(otc, 'Без рецепта');
  add(mixed, 'Смешанные условия отпуска');
  add(unknown, 'Условия не указаны');
  return lines;
}

export function registrationWord(count: number): string {
  return pluralRu(count, 'регистрация', 'регистрации', 'регистраций');
}

function essentialLines(card: AssetCard, forms: readonly string[]): readonly string[] {
  const listed: string[] = [];
  const notListed: string[] = [];
  for (const [form, , essential] of card.f) {
    const name = forms[form] ?? '';
    if ((essential & ESSENTIAL_LISTED) !== 0) listed.push(name);
    if ((essential & ESSENTIAL_NOT_LISTED) !== 0 && (essential & ESSENTIAL_LISTED) === 0) {
      notListed.push(name);
    }
  }
  if (listed.length === 0 && notListed.length === 0) return [];
  if (notListed.length === 0 && listed.length === card.f.length) {
    return ['Входит: все формы, указанные в реестре'];
  }
  if (listed.length === 0) return ['Не входит ни одна из форм, указанных в реестре'];
  return [
    `Входит: ${listed.map(sentenceCase).join('; ')}`,
    `Не входит: ${notListed.map(sentenceCase).join('; ')}`,
  ];
}

function countsLines(card: AssetCard): readonly string[] {
  if (card.r === 0 && card.t === 0) return [];
  const registrations = `${card.r} ${pluralRu(card.r, 'регистрационное удостоверение', 'регистрационных удостоверения', 'регистрационных удостоверений')}`;
  return [
    registrations,
    `${card.t} ${pluralRu(card.t, 'торговое наименование', 'торговых наименования', 'торговых наименований')}`,
    `${card.m} ${pluralRu(card.m, 'производитель', 'производителя', 'производителей')}`,
    `${card.h} ${pluralRu(card.h, 'держатель удостоверения', 'держателя удостоверения', 'держателей удостоверения')}`,
  ];
}

/** The cell of one registry row for one drug. */
export function registryCell(
  rowId: RegistryRowSpec['id'],
  card: AssetCard,
  asset: Pick<ComparisonIndexAsset, 'forms'>,
  catalog: AtcNameCatalog | null,
): RegistryCell {
  switch (rowId) {
    case 'mnn':
      return cell([displayDrugName(card.n)]);
    case 'atc':
      return cell(
        card.a.map((code) => atcLine(code, catalog)),
        3,
      );
    case 'group':
      return cell(card.g.map(sentenceCase), 3);
    case 'forms':
      return cell(formsLines(card, asset.forms), 5);
    case 'dispensing':
      return cell(dispensingLines(card));
    case 'essential':
      return cell(essentialLines(card, asset.forms));
    case 'counts':
      return cell(countsLines(card));
  }
}

/** «ЕСКЛП (выгрузка 2026-08-28), ГРЛС (02.10.2026), НСИ «АТХ» версия 3.8». */
export function registrySourceLine(
  asset: Pick<ComparisonIndexAsset, 'basis'>,
  catalog: AtcNameCatalog | null,
): string {
  const parts = [
    `ЕСКЛП (выгрузка ${asset.basis.esklp.edition})`,
    `ГРЛС (${asset.basis.grls.edition})`,
  ];
  if (catalog) parts.push(`НСИ «АТХ» (версия ${catalog.version})`);
  return parts.join(' · ');
}
