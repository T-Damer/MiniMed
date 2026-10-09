const STORAGE_KEY = 'minimed.recent-calculators.v1';
export const RECENT_CALCULATORS_LIMIT = 5;

/**
 * The calculators opened last, newest first, for the compact row at the top of the calculators
 * list. Only tool ids are kept, on this device: no patient, input or result ever enters this list.
 */
export function loadRecentCalculatorIds(): readonly string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((id): id is string => typeof id === 'string' && id !== '')
      .slice(0, RECENT_CALCULATORS_LIMIT);
  } catch {
    // A blocked or corrupt store only means an empty row.
    return [];
  }
}

export function rememberRecentCalculator(id: string): readonly string[] {
  const next = [id, ...loadRecentCalculatorIds().filter((candidate) => candidate !== id)].slice(
    0,
    RECENT_CALCULATORS_LIMIT,
  );
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // The row is a convenience: a full or blocked store keeps this session's list only.
  }
  return next;
}
