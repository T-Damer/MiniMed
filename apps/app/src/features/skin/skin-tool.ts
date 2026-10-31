import { anyAgeScope } from '@localmed/contracts';

import type { AppGlyphName } from '@/components/AppGlyph';
import { notesSkinPhotoPath } from '@/features/notes/notes-routing';

/**
 * How «Кожа по фото» is listed where tools are listed («Все инструменты» and the home carousel).
 * One declaration, read by both lists, so the title, route and audience never drift apart. It is an
 * experimental module: the lists show it only while the setting is on.
 */
export const SKIN_PHOTO_TOOL = {
  id: 'minimed.app.skin-photo',
  title: 'Кожа по фото',
  kindLabel: 'Сходство снимка с состояниями кожи',
  icon: 'skin-layers' as AppGlyphName,
  /** The model takes the age bucket as a detail; photos of any age are ranked. */
  ageScope: anyAgeScope(
    'Модель обучена на фотографиях кожи взрослых и детей; возраст пациента подаётся ей как уточнение.',
  ),
  href: notesSkinPhotoPath(),
} as const;
