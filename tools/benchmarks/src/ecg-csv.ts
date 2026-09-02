export interface EcgCsvRow {
  readonly values: readonly string[];
  readonly line: number;
}

export interface EcgCsvTable {
  readonly source: string;
  readonly headers: readonly string[];
  readonly rows: readonly EcgCsvRow[];
}

function normalizedHeader(value: string): string {
  return value.trim().toLowerCase();
}

export function parseEcgCsv(text: string, source: string): EcgCsvTable {
  const input = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const rows: EcgCsvRow[] = [];
  let values: string[] = [];
  let value = '';
  let line = 1;
  let rowLine = 1;
  let inQuotes = false;
  let closedQuote = false;

  const finishValue = () => {
    values.push(value);
    value = '';
    closedQuote = false;
  };
  const finishRow = () => {
    if (!(values.length === 1 && values[0] === '')) rows.push({ values, line: rowLine });
    values = [];
    rowLine = line;
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === undefined) continue;
    if (inQuotes) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          value += '"';
          index += 1;
        } else {
          inQuotes = false;
          closedQuote = true;
        }
      } else {
        value += character;
        if (character === '\n') line += 1;
        else if (character === '\r' && input[index + 1] !== '\n') line += 1;
      }
      continue;
    }
    if (closedQuote) {
      if (character === ',') finishValue();
      else if (character === '\n' || character === '\r') {
        finishValue();
        if (character === '\r' && input[index + 1] === '\n') index += 1;
        line += 1;
        finishRow();
      } else if (character !== ' ' && character !== '\t') {
        throw new Error(`${source} line ${line} has characters after a quoted CSV field.`);
      }
      continue;
    }
    if (character === '"') {
      if (value.length > 0) throw new Error(`${source} line ${line} has an unexpected quote.`);
      inQuotes = true;
    } else if (character === ',') finishValue();
    else if (character === '\n' || character === '\r') {
      finishValue();
      if (character === '\r' && input[index + 1] === '\n') index += 1;
      line += 1;
      finishRow();
    } else value += character;
  }

  if (inQuotes) throw new Error(`${source} line ${line} has an unterminated quoted CSV field.`);
  if (closedQuote || values.length > 0 || value.length > 0) {
    finishValue();
    finishRow();
  }
  const headerRow = rows[0];
  if (!headerRow) throw new Error(`${source} is empty and has no header.`);
  const headers = headerRow.values.map((header) => header.trim());
  const seen = new Set<string>();
  for (const [index, header] of headers.entries()) {
    if (!header) {
      if (index > 0 && rows.slice(1).some((row) => row.values[index]?.trim())) {
        throw new Error(`${source} has data in unnamed column ${index + 1}.`);
      }
      continue;
    }
    const key = normalizedHeader(header);
    if (seen.has(key)) throw new Error(`${source} has duplicate column ${header}.`);
    seen.add(key);
  }
  for (const row of rows.slice(1)) {
    if (row.values.length !== headers.length) {
      throw new Error(
        `${source} line ${row.line} has ${row.values.length} fields; expected ${headers.length}.`,
      );
    }
  }
  return { source, headers, rows: rows.slice(1) };
}

export function requireEcgCsvColumn(
  table: EcgCsvTable,
  names: readonly string[],
  label: string,
): number {
  const wanted = new Set(names.map(normalizedHeader));
  const index = table.headers.findIndex((header) => wanted.has(normalizedHeader(header)));
  if (index < 0) throw new Error(`${table.source} is missing required column ${label}.`);
  return index;
}

export function requireEcgCsvCell(
  table: EcgCsvTable,
  row: EcgCsvRow,
  index: number,
  label: string,
): string {
  const value = row.values[index]?.trim();
  if (!value) throw new Error(`${table.source} line ${row.line} ${label} must be non-empty.`);
  return value;
}
