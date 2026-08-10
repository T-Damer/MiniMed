import type {
  AssessmentDefinition,
  AssessmentQuestion,
} from '@/features/assessments/assessment-types';

function question(
  id: string,
  prompt: string,
  labels: readonly [string, string, string],
): AssessmentQuestion {
  return {
    id,
    scaleId: 'apgar-total',
    prompt,
    responseOptions: [
      { value: 0, label: labels[0] },
      { value: 1, label: labels[1] },
      { value: 2, label: labels[2] },
    ],
  };
}

export const APGAR_ASSESSMENT: AssessmentDefinition = {
  id: 'minimed.assessment.apgar',
  slug: 'apgar-newborn-score',
  title: 'Шкала Апгар — оценка новорождённого',
  shortTitle: 'Шкала Апгар',
  aliases: ['Апгар', 'Apgar score', 'оценка новорождённого', 'шкала Апгар'],
  bankId: 'obstetrics',
  bankLabel: 'Акушерство и гинекология',
  category: 'newborn-screening',
  description:
    'Стандартная клиническая шкала Вирджинии Апгар (1952) для быстрой оценки состояния новорождённого сразу после рождения по пяти признакам.',
  estimatedMinutes: 1,
  audience: 'Для медицинского персонала; оценивает врач или акушерка, а не пациент(ка)',
  responseOptions: [
    { value: 0, label: '0 баллов' },
    { value: 1, label: '1 балл' },
    { value: 2, label: '2 балла' },
  ],
  scales: [
    {
      id: 'apgar-total',
      label: 'Итоговый балл по шкале Апгар',
      shortLabel: 'Апгар',
      description: 'Сумма баллов по пяти признакам (0–10).',
    },
  ],
  questions: [
    question('apgar-newborn-score-01', 'Окраска кожи', [
      'Синюшность или бледность всего тела',
      'Тело розовое, конечности синюшные',
      'Розовая окраска всего тела и конечностей',
    ]),
    question('apgar-newborn-score-02', 'Частота сердечных сокращений', [
      'Отсутствует',
      'Менее 100 уд/мин',
      '100 уд/мин и более',
    ]),
    question('apgar-newborn-score-03', 'Рефлекторная возбудимость (реакция на раздражение)', [
      'Нет реакции',
      'Гримаса или слабый крик',
      'Активный крик, кашель или чихание',
    ]),
    question('apgar-newborn-score-04', 'Мышечный тонус', [
      'Отсутствует, конечности вялые',
      'Некоторое сгибание конечностей',
      'Активные движения',
    ]),
    question('apgar-newborn-score-05', 'Дыхание', [
      'Отсутствует',
      'Слабый крик, нерегулярное дыхание',
      'Хороший крик, регулярное дыхание',
    ]),
  ],
  disclaimer:
    'Шкала Апгар — инструмент быстрой клинической оценки, а не диагноз. Стандартный протокол предполагает оценку на 1-й и 5-й минутах жизни (при низких баллах — повторно на 10-й); эта карточка фиксирует один момент времени, для второй оценки создайте отдельную запись.',
  evidenceNote:
    'Пять признаков и баллы 0/1/2 соответствуют оригинальной шкале Апгар. Общепринятые ориентиры: 7–10 — норма, 4–6 — умеренное угнетение, 0–3 — выраженное угнетение, требующее немедленной помощи по протоколу реанимации новорождённых.',
  license: {
    kind: 'public-domain-derived',
    notice:
      'Шкала предложена Вирджинией Апгар (Apgar V. A proposal for a new method of evaluation of the newborn infant. Curr Res Anesth Analg. 1953) и с тех пор используется повсеместно как стандартный клинический инструмент без ограничений на воспроизведение.',
    sourceUrl: 'https://www.ncbi.nlm.nih.gov/books/NBK470569/',
  },
};
