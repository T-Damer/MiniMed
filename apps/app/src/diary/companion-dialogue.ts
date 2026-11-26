const followUps = [
  'Спасибо, что рассказали. Что из этого вам особенно важно сегодня?',
  'Можете рассказать ещё, если хочется. Что было дальше?',
  'Что бы вам хотелось запомнить из этого разговора?',
  'Можем продолжить в вашем темпе. Что ещё хочется записать?',
] as const;

const words =
  typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('ru', { granularity: 'word' })
    : undefined;

// Recognize only short complete conversational acts. Patient narratives are never classified
// into symptoms, treatments, or diary values by these rules.
function normalizedPhrase(message: string): string {
  const lower = message.trim().toLocaleLowerCase('ru-RU');
  return words
    ? Array.from(words.segment(lower))
        .filter((part) => part.isWordLike)
        .map((part) => part.segment)
        .join(' ')
    : lower;
}

// Whole direct requests only. A cue offers the safety sheet; it never diagnoses or sends an alert.
export function companionHelpIntent(message: string): boolean {
  switch (normalizedPhrase(message)) {
    case 'мне нужна срочная помощь':
    case 'мне сейчас небезопасно':
    case 'хочу навредить себе':
    case 'я хочу навредить себе':
    case 'я хочу причинить себе вред':
    case 'я хочу покончить с собой':
    case 'хочу покончить с собой':
    case 'я хочу навредить другим':
    case 'я хочу причинить вред другому человеку':
      return true;
    default:
      return false;
  }
}

export function companionReply(message: string, turn: number): string {
  if (companionHelpIntent(message)) {
    return 'Похоже, сейчас вам нужна помощь. Попробуйте побыть рядом с человеком, которому доверяете. Можно открыть контакты помощи прямо здесь.';
  }
  switch (normalizedPhrase(message)) {
    case 'спасибо':
    case 'спасибо тебе':
    case 'большое спасибо':
      return 'Пожалуйста. Можно вернуться к записи в любое время.';
    case 'не знаю':
    case 'не знаю что сказать':
      return 'Можно обойтись парой слов. Например, что вам запомнилось за сегодняшний день?';
    case 'не хочу':
    case 'не сейчас':
    case 'потом':
      return 'Хорошо. Продолжим, когда вам будет удобно.';
    default:
      if (message.trimEnd().endsWith('?')) {
        return 'Можем сохранить этот вопрос для врача. Хотите добавить его в дневник?';
      }
      return followUps[Math.min(turn, followUps.length - 1)] ?? followUps[0];
  }
}
