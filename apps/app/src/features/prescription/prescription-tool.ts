import { anyAgeScope } from '@localmed/contracts';

import type { AppGlyphName } from '@/components/AppGlyph';
import { notesPrescriptionPath } from '@/features/notes/notes-routing';

/**
 * How «Назначение» is listed where tools are listed («Все инструменты» and the search catalog).
 * One declaration, read by both lists, so the title, route and audience never drift apart.
 */
export const PRESCRIPTION_TOOL = {
  id: 'minimed.app.prescription',
  title: 'Назначение',
  kindLabel: 'Рецепт по инструкции',
  description:
    'Выберите препарат, форму и дозировку: по возрасту и массе пациента приложение найдёт дозу в официальной инструкции, покажет предложение, из которого она взята, и посчитает разовую и суточную дозу, число приёмов, срок и количество упаковок. Рецепт печатается на бланке 107-1/у или 148-1/у-88.',
  aliases: [
    'назначение',
    'рецепт',
    'выписать рецепт',
    'оформить рецепт',
    'доза по массе',
    'расчет дозы препарата',
    'расчёт дозы',
    'дозировка ребенку',
    'сколько таблеток',
    'на сколько дней',
    'prescription',
    'rx',
  ],
  icon: 'prescription' as AppGlyphName,
  /** The dose rules choose by the patient's age themselves: the tool is for any age. */
  ageScope: anyAgeScope(
    'Дозы выбираются по возрасту и массе пациента из текста инструкции; для возраста, о котором в инструкции ничего не сказано, дозы нет.',
  ),
  href: notesPrescriptionPath(),
} as const;
