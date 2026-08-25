declare module 'mdast-util-mark' {
  export function pandocMarkFromMarkdown(): unknown;
  export function pandocMarkToMarkdown(options?: {
    readonly strong?: string;
    readonly emphasis?: string;
  }): unknown;
}
