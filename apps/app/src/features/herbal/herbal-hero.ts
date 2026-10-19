import type { HeroPicture } from '@/features/library/ReaderHero';
import type { HerbalChapter } from './herbal-chapter';
import { getHerbalPlateResolver } from './herbal-plates';

/**
 * The chapter's botanical plate as the reader hero: the full plate when the plates module is
 * installed, otherwise the small thumbnail the chapter carries.
 */
export function herbalHeroPicture(chapter: HerbalChapter): HeroPicture | undefined {
  const plate = chapter.plate;
  if (!plate && !chapter.thumbnail) return undefined;
  const alt = `${chapter.title} (${chapter.latin})`;
  const sourceUrl = plate?.commonsPage ?? '';
  return {
    key: plate?.asset ?? chapter.documentId,
    credit: plate ? `Рисунок: ${plate.credit}` : '',
    resolve: async () => {
      const url = plate ? await getHerbalPlateResolver().resolve(plate.asset) : null;
      const shown = url ?? chapter.thumbnail;
      return shown ? { url: shown, alt, sourceUrl, contentType: 'image/jpeg' } : null;
    },
  };
}
