import { type Accessor, createContext, createSignal, useContext } from 'solid-js';

/**
 * Where the reader's page counter («12 / 94») lives. The shell owns the numbers; a surface inside
 * the paper that is opaque and sticky (the section-path line) can claim the counter, and then the
 * shell no longer floats it over the text.
 */
export interface ReaderPageHost {
  readonly page: Accessor<number>;
  readonly total: Accessor<number>;
  /** The contents drawer covers the page. */
  readonly hidden: Accessor<boolean>;
  readonly go: (page: number) => void;
  /** Takes the counter; returns the release. */
  readonly claim: () => () => void;
}

export const ReaderPageHostContext = createContext<ReaderPageHost>();

export function useReaderPageHost(): ReaderPageHost | undefined {
  return useContext(ReaderPageHostContext);
}

/** Claim state of one reader shell: the count of surfaces that hold the counter. */
export function createReaderPageClaims(): {
  readonly claimed: Accessor<boolean>;
  readonly claim: () => () => void;
} {
  const [claims, setClaims] = createSignal(0);
  return {
    claimed: () => claims() > 0,
    claim: () => {
      setClaims((count) => count + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        setClaims((count) => count - 1);
      };
    },
  };
}
