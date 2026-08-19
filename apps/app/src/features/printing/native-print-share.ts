export const NATIVE_PRINT_SHARE_MAX_CHARS = 32_000;

export type NativePrintShareResult = 'shared' | 'printed' | 'cancelled';

function isAbortError(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError';
}

export function clipNativePrintShareText(
  text: string,
  maxChars: number = NATIVE_PRINT_SHARE_MAX_CHARS,
): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 1) return '…';
  return `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

export async function shareNativePrintContent(input: {
  readonly title: string;
  readonly text: string;
  readonly platform: string;
  readonly androidShare: (payload: {
    readonly title: string;
    readonly text: string;
  }) => Promise<void>;
  readonly webShare?: (payload: { readonly title: string; readonly text: string }) => Promise<void>;
  readonly print: () => void;
}): Promise<NativePrintShareResult> {
  const payload = { title: input.title, text: input.text };
  if (input.platform === 'android') {
    try {
      await input.androidShare(payload);
      return 'shared';
    } catch {
      if (!input.webShare) return 'cancelled';
      try {
        await input.webShare(payload);
        return 'shared';
      } catch {
        return 'cancelled';
      }
    }
  }

  if (input.webShare) {
    try {
      await input.webShare(payload);
      return 'shared';
    } catch (cause) {
      if (isAbortError(cause)) return 'cancelled';
    }
  }

  input.print();
  return 'printed';
}
