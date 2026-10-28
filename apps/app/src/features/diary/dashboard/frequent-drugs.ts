import type { DiaryInvitation } from '@/features/diary/diary-model';

/** The medicines a doctor prescribes most across their patients, most frequent first. */
export function frequentDrugs(
  invitations: readonly (DiaryInvitation | undefined)[],
  limit = 6,
): readonly string[] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const invitation of invitations) {
    for (const item of invitation?.plan ?? []) {
      if (item.ended) continue;
      const key = item.name.trim().toLocaleLowerCase('ru-RU');
      const known = counts.get(key);
      counts.set(key, { name: known?.name ?? item.name.trim(), count: (known?.count ?? 0) + 1 });
    }
  }
  return [...counts.values()]
    .toSorted(
      (left, right) => right.count - left.count || left.name.localeCompare(right.name, 'ru'),
    )
    .slice(0, limit)
    .map((entry) => entry.name);
}
