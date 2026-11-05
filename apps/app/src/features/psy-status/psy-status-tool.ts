import type { AppGlyphName } from '@/components/AppGlyph';
import { notesPsyStatusPath } from '@/features/notes/notes-routing';

/** How «Психический статус» is listed with the other working tools («Все инструменты», search). */
export const PSY_STATUS_TOOL = {
  id: 'minimed.app.psy-status',
  title: 'Психический статус',
  description:
    'Конструктор психического, соматического статуса и фармакологического анамнеза: формулировки по разделам, статус раздела, проверка противоречий; заполняется по записи беседы с цитатой к каждой формулировке.',
  aliases: [
    'психостатус',
    'псих статус',
    'психический статус',
    'конструктор статуса',
    'статус психиатрический',
    'mental status',
    'соматический статус',
    'фармакологический анамнез',
  ],
  icon: 'brain' as AppGlyphName,
  ageScope: {
    groups: ['adults'] as ('children' | 'adults')[],
    basis: 'Формулировки конструктора написаны для осмотра взрослого пациента.',
  },
  href: notesPsyStatusPath(),
} as const;
