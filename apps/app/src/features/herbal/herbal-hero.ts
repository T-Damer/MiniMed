import type { HeroPicture } from '@/features/library/ReaderHero';
import type { HerbalChapter } from './herbal-chapter';
import { getHerbalPlateResolver } from './herbal-plates';

/**
 * The chapter's botanical plate as the reader hero: the small thumbnail the chapter carries, shown
 * at once (owner 2026-11-06: it is enough, the hero waits for nothing bigger). The full plate of the
 * plates module is read only when the picture is opened full screen.
 */
export function herbalHeroPicture(chapter: HerbalChapter): HeroPicture | undefined {
  const plate = chapter.plate;
  if (!plate && !chapter.thumbnail) return undefined;
  const alt = `${chapter.title} (${chapter.latin})`;
  const sourceUrl = plate?.commonsPage ?? '';
  return {
    key: plate?.asset ?? chapter.documentId,
    credit: plate ? `Рисунок: ${plate.credit}` : '',
    surface: 'paper',
    resolve: async () => {
      const shown =
        chapter.thumbnail ?? (plate ? await getHerbalPlateResolver().resolve(plate.asset) : null);
      return shown ? { url: shown, alt, sourceUrl, contentType: 'image/jpeg' } : null;
    },
    ...(plate && chapter.thumbnail
      ? { resolveLarge: () => getHerbalPlateResolver().resolve(plate.asset) }
      : {}),
  };
}
