/**
 * What the speech model returned, made fit for a transcript (REC1). Whisper was trained on video
 * subtitles: on quiet or unclear audio it writes the credits it saw most often («Субтитры сделал
 * …», «Продолжение следует…», «Спасибо за просмотр») and it can loop on one phrase. Those are not
 * what was said; a stretch that is only that is dropped, and a loop is cut to one occurrence. The
 * text itself is never logged.
 */

const PHANTOM_PATTERNS: readonly RegExp[] = [
  /субтитр/iu,
  /редактор\w*\s+субтитр/iu,
  /продолжение\s+следует/iu,
  /спасибо\s+за\s+просмотр/iu,
  /подпис\w+\s+на\s+канал/iu,
  /ставьте\s+лайк/iu,
  /dimatorzok/iu,
  /amara\.org/iu,
  /^\s*\[?\s*(музыка|аплодисменты|смех|тишина|music|silence)\s*\]?\s*[.!]?\s*$/iu,
];

/** A sentence-like piece: the text split after . ! ? … */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?…])\s+/u).filter((part) => part.trim().length > 0);
}

function isPhantom(sentence: string): boolean {
  return PHANTOM_PATTERNS.some((pattern) => pattern.test(sentence));
}

/** «да да да да да» → «да да»; a phrase repeated three or more times in a row → once. */
function collapseLoops(text: string): string {
  const words = text.split(/\s+/u).filter(Boolean);
  for (let size = 1; size <= 8; size += 1) {
    let index = 0;
    const out: string[] = [];
    while (index < words.length) {
      const phrase = words.slice(index, index + size);
      let repeats = 1;
      while (
        index + (repeats + 1) * size <= words.length &&
        words
          .slice(index + repeats * size, index + (repeats + 1) * size)
          .every((word, at) => word.toLowerCase() === phrase[at]?.toLowerCase())
      ) {
        repeats += 1;
      }
      const keep = repeats >= 3 ? (size === 1 ? 2 : 1) : repeats;
      for (let copy = 0; copy < keep; copy += 1) out.push(...phrase);
      index += repeats * size;
    }
    words.splice(0, words.length, ...out);
  }
  return words.join(' ');
}

/** The cleaned text of one recognised stretch; empty when nothing real was said. */
export function cleanRecognisedText(raw: string): string {
  const text = raw.replace(/\s+/gu, ' ').trim();
  if (!text) return '';
  const kept = sentences(text).filter((sentence) => !isPhantom(sentence));
  const joined = collapseLoops(kept.join(' ')).trim();
  // Punctuation alone («...», «-») is not speech.
  return /[\p{L}\p{N}]/u.test(joined) ? joined : '';
}
