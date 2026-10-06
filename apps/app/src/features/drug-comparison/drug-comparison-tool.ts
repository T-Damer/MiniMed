import { anyAgeScope } from '@localmed/contracts';

import type { AppGlyphName } from '@/components/AppGlyph';
import { notesDrugComparisonPath } from '@/features/notes/notes-routing';

/**
 * How «Сравнение препаратов» is listed where tools are listed («Все инструменты» and the search
 * catalog). One declaration, read by both lists, so the title, route and audience never drift apart.
 */
export const DRUG_COMPARISON_TOOL = {
  id: 'minimed.app.drug-comparison',
  title: 'Сравнение препаратов',
  kindLabel: 'Сравнение по инструкциям и реестрам',
  description:
    'Выберите от 2 до 4 препаратов: в столбцах реестровые данные (МНН, группа АТХ, формы и дозировки, условия отпуска, ЖНВЛП) и разделы официальных инструкций дословно, с пометкой «только у …» и «у обоих». Сравнение текстов инструкций, а не клиническая рекомендация.',
  aliases: [
    'сравнение препаратов',
    'сравнить препараты',
    'сравнить лекарства',
    'сравнение лекарств',
    'чем отличается препарат',
    'разница между препаратами',
    'отличия препаратов',
    'аналоги сравнить',
    'что выбрать из двух препаратов',
    'drug comparison',
  ],
  icon: 'pill' as AppGlyphName,
  /** A comparison of instruction texts: it names no patient, so age does not narrow it. */
  ageScope: anyAgeScope(
    'Сравнение текстов официальных инструкций: возраст пациента в нём не используется, возрастные ограничения читайте в самих инструкциях.',
  ),
  href: notesDrugComparisonPath(),
} as const;
