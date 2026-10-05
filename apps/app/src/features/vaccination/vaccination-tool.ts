import type { AppGlyphName } from '@/components/AppGlyph';
import { notesVaccinationPath } from '@/features/notes/notes-routing';

/**
 * How «Календарь прививок» is listed where tools are listed («Все инструменты» and the search
 * catalog). One declaration, read by both lists, so the title, route and audience never drift apart.
 */
export const VACCINATION_TOOL = {
  id: 'minimed.app.vaccination-calendar',
  title: 'Календарь прививок',
  kindLabel: 'Приказ № 1122н',
  description:
    'Национальный календарь профилактических прививок и календарь по эпидемическим показаниям: таблицы приказа № 1122н, сводка по возрасту, план по дате рождения ребёнка, печать.',
  aliases: [
    'вакцинация',
    'прививки',
    'график прививок',
    'национальный календарь прививок',
    'эпидемические показания',
    'иммунопрофилактика',
    'приказ 1122н',
    '1122н',
    '677н',
    'АКДС',
    'БЦЖ',
    'гепатит В',
    'корь краснуха паротит',
    'грипп вакцина',
  ],
  icon: 'calendar' as AppGlyphName,
  /** The calendars cover newborns, children and adults (appendices 1 and 2 of the order). */
  ageScope: {
    groups: ['children', 'adults'] as ('children' | 'adults')[],
    basis:
      'Приказ № 1122н: приложение № 1 — календарь от новорождённых до взрослых, приложение № 2 — календарь по эпидемическим показаниям для детей и взрослых.',
  },
  href: notesVaccinationPath(),
} as const;
