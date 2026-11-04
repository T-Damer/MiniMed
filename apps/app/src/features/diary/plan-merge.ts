/**
 * Two doctors editing one patient's plan at once (DIARY20): the second save is merged onto the
 * first instead of replacing it. A three-way merge from the version the editor opened (`base`):
 * whatever only one side changed is taken from that side; lists of things with an `id` (plan items,
 * checkpoints, contacts, tips, fields) merge item by item; where both changed the same thing, the
 * one saving now wins and the merge names it, so the editor can tell the doctor.
 */
import type { DiaryInvitation } from '@/features/diary/diary-model';

export interface PlanMerge {
  readonly invitation: DiaryInvitation;
  /** What both doctors changed differently: the saving doctor's version was kept. */
  readonly conflicts: readonly string[];
}

const FIELD_LABEL: Readonly<Record<string, string>> = {
  plan: 'Назначения',
  checkpoints: 'Отметки',
  contacts: 'Контакты',
  tips: 'Подсказки',
  fields: 'Поля дневника',
  note: 'Заметка врача',
  doctor: 'Подпись врача',
  title: 'Название',
  planTitle: 'Название плана',
  crisis: 'Помощь в кризисе',
  operator: 'Реквизиты врача',
};

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

type Identified = { readonly id: string };

function identified(value: unknown): value is readonly Identified[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { id?: unknown }).id === 'string',
    )
  );
}

/** The three-way rule for one value; `undefined` stands for «absent» or «removed». */
function pick<T>(base: T, mine: T, theirs: T): { readonly value: T; readonly clash: boolean } {
  if (same(mine, base)) return { value: theirs, clash: false };
  if (same(theirs, base) || same(mine, theirs)) return { value: mine, clash: false };
  return { value: mine, clash: true };
}

function itemName(item: Identified): string {
  const named = item as { name?: unknown; label?: unknown; title?: unknown; text?: unknown };
  const name = named.name ?? named.label ?? named.title ?? named.text;
  return typeof name === 'string' && name ? name.slice(0, 60) : item.id;
}

/** Items merged by id: their order first, then what only this doctor added, where it was added. */
function mergeList(
  key: string,
  base: readonly Identified[],
  mine: readonly Identified[],
  theirs: readonly Identified[],
  conflicts: string[],
): Identified[] {
  const before = new Map(base.map((item) => [item.id, item]));
  const ours = new Map(mine.map((item) => [item.id, item]));
  const other = new Map(theirs.map((item) => [item.id, item]));
  const result: Identified[] = [];
  const merged = (id: string): Identified | undefined => {
    const outcome = pick(before.get(id), ours.get(id), other.get(id));
    if (outcome.clash) {
      const named = ours.get(id) ?? other.get(id) ?? before.get(id);
      conflicts.push(`${FIELD_LABEL[key] ?? key}: ${named ? itemName(named) : id}`);
    }
    return outcome.value;
  };
  for (const item of theirs) {
    const value = merged(item.id);
    if (value) result.push(value);
  }
  // This doctor's new items (and ones the other removed but this doctor changed), in place.
  mine.forEach((item, index) => {
    if (other.has(item.id)) return;
    const value = merged(item.id);
    if (!value) return;
    const previous = mine
      .slice(0, index)
      .reverse()
      .find((candidate) => result.some((kept) => kept.id === candidate.id));
    const at = previous ? result.findIndex((kept) => kept.id === previous.id) + 1 : 0;
    result.splice(at, 0, value);
  });
  return result;
}

/** `mine` saved on top of `theirs`, both edited from `base`. */
export function mergeInvitations(
  base: DiaryInvitation,
  mine: DiaryInvitation,
  theirs: DiaryInvitation,
): PlanMerge {
  const conflicts: string[] = [];
  const keys = new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)]);
  const result: Record<string, unknown> = {};
  const read = (invitation: DiaryInvitation, key: string): unknown =>
    (invitation as unknown as Record<string, unknown>)[key];
  for (const key of keys) {
    const [was, ours, other] = [read(base, key), read(mine, key), read(theirs, key)];
    let value: unknown;
    if (key === 'issuedAt' || key === 'v' || key === 'id') {
      value = ours ?? other;
    } else if (
      (identified(ours) || ours === undefined) &&
      (identified(other) || other === undefined) &&
      (identified(was) || was === undefined) &&
      (ours !== undefined || other !== undefined)
    ) {
      value = mergeList(
        key,
        (was as readonly Identified[] | undefined) ?? [],
        (ours as readonly Identified[] | undefined) ?? [],
        (other as readonly Identified[] | undefined) ?? [],
        conflicts,
      );
    } else {
      const outcome = pick(was, ours, other);
      if (outcome.clash) conflicts.push(FIELD_LABEL[key] ?? key);
      value = outcome.value;
    }
    if (value !== undefined) result[key] = value;
  }
  return { invitation: result as unknown as DiaryInvitation, conflicts };
}
