export const NATIVE_TEXT_THRESHOLD = 40;

export function pageHasEnoughNativeText(text: string): boolean {
  return text.replace(/\s+/gu, '').length >= NATIVE_TEXT_THRESHOLD;
}
