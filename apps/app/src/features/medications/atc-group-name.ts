/**
 * The name that stands beside a drug's ATC code (QA 0.6.60: the code alone, «N02BE51», said nothing).
 * The НСИ «АТХ» dictionary names levels 1-4; a substance code (level 5, «N02BE51») is named by the
 * deepest group above it that the dictionary knows («N02BE» → «Анилиды»), never invented. The
 * anatomical letter alone is too broad to help and is not used.
 */

const MIN_GROUP_LENGTH = 3;
const MAX_GROUP_LENGTH = 5;

/** The group name for a code, or null when the dictionary knows none of its levels 2-4. */
export function atcGroupName(names: Readonly<Record<string, string>>, code: string): string | null {
  const upper = code.trim().toUpperCase();
  for (
    let length = Math.min(upper.length, MAX_GROUP_LENGTH);
    length >= MIN_GROUP_LENGTH;
    length -= 1
  ) {
    const name = names[upper.slice(0, length)];
    if (name !== undefined) return name;
  }
  return null;
}

/** The name in running text: «Анилиды» → «анилиды», an abbreviation («НПВП») keeps its capitals. */
export function atcGroupNameInline(name: string): string {
  return /\p{Lu}/u.test(name.slice(1))
    ? name
    : name.charAt(0).toLocaleLowerCase('ru-RU') + name.slice(1);
}
