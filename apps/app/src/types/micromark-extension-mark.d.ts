declare module 'micromark-extension-mark' {
  export function pandocMark(options?: { readonly html?: boolean }): unknown;
  export function pandocMarkHtml(options?: unknown): unknown;
}
