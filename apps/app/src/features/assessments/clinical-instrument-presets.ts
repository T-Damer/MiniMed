import {
  parseUserQuestionnaire,
  type UserQuestionnaire,
  USER_QUESTIONNAIRE_FORMAT,
  USER_QUESTIONNAIRE_VERSION,
} from '@/state/user-questionnaires';

// Source wording is separately licensed data, not project-original questionnaire content.
// See docs/CLINICAL_INSTRUMENTS.md for editions, attribution and qualification boundaries.
export interface ClinicalInstrumentPreset {
  readonly id: string;
  readonly title: string;
  readonly aliases: readonly string[];
  readonly specialties: readonly string[];
  readonly edition: string;
  readonly population: string;
  readonly qualification: string;
  readonly description: string;
  readonly instructions: string;
  readonly scoreDescription: string;
  readonly disclaimer: string;
  readonly sourceUrl: string;
  readonly sourceNotice: string;
  readonly license: string;
  readonly licenseUrl: string;
  readonly questions: readonly string[];
  readonly options: readonly { readonly label: string; readonly weight: number }[];
  readonly questionNotes?: Readonly<Record<number, string>>;
}

const frequencyOptions = [
  { label: 'Совсем нет', weight: 0 },
  { label: 'В течение нескольких дней', weight: 1 },
  { label: 'Более, чем половину этого времени', weight: 2 },
  { label: 'Почти каждый день', weight: 3 },
] as const;

const frequencyInstructions =
  'Оцените, пожалуйста, насколько часто следующие проблемы беспокоили вас в течение прошедших двух недель. Для ответов используйте следующую шкалу:';

export const CLINICAL_INSTRUMENT_PRESETS: readonly ClinicalInstrumentPreset[] = [
  {
    id: 'phq-9-ru-zolotareva-2023',
    title: 'PHQ-9 — русская версия А. А. Золотаревой (2023)',
    aliases: ['PHQ9', 'PHQ 9', 'Опросник здоровья пациента', 'депрессия'],
    specialties: ['Психиатрия', 'Общая врачебная практика'],
    edition: 'Приложение к DOI 10.17759/cpse.2023120406',
    population: 'В исследовании: общая популяция, взрослые 18–90 лет.',
    qualification:
      'Опубликована психометрическая оценка русской версии; это не доказательство диагностической точности во всех клинических группах РФ.',
    description: 'Опросник выраженности депрессивных симптомов за последние две недели.',
    instructions: frequencyInstructions,
    scoreDescription:
      'Рассчитывается исходная сумма 0–27. Это не вероятность диагноза. Интерпретацию и дополнительные вопросы сверяйте с источником; автоматический диагноз и клинический референс не назначаются.',
    disclaimer:
      'Скрининг не устанавливает диагноз. Любой ответ о смерти или самоповреждении требует отдельного внимания независимо от суммы баллов.',
    sourceUrl: 'https://psyjournals.ru/journals/cpse/archive/2023_n4/Zolotareva',
    sourceNotice:
      'PHQ-9: Kroenke, Spitzer, Williams. Русская версия: Золотарева А. А., 2023, Клиническая и специальная психология, 12(4), 107–121; DOI 10.17759/cpse.2023120406, приложение. Вопросы и варианты ответов перенесены без медицинского перефразирования; добавлены интерфейс и отдельно обозначенные пояснения MiniMed.',
    license: 'CC-BY-NC-4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-nc/4.0/',
    questions: [
      'Снижение интереса и удовольствия от привычных дел',
      'Чувство подавленности или безнадежности',
      'Проблемы со сном (неспособность заснуть, раннее пробуждение или слишком долгий сон)',
      'Чувство усталости или недостатка энергии',
      'Плохой аппетит или переедание',
      'Плохое мнение о себе или чувство, что не смог оправдать ожиданий моей семьи',
      'Проблемы с концентрацией внимания (например, при чтении газеты или просмотре телевизионной передачи)',
      'Замедленность движений или речи, которая стала заметна другим людям, или, напротив, суетливость, когда движения и речь стали более быстрыми и беспокойными',
      'Мысли о том, что мне бы хотелось умереть или причинить себе боль',
    ],
    options: frequencyOptions,
    questionNotes: {
      9: 'Пояснение MiniMed для врача: не сводите этот ответ к сумме баллов; отдельно уточните актуальные мысли и безопасность пациента. Нулевой ответ также не исключает риск.',
    },
  },
  {
    id: 'gad-7-ru-zolotareva-2023',
    title: 'GAD-7 — русская версия А. А. Золотаревой (2023)',
    aliases: ['GAD7', 'GAD 7', 'ГТР-7', 'генерализованная тревога'],
    specialties: ['Психиатрия', 'Общая врачебная практика'],
    edition: 'Приложение к DOI 10.17759/cpp.2023310402',
    population: 'В исследовании: общая популяция, взрослые 18–90 лет.',
    qualification:
      'Авторы указывают необходимость дальнейшего исследования клинических выборок; наличие русского текста не означает универсальную применимость.',
    description: 'Оценка выраженности тревожных симптомов за последние две недели.',
    instructions: frequencyInstructions,
    scoreDescription:
      'Рассчитывается исходная сумма 0–21. Больший балл отражает больше симптомов по этой форме, но сам по себе не устанавливает генерализованное тревожное расстройство. Правила интерпретации приведены в источнике.',
    disclaimer: 'Скрининговая шкала, а не диагноз. Применимость зависит от возраста и клинического контекста.',
    sourceUrl: 'https://psyjournals.ru/journals/cpp/archive/2023_n4/Zolotareva',
    sourceNotice:
      'GAD-7: Spitzer и соавторы. Русская версия: Золотарева А. А., 2023, Консультативная психология и психотерапия, 31(4), 31–46; DOI 10.17759/cpp.2023310402, приложение. Вопросы и варианты ответов сохранены; добавлен электронный интерфейс и отдельные пояснения MiniMed.',
    license: 'CC-BY-NC-4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-nc/4.0/',
    questions: [
      'Чувство тревоги или раздражения.',
      'Неспособность справиться со своим беспокойством.',
      'Чрезмерное беспокойство по разным поводам.',
      'Неспособность расслабляться.',
      'Ощущение такого беспокойства, что трудно найти себе место.',
      'Склонность быстро испытывать злость или раздражительность.',
      'Чувство страха, как будто может случиться что–то ужасное.',
    ],
    options: frequencyOptions,
  },
  {
    id: 'who-5-ru-1999-who-2024',
    title: 'WHO-5 — русская форма 1999, публикация ВОЗ 2024',
    aliases: ['ВОЗ-5', 'WHO5', 'WHO 5', 'ВОЗ 5', 'индекс самочувствия', 'благополучие'],
    specialties: ['Психиатрия', 'Психология', 'Общая врачебная практика'],
    edition: 'Русская форма «вариант 1999 г.» из публикации WHO-UCN-MSD-MHE-2024.01',
    population: 'Самооценка самочувствия; применимость к конкретной группе проверьте отдельно.',
    qualification:
      'Русский текст опубликован ВОЗ; отдельная клиническая валидация этой реализации для РФ не проводилась. Перевод предшествует английской публикации ВОЗ 2024 года.',
    description: 'Пять утверждений о самочувствии за последние две недели. Больший балл — лучшее самочувствие.',
    instructions:
      'За последние две недели: отметьте для каждого утверждения один ответ, наиболее близкий к тому, как вы себя чувствовали.',
    scoreDescription:
      'Показывается исходная сумма 0–25. По ключу источника индекс 0–100 равен сумме, умноженной на 4; нормированный процент в текущем движке численно соответствует этому индексу, но не является вероятностью заболевания. Автоматический диагноз не выводится.',
    disclaimer: 'Индекс самочувствия не устанавливает диагноз. Высокий балл означает лучшее, а не худшее самочувствие.',
    sourceUrl: 'https://www.who.int/ru/publications/m/item/WHO-UCN-MSD-MHE-2024.01',
    sourceNotice:
      'Всемирная организация здравоохранения, 2024. Индекс общего (хорошего) самочувствия/ВОЗ; русский бланк «вариант 1999 г.», последняя страница who-5_russian.pdf. Изменения: цифровое представление и отдельно обозначенные пояснения MiniMed. Это приложение не создано и не одобрено ВОЗ; логотип ВОЗ не используется. ВОЗ не отвечает за содержание и точность предшествующего русского перевода; исходная английская версия имеет преимущество.',
    license: 'CC-BY-NC-SA-3.0-IGO',
    licenseUrl: 'https://creativecommons.org/licenses/by-nc-sa/3.0/igo/',
    questions: [
      'Я чувствую себя бодрой(-ым) и в хорошем настроении',
      'Я чувствую себя спокойной(-ым) и раскованной(-ым).',
      'Я чувствую себя активной(-ым) и энергичной(-ым).',
      'Я просыпаюсь и чувствую себя свежей(-им) и отдохнувшей(-им).',
      'Каждый день со мной происходят вещи, представляющие для меня интерес.',
    ],
    options: [
      { label: 'Все время', weight: 5 },
      { label: 'Большую часть времени', weight: 4 },
      { label: 'Более половины времени', weight: 3 },
      { label: 'Менее половины времени', weight: 2 },
      { label: 'Некоторое время', weight: 1 },
      { label: 'Никогда', weight: 0 },
    ],
  },
];

export function searchClinicalInstrumentPresets(query: string): readonly ClinicalInstrumentPreset[] {
  const fold = (value: string): string =>
    value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').replace(/[-–—]/gu, ' ');
  const words = fold(query).trim().split(/\s+/u).filter(Boolean);
  return CLINICAL_INSTRUMENT_PRESETS.filter((item) => {
    const text = fold([item.title, item.description, ...item.aliases, ...item.specialties].join(' '));
    return words.every((word) => text.includes(word));
  });
}

export function createClinicalInstrumentQuestionnaire(
  id: string,
  createdAt = new Date().toISOString(),
): UserQuestionnaire {
  const preset = CLINICAL_INSTRUMENT_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) throw new Error('Неизвестная версия инструмента.');
  return parseUserQuestionnaire({
    format: USER_QUESTIONNAIRE_FORMAT,
    version: USER_QUESTIONNAIRE_VERSION,
    title: preset.title,
    description: [
      preset.description,
      preset.population,
      preset.qualification,
      `Пояснение MiniMed о расчёте: ${preset.scoreDescription}`,
      `Версия: ${preset.edition}`,
    ].join('\n\n'),
    disclaimer: preset.disclaimer,
    images: [],
    questions: preset.questions.map((prompt, index) => ({
      id: `${preset.id}-q${index + 1}`,
      prompt,
      text: [
        index === 0 ? preset.instructions : '',
        preset.questionNotes?.[index + 1] ?? '',
      ].filter(Boolean).join('\n\n'),
      images: [],
      options: preset.options.map((option, optionIndex) => ({
        id: `${preset.id}-q${index + 1}-o${optionIndex}`,
        ...option,
      })),
    })),
    createdAt,
    updatedAt: createdAt,
    reference: {
      notice: `${preset.sourceNotice}\n${preset.license}: ${preset.licenseUrl}`,
      sourceUrl: preset.sourceUrl,
    },
  });
}

export function clinicalInstrumentImportFile(id: string): File {
  return new File(
    [JSON.stringify(createClinicalInstrumentQuestionnaire(id), null, 2)],
    `${id}.minimed-questionnaire`,
    { type: 'application/vnd.minimed.questionnaire+json' },
  );
}
