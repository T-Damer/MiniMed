/**
 * The built-in CBT diaries and homework sheets (CBT1): declared in `cbt-worksheets.ru.json`, loaded
 * on first use and validated by the same parser as a doctor's own file. Their texts are a draft for
 * a doctor to check (`draft: true`); a doctor's saved copy is their own version.
 */
import {
  parseUserWorksheet,
  USER_WORKSHEET_FORMAT,
  USER_WORKSHEET_VERSION,
  type UserWorksheet,
} from '@/state/user-worksheet-format';

interface WorksheetSeed {
  readonly edition: string;
  readonly worksheets: readonly Readonly<Record<string, unknown>>[];
}

/** Built-in ids start with `cbt-`; a doctor's own with `own-`. */
export function isBuiltInWorksheetId(id: string): boolean {
  return id.startsWith('cbt-');
}

/** The seed file as validated worksheets, in the file's order. */
export function builtInWorksheetsFrom(seed: unknown): readonly UserWorksheet[] {
  const source = seed as WorksheetSeed;
  const stamp = `${source.edition}T00:00:00.000Z`;
  return source.worksheets.map((entry) => {
    const worksheet = parseUserWorksheet({
      ...entry,
      format: USER_WORKSHEET_FORMAT,
      version: USER_WORKSHEET_VERSION,
      draft: true,
      edition: source.edition,
      createdAt: stamp,
      updatedAt: stamp,
    });
    if (!isBuiltInWorksheetId(worksheet.id)) {
      throw new Error(`Готовый лист без префикса cbt-: ${worksheet.id}.`);
    }
    return worksheet;
  });
}

let loaded: Promise<readonly UserWorksheet[]> | undefined;

export function loadBuiltInWorksheets(): Promise<readonly UserWorksheet[]> {
  if (loaded) return loaded;
  const promise = import('./cbt-worksheets.ru.json').then((module) =>
    builtInWorksheetsFrom(module.default),
  );
  loaded = promise;
  promise.catch(() => {
    loaded = undefined;
  });
  return promise;
}

export async function loadBuiltInWorksheet(id: string): Promise<UserWorksheet | undefined> {
  return (await loadBuiltInWorksheets()).find((worksheet) => worksheet.id === id);
}
