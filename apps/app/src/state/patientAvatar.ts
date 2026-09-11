export type PatientAvatar =
  | { readonly kind: 'symbol'; readonly value: string }
  | { readonly kind: 'photo'; readonly value: string };

const MAX_AVATAR_LENGTH = 128 * 1024;

export function normalizePatientAvatar(value: unknown): PatientAvatar {
  if (
    !value ||
    typeof value !== 'object' ||
    !('kind' in value) ||
    !('value' in value) ||
    typeof value.value !== 'string'
  )
    throw new Error('Некорректный значок пациента.');
  if (value.kind === 'symbol') {
    const symbol = value.value.trim();
    if (
      symbol.length > 64 ||
      [...new Intl.Segmenter('ru', { granularity: 'grapheme' }).segment(symbol)].length !== 1
    )
      throw new Error('Выберите один символ или эмодзи.');
    return { kind: 'symbol', value: symbol };
  }
  if (
    value.kind === 'photo' &&
    value.value.length <= MAX_AVATAR_LENGTH &&
    /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/u.test(value.value)
  )
    return { kind: 'photo', value: value.value };
  throw new Error('Фото пациента должно быть локальной миниатюрой JPEG, PNG или WebP.');
}

export async function patientAvatarFromFile(file: File): Promise<PatientAvatar> {
  if (
    !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) ||
    file.size > 8 * 1024 * 1024
  )
    throw new Error('Выберите изображение JPEG, PNG, WebP или GIF до 8 МБ.');
  const { attachmentThumbnails } = await import('@/state/thumbnails');
  const thumbnail = await attachmentThumbnails.forFile(file, file.type, file.name);
  if (!thumbnail) throw new Error('Не удалось прочитать фото.');
  // ponytail: a bounded thumbnail stays in the protected snapshot; use vault blobs for full-size photos.
  return normalizePatientAvatar({ kind: 'photo', value: thumbnail });
}

export function patientInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => Array.from(part)[0] ?? '')
    .join('')
    .toLocaleUpperCase('ru-RU');
}
