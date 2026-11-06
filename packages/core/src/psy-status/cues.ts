/**
 * Which words in a conversation propose which catalog phrase (PSY1). Declared as data, read by
 * `fill.ts`; nothing here decides by itself — every proposal reaches the doctor with the quoted
 * words and waits to be accepted.
 *
 * A pattern is matched on the lower-cased line with «ё» read as «е», from the start of a word; `~`
 * stands for the rest of the word (any letters). `code` is proposed when the words are said, or
 * when a question with these words gets «да»; `denied` (if any) when they are said with a denial
 * («голоса не слышу», «аллергии нет», «без алкоголя») or the question gets «нет». A cue without
 * `denied` proposes nothing on a denial.
 *
 * Most cues stand for what the patient reports. Phrases the catalog marks as the doctor's
 * observation are proposed only from words a doctor says aloud while dictating («ориентирован во
 * времени», «контакт продуктивный») — a patient's words cannot show how they look or speak.
 */
export interface PsyStatusCue {
  readonly code: string;
  readonly denied?: string;
  readonly words: readonly string[];
}

export const PSY_STATUS_CUES: readonly PsyStatusCue[] = [
  // Восприятие
  {
    code: 'command-hallucinations',
    words: [
      'голос~ (?:мне )?(?:приказыва~|велит|велят|заставля~|требу~)',
      'приказыва~ (?:мне )?голос~',
    ],
  },
  {
    code: 'auditory-hallucinations',
    denied: 'perception-none',
    words: ['голоса', 'голосов', 'голос в голове', 'слыш~ голос~', 'голоса в голове'],
  },
  {
    code: 'visual-hallucinations',
    words: ['видени~', 'мерещ~', 'вижу (?:то|людей|тени|фигур~|чертей|насекомых)'],
  },
  {
    code: 'senestopathy',
    words: [
      '(?:ползают|ползает|шевелится|переливается) (?:что-то )?(?:внутри|под кожей|в голове|в теле)',
    ],
  },
  // Мышление
  {
    code: 'delusion-persecution',
    words: [
      'следят за мной',
      'за мной следят',
      'преследу~',
      'хотят (?:меня )?(?:убить|отравить)',
      'отравить меня',
      'против меня заговор',
    ],
  },
  {
    code: 'delusion-reference',
    words: [
      '(?:про|обо) мне (?:все )?(?:говорят|шепчутся)',
      'намека~ (?:на меня|мне)',
      'по телевизору (?:говорят )?(?:про|обо) мне',
    ],
  },
  {
    code: 'obsessions',
    words: [
      'навязчив~ мысл~',
      'мысли лезут',
      'лезут (?:в голову )?мысли',
      'не могу (?:отделаться|избавиться) от мысл~',
      'по (?:нескольку|много) раз перепроверя~',
    ],
  },
  // Память и внимание, когниции
  {
    code: 'memory-gap',
    words: ['провал~ (?:в )?памят~', 'не помню, что (?:было|делал~)', 'выпал~ из памяти'],
  },
  {
    code: 'cognitive-complaint',
    words: [
      'память (?:стала )?(?:хуже|плох~|подводит)',
      'стал~ (?:все )?забывать',
      'трудно сосредоточ~',
      'все забываю',
      'забываю все',
      'голова (?:совсем |совершенно )?не варит',
    ],
  },
  // Эмоции
  {
    code: 'mood-depressed',
    words: [
      'настроение (?:плохое|подавленное|на нуле|никакое|ужасное)',
      'ничего не радует',
      'тоска',
      'тоскливо',
    ],
  },
  {
    code: 'mood-elevated',
    words: [
      'энерги~ через край',
      'могу не спать',
      'настроение (?:прекрасное|отличное|приподнятое)',
    ],
  },
  {
    code: 'anxiety',
    words: ['тревог~', 'тревожн~', 'беспоко~ (?:за|о) будущ~', 'паник~', 'страшно'],
  },
  // Воля
  { code: 'hypobulia', words: ['нет сил', 'ничего не хочется', 'не могу заставить себя'] },
  // Критика
  {
    code: 'insight-none',
    words: ['я не болен', 'я не больна', 'я здоров~', 'лечиться не (?:буду|собираюсь)'],
  },
  {
    code: 'insight-full',
    words: [
      'понимаю, что (?:я )?(?:болен|больна|это болезнь)',
      'мне нужна помощь',
      'хочу лечиться',
    ],
  },
  // Безопасность
  {
    code: 'suicide-plan',
    words: ['(?:есть|продумал~) план', 'накопил~ таблет~', 'знаю, как (?:это )?сделаю'],
  },
  {
    code: 'suicide-passive',
    words: [
      'не хочется жить',
      'не хочу жить',
      'жить не хочется',
      'лучше бы меня не было',
      'уснуть и не проснуться',
    ],
  },
  {
    code: 'suicide-active',
    denied: 'suicide-denied',
    words: [
      'покончить с собой',
      'самоубийств~',
      'суицид~',
      'убить себя',
      'мысл~ о смерти',
      // A method named is never small talk (FORMFILL1: a real interview named one and was missed).
      'брос(?:ит~|ил~|ать~|аю~|ится|ишься|усь)(?: бы)? (?:под (?:поезд|машину|электричку|трамвай)|с (?:моста|крыши|балкона))',
      'брошусь',
      'выпрыгн~ (?:из окна|с балкона|с крыши)',
      'шагн~ (?:из окна|с крыши|с балкона)',
      'пов(?:ешусь|есит~ся|есил~ся)',
      'вскр(?:ыть|ою|ыл~) (?:себе )?вены',
      'наглота(?:юсь|ться|л~ся)',
    ],
  },
  {
    code: 'aggression-present',
    denied: 'aggression-denied',
    words: [
      'агресс~',
      'подрал~',
      'драк~',
      'избил~',
      'ударил~ (?:его|ее|жену|мужа|соседа|человека)',
    ],
  },
  {
    code: 'protective-factors',
    words: ['ради (?:детей|ребенка|сына|дочери|мамы|семьи)', 'дети держат'],
  },
  // Употребление ПАВ
  { code: 'alcohol-dependence', words: ['похмел~', 'опохмел~', 'запо(?:й|и|ев|ями)'] },
  {
    code: 'alcohol-use',
    denied: 'alcohol-denied',
    words: [
      'алкогол~',
      'выпива~',
      'пью(?! (?:таблет~|лекарств~|препарат~|воду|чай|кофе|сок))',
      'пиво',
      'водк~',
      'вино',
    ],
  },
  {
    code: 'drugs-use',
    denied: 'drugs-denied',
    words: [
      'наркотик~',
      'наркоти~',
      'марихуан~',
      'травку',
      'спайс~',
      'амфетамин~',
      'кокаин~',
      'героин~',
      'мефедрон~',
    ],
  },
  { code: 'nicotine-daily', words: ['курю', 'сигарет~', 'вейп~'] },
  {
    code: 'substance-motivation',
    words: ['хочу (?:бросить|завязать)', 'готов~ (?:бросить|завязать)'],
  },
  // Соматическое
  {
    code: 'chest-pain',
    denied: 'cardio-none',
    words: ['бол~ (?:в )?груд~', '(?:давит|жжет|колет) в груди'],
  },
  { code: 'dyspnea', words: ['одышк~', 'задыха~', 'не хватает воздуха'] },
  {
    code: 'appetite-low',
    words: ['аппетит~ (?:нет|плох~|пропал|снизил~|никакой)', 'не хочется есть', 'похудел~'],
  },
  {
    code: 'appetite-normal',
    words: ['аппетит~ (?:хорош~|нормальн~|в норме)', 'ем нормально'],
  },
  { code: 'nausea', words: ['тошн~', 'рвот~', 'рвет'] },
  { code: 'tremor', words: ['руки трясутся', 'дрож~ (?:в )?рук~', 'тремор~'] },
  { code: 'seizures', words: ['судорог~', 'приступ~ с потерей сознания', 'эпилепс~'] },
  {
    code: 'allergy-present',
    denied: 'allergy-none',
    words: ['аллерги~', 'непереносимост~'],
  },
  {
    code: 'tbi-present',
    denied: 'tbi-none',
    words: ['сотрясени~ (?:головного )?мозга', 'травм~ головы', 'черепно-мозгов~'],
  },
  {
    code: 'somatic-history-present',
    words: ['диабет~', 'гипертони~', 'астм~', 'гастрит~', 'щитовидк~'],
  },
  // Фармакологический анамнез
  {
    code: 'self-change',
    words: [
      'сам~ (?:отменил~|бросил~|снизил~|уменьшил~|увеличил~)',
      'перестал~ (?:пить|принимать)',
      'бросил~ (?:пить )?таблетк~',
    ],
  },
  {
    code: 'adherence-partial',
    words: [
      'забываю (?:принять|выпить|пить)',
      'пропуска~ (?:прием|таблетк~|дозы)',
      'не всегда (?:пью|принимаю)',
    ],
  },
  {
    code: 'adherence-good',
    words: ['принимаю (?:регулярно|каждый день|как назначено)', 'не пропускаю'],
  },
  {
    code: 'meds-current',
    denied: 'meds-none',
    words: ['принимаю', 'пью (?:таблет~|лекарств~|препарат~)', 'таблетк~', 'лекарств~'],
  },
  {
    code: 'response-good',
    denied: 'response-none',
    words: ['стало (?:гораздо |намного |немного )?(?:лучше|легче)', 'помога(?:ет|ют)'],
  },
  {
    code: 'adverse-clinical',
    denied: 'adverse-none',
    words: ['побочн~', 'побочк~'],
  },
  { code: 'sedation', words: ['сонлив~', 'хочется спать днем', 'сплю на ходу'] },
  {
    code: 'weight-gain',
    words: ['поправил~', 'набрал~ (?:вес|\\d+ (?:кг|килограмм~))', 'вес (?:вырос|прибавил~)'],
  },
  {
    code: 'akathisia',
    words: ['не могу усидеть', 'ноги не находят (?:себе )?места', 'внутренн~ беспокойств~'],
  },
  // То, что врач диктует вслух
  {
    code: 'orientation-full',
    denied: 'orientation-impaired',
    words: ['ориентирован~ (?:во времени|в месте|всесторонне|полностью|верно)'],
  },
  {
    code: 'contact-good',
    words: ['контакт~ (?:продуктивн~|доступ~|устанавливает охотно)'],
  },
];
