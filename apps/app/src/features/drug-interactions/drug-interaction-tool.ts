import { anyAgeScope } from '@localmed/contracts';

import type { AppGlyphName } from '@/components/AppGlyph';
import { notesDrugInteractionsPath } from '@/features/notes/notes-routing';

/**
 * How «Взаимодействие препаратов» is listed where tools are listed («Все инструменты» and the
 * search catalog). One declaration, read by both lists, so the title, route and audience never
 * drift apart.
 */
export const DRUG_INTERACTION_TOOL = {
  id: 'minimed.app.drug-interactions',
  title: 'Взаимодействие препаратов',
  kindLabel: 'Поиск по инструкциям',
  description:
    'Добавьте от 2 до 10 препаратов: для каждой пары показаны предложения из официальных инструкций, где один препарат упоминает другой или его группу. Поиск по текстам инструкций, а не оценка безопасности.',
  aliases: [
    'взаимодействие препаратов',
    'лекарственное взаимодействие',
    'совместимость препаратов',
    'совместимость лекарств',
    'совместное применение',
    'взаимодействие лекарств',
    'можно ли принимать вместе',
    'алкоголь и препарат',
    'interaction checker',
  ],
  icon: 'pill' as AppGlyphName,
  /** An instruction text search: it names no patient, so age does not narrow it. */
  ageScope: anyAgeScope(
    'Поиск по текстам официальных инструкций: возраст пациента в нём не используется, возрастные ограничения читайте в самой инструкции.',
  ),
  href: notesDrugInteractionsPath(),
} as const;
