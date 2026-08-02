import type { AssessmentDefinition } from '@/features/assessments/assessment-types';
import {
  buildAssessmentQuestions,
  STANDARD_RESPONSE_OPTIONS,
} from '@/features/assessments/assessment-factory';

export const TEMPERAMENT_ASSESSMENT: AssessmentDefinition = {
  id: 'minimed.assessment.temperament',
  slug: 'temperament-profile',
  title: 'Тест на темперамент',
  shortTitle: 'Темперамент',
  aliases: [
    'тест на темперамент',
    'сангвиник холерик флегматик меланхолик',
    'темперамент Айзенка',
    'extraversion emotional stability',
  ],
  bankId: 'psychiatry',
  bankLabel: 'Психиатрия и психология',
  category: 'temperament',
  description:
    'Краткий профиль по двум измерениям — экстраверсии и эмоциональной устойчивости. Для привычного языка результат дополнительно сопоставляется с четырьмя классическими темпераментами.',
  estimatedMinutes: 5,
  audience: 'Подростки старшего возраста и взрослые; образовательная саморефлексия',
  responseOptions: STANDARD_RESPONSE_OPTIONS,
  scales: [
    {
      id: 'extraversion',
      label: 'Экстраверсия',
      shortLabel: 'Экстраверсия',
      description: 'Потребность во внешней стимуляции, общении и активном взаимодействии.',
    },
    {
      id: 'emotional-stability',
      label: 'Эмоциональная устойчивость',
      shortLabel: 'Устойчивость',
      description:
        'Склонность сохранять равновесие и быстрее восстанавливаться после напряжения.',
    },
  ],
  questions: buildAssessmentQuestions('temperament-profile', [
    ['extraversion', 'Я чувствую себя оживлённо в компании людей'],
    ['extraversion', 'Мне легко первым начать разговор'],
    ['extraversion', 'Я охотно оказываюсь в центре общего внимания'],
    ['extraversion', 'Я быстро знакомлюсь с новыми людьми'],
    ['extraversion', 'После активного общения у меня обычно остаётся энергия'],
    ['extraversion', 'Я предпочитаю не привлекать к себе внимание', true],
    ['extraversion', 'В незнакомой группе я чаще жду, пока ко мне обратятся', true],
    ['extraversion', 'Мне трудно поддерживать разговор с малознакомым человеком', true],
    [
      'extraversion',
      'Большую часть свободного времени я предпочитаю проводить в одиночестве',
      true,
    ],
    ['extraversion', 'На встречах я обычно говорю меньше большинства участников', true],
    [
      'emotional-stability',
      'После неприятного события я относительно быстро возвращаюсь к обычному состоянию',
    ],
    ['emotional-stability', 'В напряжённой ситуации я способен сохранять ясность мыслей'],
    [
      'emotional-stability',
      'Неопределённость редко полностью выбивает меня из рабочего ритма',
    ],
    ['emotional-stability', 'Я могу отложить тревожную мысль и заняться текущей задачей'],
    ['emotional-stability', 'Моё настроение обычно достаточно устойчиво в течение дня'],
    ['emotional-stability', 'Я часто переживаю из-за возможных неудач', true],
    [
      'emotional-stability',
      'Небольшая критика может надолго испортить мне настроение',
      true,
    ],
    [
      'emotional-stability',
      'Под давлением я легко начинаю паниковать или теряться',
      true,
    ],
    ['emotional-stability', 'Мне трудно расслабиться после напряжённого дня', true],
    ['emotional-stability', 'Я часто ощущаю внутреннее беспокойство без ясной причины', true],
  ]),
  disclaimer:
    'Классические названия темпераментов являются упрощённой метафорой. Опросник не диагностирует тревожные, аффективные или личностные расстройства.',
  evidenceNote:
    'Пункты адаптированы и переведены MiniMed из обще-доступного подхода IPIP к измерению экстраверсии и эмоциональной стабильности. Это не валидированная русская клиническая шкала.',
  license: {
    kind: 'public-domain-derived',
    notice:
      'Основано на public-domain item pool IPIP; русские формулировки являются адаптацией MiniMed.',
    sourceUrl: 'https://ipip.ori.org',
  },
};
