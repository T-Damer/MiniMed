/**
 * Whether a Markdown text already opens with the document's title as its first-level heading
 * («# Осмотр на дому» in a document titled «Осмотр на дому»). A page that draws the title above
 * such a text would show the same heading twice, at two sizes and two indents.
 */
export function markdownOpensWithTitle(markdown: string, title: string): boolean {
  const wanted = normalizeHeading(title);
  if (!wanted) return false;
  for (const line of markdown.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const heading = /^#(?!#)\s*(.*?)\s*#*\s*$/u.exec(trimmed);
    return heading ? normalizeHeading(heading[1] ?? '') === wanted : false;
  }
  return false;
}

function normalizeHeading(value: string): string {
  return value
    .replace(/[*_`~]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase('ru-RU');
}
