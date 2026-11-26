/** Fixed pilot pool. The random invitation ID selects the same mascot on every device. */
const PRESETS = [
  'bean-lilac-book.webp',
  'bean-lilac-plain.webp',
  'bean-mint-book.webp',
  'bean-mint-plain.webp',
  'bean-peach-book.webp',
  'bean-peach-plain.webp',
  'cloud-lilac-book.webp',
  'cloud-lilac-plain.webp',
  'cloud-mint-book.webp',
  'cloud-mint-plain.webp',
  'cloud-peach-book.webp',
  'cloud-peach-plain.webp',
] as const;

export function companionPresetId(diaryId: string): (typeof PRESETS)[number] {
  let hash = 2166136261;
  for (const char of diaryId) {
    hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 16777619);
  }
  return PRESETS[(hash >>> 0) % PRESETS.length] ?? PRESETS[0];
}
