export function splitIcdCodes(text: string): readonly { text: string; code: boolean }[] {
  const pattern =
    /(?<![\p{L}\p{N}])[A-ZАВЕКМНОРСТУХ]\d{2}(?:\.\d{1,4})?(?:\s*[-–—]\s*[A-ZАВЕКМНОРСТУХ]\d{2}(?:\.\d{1,4})?)?(?![\p{L}\p{N}])/gu;
  const parts: { text: string; code: boolean }[] = [];
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > offset) parts.push({ text: text.slice(offset, match.index), code: false });
    parts.push({ text: match[0], code: true });
    offset = match.index + match[0].length;
  }
  if (offset < text.length) parts.push({ text: text.slice(offset), code: false });
  return parts;
}
