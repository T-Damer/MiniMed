import { buildAssessmentQuestions } from '@/features/assessments/assessment-factory';
import type {
  AssessmentDefinition,
  AssessmentResponseOption,
} from '@/features/assessments/assessment-types';

const FG_RESPONSE_OPTIONS: readonly AssessmentResponseOption[] = [
  { value: 0, label: 'Нет заметных терминальных волос' },
  { value: 1, label: 'Минимальный рост' },
  { value: 2, label: 'Умеренный рост' },
  { value: 3, label: 'Заметный рост' },
  { value: 4, label: 'Выраженный рост' },
];

export const FERRIMAN_GALLWEY_ASSESSMENT: AssessmentDefinition = {
  id: 'minimed.assessment.ferriman-gallwey',
  slug: 'ferriman-gallwey-hirsutism',
  title: 'Модифицированная шкала Ферримана–Голлвея (гирсутизм)',
  shortTitle: 'Шкала Ферримана–Голлвея',
  aliases: [
    'Ferriman-Gallwey',
    'шкала гирсутизма',
    'модифицированная шкала Ферримана-Голлвея',
    'оценка гирсутизма',
  ],
  bankId: 'obstetrics',
  bankLabel: 'Акушерство и гинекология',
  category: 'gynecologic-endocrinology',
  description:
    'Стандартная клиническая шкала для оценки выраженности гирсутизма по девяти областям тела; используется в диагностике синдрома поликистозных яичников и других причин гиперандрогении.',
  estimatedMinutes: 3,
  audience: 'Для медицинского персонала; оценивает врач по результатам осмотра',
  responseOptions: FG_RESPONSE_OPTIONS,
  scales: [
    {
      id: 'fg-total',
      label: 'Итоговый балл по шкале Ферримана–Голлвея',
      shortLabel: 'F–G',
      description: 'Сумма баллов по девяти областям (0–36).',
    },
  ],
  questions: buildAssessmentQuestions('ferriman-gallwey-hirsutism', [
    ['fg-total', 'Верхняя губа'],
    ['fg-total', 'Подбородок'],
    ['fg-total', 'Грудь'],
    ['fg-total', 'Верхняя часть спины'],
    ['fg-total', 'Нижняя часть спины (поясница)'],
    ['fg-total', 'Верхняя часть живота'],
    ['fg-total', 'Нижняя часть живота'],
    ['fg-total', 'Плечо'],
    ['fg-total', 'Бедро'],
  ]),
  disclaimer:
    'Шкала описывает только выраженность волосяного покрова по осмотру и не является диагнозом. Интерпретируйте вместе с менструальным анамнезом, другими признаками гиперандрогении и при необходимости — лабораторными и инструментальными данными.',
  evidenceNote:
    'Девять областей и диапазон 0–4 балла на область соответствуют модифицированной версии шкалы Ферримана–Голлвея (Hatch et al., 1981), производной от оригинальной шкалы 1961 года. Порог 8 баллов и выше принят как ориентир клинического гирсутизма в большинстве исследованных популяций, но пороговые значения могут отличаться между этническими группами.',
  license: {
    kind: 'public-domain-derived',
    notice:
      'Шкала предложена Ferriman D., Gallwey J.D. (1961) и модифицирована Hatch R. et al. (1981); с тех пор широко используется в клинической практике и литературе как стандартный инструмент без ограничений на воспроизведение.',
    sourceUrl: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6320479/',
  },
};
