export const IGNORED_APP_UPDATES_KEY = 'minimed.ignore-update.v1';

const MAX_IGNORED_VERSIONS = 20;

interface IgnoredAppUpdatesSnapshot {
  readonly ignoreUpdate: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseIgnoredAppUpdates(raw: string | null): readonly string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed['ignoreUpdate'])) return [];
    return parsed['ignoreUpdate'].filter(
      (value): value is string => typeof value === 'string' && value.trim().length > 0,
    );
  } catch {
    return [];
  }
}

export function loadIgnoredAppUpdates(): readonly string[] {
  return parseIgnoredAppUpdates(window.localStorage.getItem(IGNORED_APP_UPDATES_KEY));
}

export function ignoreAppUpdate(version: string): readonly string[] {
  const next = [version, ...loadIgnoredAppUpdates().filter((item) => item !== version)].slice(
    0,
    MAX_IGNORED_VERSIONS,
  );
  window.localStorage.setItem(
    IGNORED_APP_UPDATES_KEY,
    JSON.stringify({ ignoreUpdate: next } satisfies IgnoredAppUpdatesSnapshot),
  );
  return next;
}

export function isHomeAppUpdateVisible(
  availableVersion: string | undefined,
  ignoredVersions: readonly string[],
): boolean {
  return Boolean(availableVersion && !ignoredVersions.includes(availableVersion));
}
