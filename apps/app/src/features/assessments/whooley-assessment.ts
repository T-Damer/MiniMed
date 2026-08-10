import { buildAssessmentQuestions } from '@/features/assessments/assessment-factory';
import type {
  AssessmentDefinition,
  AssessmentResponseOption,
} from '@/features/assessments/assessment-types';

const WHOOLEY_RESPONSE_OPTIONS: readonly AssessmentResponseOption[] = [
  { value: 0, label: 'Нет' },
  { value: 1, label: 'Да' },
];

export const WHOOLEY_ASSESSMENT: AssessmentDefinition = {
  id: 'minimed.assessment.whooley',
  slug: 'perinatal-mood-whooley',
  title: 'Скрининг настроения Whooley (2 вопроса)',
  shortTitle: 'Скрининг Whooley',
  aliases: [
    'Whooley questions',
    'вопросы Whooley',
    'краткий скрининг депрессии',
    'скрининг настроения',
  ],
  bankId: 'obstetrics',
  bankLabel: 'Акушерство и гинекология',
  category: 'perinatal-mood',
  description:
    'Сверхкороткий скрининг из двух вопросов для быстрой первичной оценки сниженного настроения во время беременности и после родов.',
  estimatedMinutes: 1,
  audience: 'Женщины в период беременности и в первый год после родов',
  responseOptions: WHOOLEY_RESPONSE_OPTIONS,
  scales: [
    {
      id: 'whooley-total',
      label: 'Результат скрининга Whooley',
      shortLabel: 'Whooley',
      description: 'Положительный ответ хотя бы на один из двух вопросов — положительный скрининг.',
    },
  ],
  questions: buildAssessmentQuestions('perinatal-mood-whooley', [
    [
      'whooley-total',
      'За последний месяц вас часто беспокоило подавленное настроение, тоска или чувство безнадёжности?',
    ],
    [
      'whooley-total',
      'За последний месяц вас часто беспокоило заметно сниженное чувство интереса или удовольствия от дел?',
    ],
  ]),
  disclaimer:
    'Это сверхкороткий скрининг, а не диагноз. Положительный результат — повод для более подробного разговора и, при необходимости, развёрнутого инструмента (например, EPDS) или консультации специалиста.',
  evidenceNote:
    'Соответствует двум валидированным «вопросам Whooley» (Whooley M.A. et al., 1997) — короткому скринингу депрессии, широко используемому как первый шаг перед более развёрнутыми инструментами.',
  license: {
    kind: 'public-domain-derived',
    notice:
      'Whooley M.A., Avins A.L., Miranda J., Browner W.S. Case-finding instruments for depression: two questions as good as many. J Gen Intern Med. 1997;12(7):439–445. Инструмент опубликован в открытой научной литературе и широко воспроизводится без ограничений в клинической и скрининговой практике.',
    sourceUrl: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC1497134/',
  },
};
