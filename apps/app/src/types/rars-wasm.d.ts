declare module '@minimed-rars-wasm' {
  interface RarInfo {
    readonly isDirectory: boolean;
    readonly name: string;
    readonly size: number;
    free(): void;
  }

  export class RarFile {
    constructor(data: Uint8Array);
    entries(): RarInfo[];
    readAt(index: number): Uint8Array;
    free(): void;
  }

  const initialize: (input?: unknown) => Promise<unknown>;
  export default initialize;
}
