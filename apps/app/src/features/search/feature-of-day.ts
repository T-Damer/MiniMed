/**
 * Which home capability to show today: the same one all day, a different one the next day. The
 * local calendar date decides, so the card does not change while a doctor works through a shift.
 */
export function featureOfDayIndex(count: number, date: Date): number {
  if (count <= 0) return 0;
  const day = Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000,
  );
  return ((day % count) + count) % count;
}
