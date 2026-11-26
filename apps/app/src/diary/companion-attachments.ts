import { createSignal, onCleanup } from 'solid-js';

export const COMPANION_PHOTO_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
  'image/heic',
  'image/heif',
];

export function createCompanionAttachments() {
  const [draft, setDraft] = createSignal<readonly string[]>([]);
  const [error, setError] = createSignal('');
  const urls = new Set<string>();
  onCleanup(() => {
    for (const url of urls) URL.revokeObjectURL(url);
  });

  const add = (files: FileList | readonly File[]) => {
    if (!files.length) return;
    const added: string[] = [];
    let problem = '';
    for (const file of Array.from(files)) {
      if (urls.size >= 8) {
        problem = 'Достигнут предел в 8 фотографий за сеанс.';
        break;
      }
      if (
        !COMPANION_PHOTO_TYPES.includes(file.type) ||
        !file.size ||
        file.size > 10 * 1024 * 1024
      ) {
        problem = 'Поддерживаются фотографии размером до 10 МБ.';
        continue;
      }
      const url = URL.createObjectURL(file);
      urls.add(url);
      added.push(url);
    }
    if (added.length) setDraft((current) => [...current, ...added]);
    setError(problem);
  };
  const remove = (url: string) => {
    setDraft((current) => current.filter((item) => item !== url));
    urls.delete(url);
    URL.revokeObjectURL(url);
    setError('');
  };
  const commit = () => {
    setDraft([]);
    setError('');
  };

  return { draft, error, add, remove, commit };
}
