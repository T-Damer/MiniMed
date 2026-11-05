import type { FormFillOverlay, FormFillOverlayField } from '../adapters';

/**
 * PHQ-9 (`minimed.assessment.phq-9`) from a conversation. Each question's topic words, and the
 * answer scale's words: a frequency fills an item only when said about its topic — in the same
 * sentence, or as the reply to a question on it (`topicChoiceCandidates`). No hints: hint words
 * count as the field's subject in the line check, and the questions already say it.
 */
const FREQUENCY: Readonly<Record<string, readonly string[]>> = {
  '0': ['ни разу', 'не было ни разу', 'никогда', 'совсем нет'],
  '1': ['несколько дней', 'пару дней', 'пару раз', 'иногда', 'изредка', 'раз в неделю'],
  '2': ['больше недели', 'более недели', 'больше половины', 'половину дней', 'часто'],
  '3': [
    'почти каждый день',
    'каждый день',
    'ежедневно',
    'постоянно',
    'вс[её] время',
    'почти всегда',
  ],
};

const DIFFICULTY: Readonly<Record<string, readonly string[]>> = {
  '0': ['совсем не трудно', 'не мешает', 'не мешают', 'никак не мешает'],
  '1': ['немного трудно', 'немного мешает', 'немного мешают', 'чуть-чуть'],
  '2': ['очень трудно', 'сильно мешает', 'сильно мешают'],
  '3': ['чрезвычайно трудно', 'невозможно', 'совсем не могу'],
};

const TOPICS: Readonly<Record<string, readonly string[]>> = {
  'phq9-01': [
    'ничего не хоте~',
    'не хотелось ничего',
    'интерес~',
    'не радует',
    'не радовало',
    'удовольстви~',
  ],
  'phq9-02': ['настроени~', 'подавлен~', 'тоск~', 'безысходност~', 'депресс~'],
  'phq9-03': ['сон', 'сном', 'сна', 'засыпа~', 'засн~', 'бессонниц~', 'просыпа~', 'спит~', 'сплю'],
  'phq9-04': ['устал~', 'утомл~', '(?:мало|нет|не хватает) сил', 'энерги~'],
  'phq9-05': ['аппетит~', 'переед~'],
  'phq9-06': ['неудачни~', 'разочаров~', 'плохо о себе', 'подв[её]л~', 'винов~'],
  'phq9-07': ['сосредоточ~', 'концентр~', 'внимани~', 'отвлека~'],
  'phq9-08': ['медленн~', 'заторможен~', 'не сидится', 'беспокойн~', 'суетлив~'],
  'phq9-09': [
    'умереть',
    'смерт~',
    'навредить себе',
    'причинить себе',
    'покончить',
    'суицид~',
    'жить не хочется',
  ],
};

const fields: Record<string, FormFillOverlayField> = Object.fromEntries(
  Object.entries(TOPICS).map(([id, cues]) => [id, { cues, options: FREQUENCY }]),
);
fields['phq9-difficulty'] = {
  cues: ['мешают', 'мешает', 'трудно (?:работать|по дому|общаться|справляться)'],
  options: DIFFICULTY,
};

export const PHQ_9_OVERLAY: FormFillOverlay = { fields };
