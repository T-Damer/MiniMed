import type {
  Border,
  Borders,
  Color,
  Workbook as ExcelWorkbook,
  Worksheet as ExcelWorksheet,
  Fill,
  Style,
} from 'exceljs';
import { createEffect, createMemo, createSignal, For, type JSX, onMount, Show } from 'solid-js';
import { toast } from 'solid-sonner';
import type { CellObject, WorkBook, WorkSheet } from 'xlsx';

import { AppGlyph } from '@/components/AppGlyph';
import { preserveXlsmVba } from '@/features/library/spreadsheet-xlsm';
import { getUserLibraryFile, replaceUserLibraryFile } from '@/state/user-library';
import { userLibraryFileExtension } from '@/state/user-library-capabilities';

const MAX_RENDERED_CELLS = 200_000;
const DEFAULT_THEME = [
  'FFFFFF',
  '000000',
  'E7E6E6',
  '44546A',
  '4472C4',
  'ED7D31',
  'A5A5A5',
  'FFC000',
  '5B9BD5',
  '70AD47',
  '0563C1',
  '954F72',
] as const;

interface SheetCellView {
  readonly address: string;
  readonly text: string;
  readonly rowSpan: number;
  readonly columnSpan: number;
  readonly style: JSX.CSSProperties;
}

interface SheetRowView {
  readonly index: number;
  readonly height?: string;
  readonly hidden: boolean;
  readonly cells: readonly SheetCellView[];
}

interface SheetView {
  readonly name: string;
  readonly columns: readonly {
    readonly label: string;
    readonly width: string;
    readonly hidden: boolean;
  }[];
  readonly rows: readonly SheetRowView[];
}

interface ExcelSession {
  readonly kind: 'excel';
  readonly workbook: ExcelWorkbook;
  readonly theme: readonly string[];
  readonly original: ArrayBuffer;
}

interface SheetJsSession {
  readonly kind: 'sheetjs';
  readonly workbook: WorkBook;
}

type SpreadsheetSession = ExcelSession | SheetJsSession;

export interface SpreadsheetRendererProps {
  readonly documentId: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly fullscreen?: boolean | undefined;
  readonly activeSheetName?: string | undefined;
  readonly onSheetNamesChange?: ((sheetNames: readonly string[]) => void) | undefined;
  readonly onActiveSheetChange?: ((sheetName: string) => void) | undefined;
  readonly onExitFullscreen?: (() => void) | undefined;
}

function columnLabel(index: number): string {
  let value = index;
  let result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function decodeCellAddress(address: string): { readonly row: number; readonly column: number } {
  const match = /^([A-Z]+)(\d+)$/u.exec(address);
  if (!match) throw new Error(`Некорректный адрес ячейки: ${address}`);
  let column = 0;
  for (const character of match[1] ?? '') column = column * 26 + character.charCodeAt(0) - 64;
  return { row: Number(match[2]), column };
}

function decodeRange(range: string): {
  readonly startRow: number;
  readonly startColumn: number;
  readonly endRow: number;
  readonly endColumn: number;
} {
  const [start, end = start] = range.split(':');
  const first = decodeCellAddress(start ?? '');
  const last = decodeCellAddress(end ?? '');
  return {
    startRow: first.row,
    startColumn: first.column,
    endRow: last.row,
    endColumn: last.column,
  };
}

function parseTheme(themeXml: string | undefined): readonly string[] {
  if (!themeXml) return DEFAULT_THEME;
  const document = new DOMParser().parseFromString(themeXml, 'application/xml');
  const scheme = Array.from(document.getElementsByTagNameNS('*', 'clrScheme'))[0];
  if (!scheme) return DEFAULT_THEME;
  const colors = Array.from(scheme.children).map((entry) => {
    const color = entry.firstElementChild;
    return color?.getAttribute('lastClr') ?? color?.getAttribute('val') ?? '';
  });
  return colors.length >= DEFAULT_THEME.length ? colors : DEFAULT_THEME;
}

function tintChannel(channel: number, tint: number): number {
  return Math.round(tint < 0 ? channel * (1 + tint) : channel + (255 - channel) * tint);
}

function themeColor(
  color: Partial<Color> | undefined,
  theme: readonly string[],
): string | undefined {
  const argb = color?.argb;
  if (argb) return `#${argb.slice(-6)}`;
  if (color?.theme === undefined) return undefined;
  const rgb = theme[color.theme] ?? DEFAULT_THEME[color.theme];
  if (!rgb) return undefined;
  const tint = 'tint' in color && typeof color.tint === 'number' ? color.tint : 0;
  const channels = [0, 2, 4].map((offset) =>
    tintChannel(Number.parseInt(rgb.slice(offset, offset + 2), 16), tint),
  );
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function borderCss(
  border: Partial<Border> | undefined,
  theme: readonly string[],
): string | undefined {
  if (!border?.style) return undefined;
  const width =
    border.style === 'thin' || border.style === 'hair'
      ? '1px'
      : border.style === 'medium'
        ? '2px'
        : '3px';
  const style = border.style.includes('dash')
    ? 'dashed'
    : border.style === 'dotted'
      ? 'dotted'
      : border.style === 'double'
        ? 'double'
        : 'solid';
  return `${width} ${style} ${themeColor(border.color, theme) ?? '#808080'}`;
}

function excelStyle(
  style: Partial<Style>,
  theme: readonly string[],
  mergedBorders?: Partial<Borders>,
): JSX.CSSProperties {
  const font = style.font;
  const alignment = style.alignment;
  const fill = style.fill as Fill | undefined;
  const patternFill = fill?.type === 'pattern' ? fill : undefined;
  const background = themeColor(
    patternFill?.pattern === 'solid' ? patternFill.fgColor : patternFill?.bgColor,
    theme,
  );
  const borders = { ...style.border, ...mergedBorders };
  const rotation = typeof alignment?.textRotation === 'number' ? alignment.textRotation : undefined;
  const horizontal =
    alignment?.horizontal === 'centerContinuous'
      ? 'center'
      : alignment?.horizontal === 'fill'
        ? 'left'
        : alignment?.horizontal === 'distributed'
          ? 'justify'
          : alignment?.horizontal;
  return {
    ...(background ? { 'background-color': background } : {}),
    ...(font?.name ? { 'font-family': `"${font.name}", sans-serif` } : {}),
    ...(font?.size ? { 'font-size': `${String(font.size)}pt` } : {}),
    ...(font?.bold ? { 'font-weight': '700' } : {}),
    ...(font?.italic ? { 'font-style': 'italic' } : {}),
    ...(font?.color ? { color: themeColor(font.color, theme) } : {}),
    ...(horizontal ? { 'text-align': horizontal } : {}),
    ...(alignment?.vertical
      ? { 'vertical-align': alignment.vertical === 'middle' ? 'middle' : alignment.vertical }
      : {}),
    ...(alignment?.wrapText ? { 'white-space': 'pre-wrap' } : {}),
    ...(rotation ? { transform: `rotate(${String(rotation)}deg)` } : {}),
    ...(borderCss(borders.top, theme) ? { 'border-top': borderCss(borders.top, theme) } : {}),
    ...(borderCss(borders.right, theme) ? { 'border-right': borderCss(borders.right, theme) } : {}),
    ...(borderCss(borders.bottom, theme)
      ? { 'border-bottom': borderCss(borders.bottom, theme) }
      : {}),
    ...(borderCss(borders.left, theme) ? { 'border-left': borderCss(borders.left, theme) } : {}),
  };
}

function mergeMaps(merges: readonly string[]): {
  readonly starts: ReadonlyMap<string, ReturnType<typeof decodeRange>>;
  readonly covered: ReadonlySet<string>;
} {
  const starts = new Map<string, ReturnType<typeof decodeRange>>();
  const covered = new Set<string>();
  for (const merge of merges) {
    const range = decodeRange(merge);
    starts.set(`${String(range.startRow)}:${String(range.startColumn)}`, range);
    for (let row = range.startRow; row <= range.endRow; row += 1) {
      for (let column = range.startColumn; column <= range.endColumn; column += 1) {
        if (row !== range.startRow || column !== range.startColumn)
          covered.add(`${String(row)}:${String(column)}`);
      }
    }
  }
  return { starts, covered };
}

function ensureSafeSize(rows: number, columns: number): void {
  if (rows * columns > MAX_RENDERED_CELLS)
    throw new Error('Таблица слишком велика для безопасного отображения целиком.');
}

function excelSheetView(worksheet: ExcelWorksheet, theme: readonly string[]): SheetView {
  const rowCount = Math.max(worksheet.rowCount, 1);
  const columnCount = Math.max(worksheet.columnCount, 1);
  ensureSafeSize(rowCount, columnCount);
  const merges = mergeMaps(worksheet.model.merges);
  const columns = Array.from({ length: columnCount }, (_, index) => {
    const column = worksheet.getColumn(index + 1);
    return {
      label: columnLabel(index + 1),
      width: `${String(Math.max(12, Math.round((column.width ?? 8.43) * 7)))}px`,
      hidden: Boolean(column.hidden),
    };
  });
  const rows = Array.from({ length: rowCount }, (_, rowIndex) => {
    const rowNumber = rowIndex + 1;
    const row = worksheet.getRow(rowNumber);
    const cells: SheetCellView[] = [];
    for (let column = 1; column <= columnCount; column += 1) {
      const key = `${String(rowNumber)}:${String(column)}`;
      if (merges.covered.has(key)) continue;
      const cell = row.getCell(column);
      const merge = merges.starts.get(key);
      const rightBorder = merge
        ? worksheet.getCell(merge.startRow, merge.endColumn).border.right
        : undefined;
      const bottomBorder = merge
        ? worksheet.getCell(merge.endRow, merge.startColumn).border.bottom
        : undefined;
      const mergedBorders = merge
        ? {
            ...(rightBorder ? { right: rightBorder } : {}),
            ...(bottomBorder ? { bottom: bottomBorder } : {}),
          }
        : undefined;
      cells.push({
        address: cell.address,
        text: cell.text,
        rowSpan: merge ? merge.endRow - merge.startRow + 1 : 1,
        columnSpan: merge ? merge.endColumn - merge.startColumn + 1 : 1,
        style: excelStyle(cell.style, theme, mergedBorders),
      });
    }
    return {
      index: rowNumber,
      ...(row.height ? { height: `${String((row.height * 4) / 3)}px` } : {}),
      hidden: Boolean(row.hidden),
      cells,
    };
  });
  return { name: worksheet.name, columns, rows };
}

interface StyledSheetJsCell extends CellObject {
  readonly s?: {
    readonly patternType?: string;
    readonly fgColor?: { readonly rgb?: string };
    readonly bgColor?: { readonly rgb?: string };
  };
}

function sheetJsCellStyle(cell: StyledSheetJsCell | undefined): JSX.CSSProperties {
  const rgb = cell?.s?.patternType === 'solid' ? cell.s.fgColor?.rgb : cell?.s?.bgColor?.rgb;
  return rgb ? { 'background-color': `#${rgb.slice(-6)}` } : {};
}

function sheetJsView(worksheet: WorkSheet, name: string): SheetView {
  const XLSX = requireSheetJs();
  const range = XLSX.utils.decode_range(worksheet['!ref'] ?? 'A1');
  const rowCount = range.e.r + 1;
  const columnCount = range.e.c + 1;
  ensureSafeSize(rowCount, columnCount);
  const mergeNames = (worksheet['!merges'] ?? []).map((merge) => XLSX.utils.encode_range(merge));
  const merges = mergeMaps(mergeNames);
  const columns = Array.from({ length: columnCount }, (_, index) => ({
    label: columnLabel(index + 1),
    width: `${String(Math.max(12, worksheet['!cols']?.[index]?.wpx ?? Math.round((worksheet['!cols']?.[index]?.wch ?? 8.43) * 7)))}px`,
    hidden: Boolean(worksheet['!cols']?.[index]?.hidden),
  }));
  const rows = Array.from({ length: rowCount }, (_, rowIndex) => {
    const cells: SheetCellView[] = [];
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const rowNumber = rowIndex + 1;
      const columnNumber = columnIndex + 1;
      const key = `${String(rowNumber)}:${String(columnNumber)}`;
      if (merges.covered.has(key)) continue;
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      const cell = worksheet[address] as StyledSheetJsCell | undefined;
      const merge = merges.starts.get(key);
      cells.push({
        address,
        text: cell?.w ?? (cell?.v === undefined || cell.v === null ? '' : String(cell.v)),
        rowSpan: merge ? merge.endRow - merge.startRow + 1 : 1,
        columnSpan: merge ? merge.endColumn - merge.startColumn + 1 : 1,
        style: sheetJsCellStyle(cell),
      });
    }
    const height = worksheet['!rows']?.[rowIndex]?.hpx;
    return {
      index: rowIndex + 1,
      ...(height ? { height: `${String(height)}px` } : {}),
      hidden: Boolean(worksheet['!rows']?.[rowIndex]?.hidden),
      cells,
    };
  });
  return { name, columns, rows };
}

let sheetJsModule: typeof import('xlsx') | undefined;

function requireSheetJs(): typeof import('xlsx') {
  if (!sheetJsModule) throw new Error('Модуль чтения XLS ещё не загружен.');
  return sheetJsModule;
}

export async function loadSpreadsheetSession(
  data: ArrayBuffer,
  fileName: string,
): Promise<SpreadsheetSession> {
  const extension = userLibraryFileExtension(fileName);
  if (extension === 'xlsx' || extension === 'xlsm') {
    const { Workbook } = await import('exceljs');
    const workbook = new Workbook();
    const input = new Uint8Array(data) as unknown as Parameters<typeof workbook.xlsx.load>[0];
    await workbook.xlsx.load(input);
    return {
      kind: 'excel',
      workbook,
      theme: parseTheme(workbook.model.themes[0]),
      original: data.slice(0),
    };
  }
  sheetJsModule = await import('xlsx');
  return {
    kind: 'sheetjs',
    workbook: sheetJsModule.read(data, {
      type: 'array',
      cellFormula: true,
      cellNF: true,
      cellStyles: true,
      sheetStubs: true,
    }),
  };
}

function sessionSheetNames(session: SpreadsheetSession): readonly string[] {
  return session.kind === 'excel'
    ? session.workbook.worksheets.map((sheet) => sheet.name)
    : session.workbook.SheetNames;
}

function sessionCellText(session: SpreadsheetSession, sheetName: string, address: string): string {
  if (session.kind === 'excel')
    return session.workbook.getWorksheet(sheetName)?.getCell(address).text ?? '';
  const cell = session.workbook.Sheets[sheetName]?.[address] as StyledSheetJsCell | undefined;
  return cell?.w ?? (cell?.v === undefined || cell.v === null ? '' : String(cell.v));
}

function sessionSheetView(session: SpreadsheetSession, name: string): SheetView {
  if (session.kind === 'excel') {
    const worksheet = session.workbook.getWorksheet(name);
    if (!worksheet) throw new Error(`Лист «${name}» не найден.`);
    return excelSheetView(worksheet, session.theme);
  }
  const worksheet = session.workbook.Sheets[name];
  if (!worksheet) throw new Error(`Лист «${name}» не найден.`);
  return sheetJsView(worksheet, name);
}

function editedCellValue(text: string): string | number | boolean {
  const trimmed = text.trim();
  if (/^-?(?:\d+|\d*\.\d+)$/u.test(trimmed)) return Number(trimmed);
  if (trimmed.toLocaleLowerCase('en-US') === 'true') return true;
  if (trimmed.toLocaleLowerCase('en-US') === 'false') return false;
  return text;
}

function updateSessionCell(
  session: SpreadsheetSession,
  sheetName: string,
  address: string,
  text: string,
): void {
  const value = editedCellValue(text);
  if (session.kind === 'excel') {
    const worksheet = session.workbook.getWorksheet(sheetName);
    if (!worksheet) throw new Error(`Лист «${sheetName}» не найден.`);
    worksheet.getCell(address).value = value;
    return;
  }
  const sheet = session.workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Лист «${sheetName}» не найден.`);
  const existing = sheet[address] as StyledSheetJsCell | undefined;
  sheet[address] = {
    ...existing,
    t: typeof value === 'number' ? 'n' : typeof value === 'boolean' ? 'b' : 's',
    v: value,
    w: String(value),
  };
}

async function serializeSession(
  session: SpreadsheetSession,
  fileName: string,
  activeSheetName: string,
): Promise<ArrayBuffer> {
  const extension = userLibraryFileExtension(fileName);
  if (session.kind === 'excel') {
    const bytes = await session.workbook.xlsx.writeBuffer({
      useStyles: true,
      useSharedStrings: true,
    });
    const edited = new Uint8Array(bytes as unknown as ArrayLike<number>).buffer;
    return extension === 'xlsm' ? await preserveXlsmVba(session.original, edited) : edited;
  }
  const XLSX = requireSheetJs();
  if (extension === 'csv') {
    const sheet = session.workbook.Sheets[activeSheetName];
    if (!sheet) throw new Error(`Лист «${activeSheetName}» не найден.`);
    return new TextEncoder().encode(`\ufeff${XLSX.utils.sheet_to_csv(sheet)}`).buffer;
  }
  return XLSX.write(session.workbook, {
    type: 'array',
    bookType: 'biff8',
    bookVBA: true,
    cellStyles: true,
  }) as ArrayBuffer;
}

export function sheetAnchorId(documentId: string, sheetName: string): string {
  const encoded = Array.from(new TextEncoder().encode(sheetName), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return `user-sheet-${documentId}-${encoded}`;
}

export function SpreadsheetRenderer(props: SpreadsheetRendererProps): JSX.Element {
  const [session, setSession] = createSignal<SpreadsheetSession>();
  const [activeSheet, setActiveSheet] = createSignal('');
  const [editing, setEditing] = createSignal(false);
  const [dirty, setDirty] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');
  const [version, setVersion] = createSignal(0);
  const [selectedAddress, setSelectedAddress] = createSignal('A1');
  const [selectedText, setSelectedText] = createSignal('');

  const load = async (): Promise<void> => {
    const blob = await getUserLibraryFile(props.documentId);
    if (!blob) throw new Error('Файл таблицы недоступен.');
    const next = await loadSpreadsheetSession(await blob.arrayBuffer(), props.fileName);
    const names = sessionSheetNames(next);
    setSession(next);
    props.onSheetNamesChange?.(names);
    const requested = props.activeSheetName;
    const first = requested && names.includes(requested) ? requested : (names[0] ?? '');
    setActiveSheet(first);
    if (first) props.onActiveSheetChange?.(first);
    setSelectedAddress('A1');
    setSelectedText(first ? sessionCellText(next, first, 'A1') : '');
    setVersion((value) => value + 1);
  };

  onMount(() => {
    void load().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'Не удалось открыть таблицу.');
    });
  });

  const sheetNames = createMemo(() => {
    const current = session();
    return current ? sessionSheetNames(current) : [];
  });

  const sheet = createMemo(() => {
    version();
    const current = session();
    const name = props.activeSheetName || activeSheet();
    if (!current || !name) return undefined;
    try {
      return sessionSheetView(current, name);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось отобразить лист.');
      return undefined;
    }
  });

  const selectedCoordinates = createMemo(() => decodeCellAddress(selectedAddress()));

  let selectedSheetName = '';
  createEffect(() => {
    const current = sheet();
    const currentSession = session();
    if (!current || !currentSession || current.name === selectedSheetName) return;
    selectedSheetName = current.name;
    setSelectedAddress('A1');
    setSelectedText(sessionCellText(currentSession, current.name, 'A1'));
  });

  let wasFullscreen = false;
  createEffect(() => {
    const fullscreen = Boolean(props.fullscreen);
    if (fullscreen && !wasFullscreen) setEditing(true);
    if (!fullscreen && wasFullscreen && !dirty()) setEditing(false);
    wasFullscreen = fullscreen;
  });

  const selectSheet = (name: string): void => {
    setActiveSheet(name);
    props.onActiveSheetChange?.(name);
    setError('');
  };

  const selectCell = (sheetName: string, address: string, text: string): void => {
    selectedSheetName = sheetName;
    setSelectedAddress(address);
    setSelectedText(text);
  };

  const updateSelectedCell = (value: string): void => {
    const currentSession = session();
    const currentSheet = sheet();
    if (!currentSession || !currentSheet) return;
    updateSessionCell(currentSession, currentSheet.name, selectedAddress(), value);
    setSelectedText(value);
    setDirty(true);
  };

  const cancelEditing = (): void => {
    if (!dirty()) {
      setEditing(Boolean(props.fullscreen));
      return;
    }
    void load()
      .then(() => {
        setDirty(false);
        setEditing(Boolean(props.fullscreen));
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Не удалось отменить изменения.');
      });
  };

  const save = async (): Promise<void> => {
    const current = session();
    const name = sheet()?.name;
    if (!current || !name) return;
    setSaving(true);
    setError('');
    try {
      const bytes = await serializeSession(current, props.fileName, name);
      const file = new File([bytes], props.fileName, { type: props.mimeType });
      const saved = await replaceUserLibraryFile(props.documentId, file);
      if (!saved) throw new Error('Документ больше недоступен.');
      setDirty(false);
      setEditing(false);
      toast.success('Таблица сохранена.');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Не удалось сохранить таблицу.';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const SheetTabs = (): JSX.Element => (
    <div
      class="rich-sheet__tabs"
      classList={{ 'rich-sheet__tabs--editor': props.fullscreen }}
      role="tablist"
      aria-label="Листы"
    >
      <For each={sheetNames()}>
        {(name) => (
          <button
            type="button"
            role="tab"
            class="rich-sheet__tab"
            classList={{
              'rich-sheet__tab--active': sheet()?.name === name,
              'rich-sheet__tab--editor': props.fullscreen,
              'rich-sheet__tab--editor-active': props.fullscreen && sheet()?.name === name,
            }}
            aria-selected={sheet()?.name === name}
            onClick={() => selectSheet(name)}
          >
            {name}
          </button>
        )}
      </For>
    </div>
  );

  const SheetActions = (): JSX.Element => (
    <div
      class="rich-sheet__actions"
      classList={{ 'rich-sheet__actions--editor': props.fullscreen }}
    >
      <Show
        when={editing()}
        fallback={
          <button
            type="button"
            class="rich-sheet__action"
            classList={{ 'rich-sheet__action--editor': props.fullscreen }}
            onClick={() => setEditing(true)}
          >
            <AppGlyph name="edit" class="rich-sheet__action-icon" />
            Редактировать
          </button>
        }
      >
        <span
          class="rich-sheet__edit-status"
          classList={{ 'rich-sheet__edit-status--editor': props.fullscreen }}
          role="status"
        >
          {dirty() ? 'Есть несохранённые изменения' : 'Редактирование'}
        </span>
        <button
          type="button"
          class="rich-sheet__action"
          classList={{ 'rich-sheet__action--editor': props.fullscreen }}
          disabled={saving()}
          onClick={cancelEditing}
        >
          Отмена
        </button>
        <button
          type="button"
          class="rich-sheet__action rich-sheet__action--primary"
          classList={{ 'rich-sheet__action--editor-primary': props.fullscreen }}
          disabled={!dirty() || saving()}
          onClick={() => void save()}
        >
          <AppGlyph
            name={saving() ? 'refresh' : 'check'}
            class={`rich-sheet__action-icon${saving() ? ' rich-sheet__action-icon--spin' : ''}`}
          />
          {saving() ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </Show>
    </div>
  );

  return (
    <section
      class="rich-document-renderer rich-sheet"
      classList={{ 'rich-sheet--fullscreen': props.fullscreen }}
      aria-label="Таблица"
    >
      <Show
        when={props.fullscreen}
        fallback={
          <div class="rich-sheet__toolbar">
            <SheetTabs />
            <SheetActions />
          </div>
        }
      >
        <header class="rich-sheet__editor-header">
          <div class="rich-sheet__identity">
            <span class="rich-sheet__file-icon" aria-hidden="true">
              <AppGlyph name="file-xls" class="rich-sheet__file-icon-glyph" />
            </span>
            <div class="rich-sheet__identity-copy">
              <strong class="rich-sheet__file-name">{props.fileName}</strong>
              <span class="rich-sheet__save-state">
                {dirty() ? 'Изменения не сохранены' : 'Сохранено локально'}
              </span>
            </div>
          </div>
          <div class="rich-sheet__editor-actions">
            <SheetActions />
            <button
              type="button"
              class="rich-sheet__exit"
              aria-label="Завершить редактирование"
              title="Завершить редактирование"
              onClick={() => props.onExitFullscreen?.()}
            >
              <AppGlyph name="close" class="rich-sheet__exit-icon" />
            </button>
          </div>
        </header>
        <div class="rich-sheet__formula-bar">
          <output class="rich-sheet__name-box" aria-label="Адрес выбранной ячейки">
            {selectedAddress()}
          </output>
          <span class="rich-sheet__formula-symbol" aria-hidden="true">
            fx
          </span>
          <input
            class="rich-sheet__formula-input"
            aria-label="Содержимое выбранной ячейки"
            value={selectedText()}
            readOnly={!editing()}
            onInput={(event) => updateSelectedCell(event.currentTarget.value)}
            onBlur={() => setVersion((value) => value + 1)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
          />
        </div>
      </Show>
      <Show when={error()}>{(message) => <p class="rich-sheet__error">{message()}</p>}</Show>
      <Show when={sheet()}>
        {(current) => (
          <section
            id={sheetAnchorId(props.documentId, current().name)}
            data-user-doc-anchor=""
            class="rich-sheet__sheet"
            classList={{ 'rich-sheet__sheet--fullscreen': props.fullscreen }}
            aria-label={`Лист ${current().name}`}
          >
            <div
              class="rich-sheet__viewport"
              classList={{ 'rich-sheet__viewport--fullscreen': props.fullscreen }}
            >
              <table class="rich-sheet__table">
                <colgroup>
                  <col class="rich-sheet__row-number-column" />
                  <For each={current().columns}>
                    {(column) => (
                      <col
                        class="rich-sheet__data-column"
                        style={{ width: column.width, display: column.hidden ? 'none' : undefined }}
                      />
                    )}
                  </For>
                </colgroup>
                <thead class="rich-sheet__head">
                  <tr class="rich-sheet__header-row">
                    <th class="rich-sheet__corner" />
                    <For each={current().columns}>
                      {(column, columnIndex) => (
                        <th
                          class="rich-sheet__column-header"
                          classList={{
                            'rich-sheet__column-header--selected':
                              props.fullscreen &&
                              selectedCoordinates().column === columnIndex() + 1,
                          }}
                          style={{ display: column.hidden ? 'none' : undefined }}
                          scope="col"
                        >
                          {column.label}
                        </th>
                      )}
                    </For>
                  </tr>
                </thead>
                <tbody class="rich-sheet__body">
                  <For each={current().rows}>
                    {(row) => (
                      <tr
                        class="rich-sheet__row"
                        style={{ height: row.height, display: row.hidden ? 'none' : undefined }}
                      >
                        <th
                          class="rich-sheet__row-header"
                          classList={{
                            'rich-sheet__row-header--selected':
                              props.fullscreen && selectedCoordinates().row === row.index,
                          }}
                          scope="row"
                        >
                          {String(row.index)}
                        </th>
                        <For each={row.cells}>
                          {(cell) => (
                            <td
                              class="rich-sheet__cell"
                              classList={{
                                'rich-sheet__cell--editing': editing(),
                                'rich-sheet__cell--selected':
                                  props.fullscreen && selectedAddress() === cell.address,
                              }}
                              data-cell-address={cell.address}
                              colspan={cell.columnSpan}
                              rowspan={cell.rowSpan}
                              style={cell.style}
                              contentEditable={editing()}
                              tabindex={
                                props.fullscreen
                                  ? selectedAddress() === cell.address
                                    ? 0
                                    : -1
                                  : undefined
                              }
                              spellcheck={false}
                              onFocus={(event) =>
                                selectCell(
                                  current().name,
                                  cell.address,
                                  event.currentTarget.textContent ?? cell.text,
                                )
                              }
                              onInput={(event) => {
                                const currentSession = session();
                                if (!currentSession) return;
                                updateSessionCell(
                                  currentSession,
                                  current().name,
                                  cell.address,
                                  event.currentTarget.textContent ?? '',
                                );
                                setSelectedText(event.currentTarget.textContent ?? '');
                                setDirty(true);
                              }}
                            >
                              {cell.text}
                            </td>
                          )}
                        </For>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </section>
        )}
      </Show>
      <Show when={props.fullscreen && sheet()}>
        {(current) => (
          <footer class="rich-sheet__footer">
            <SheetTabs />
            <span class="rich-sheet__dimensions">
              {String(current().rows.length)} строк · {String(current().columns.length)} столбцов
            </span>
          </footer>
        )}
      </Show>
    </section>
  );
}
