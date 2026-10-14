import type { JSX } from 'solid-js';

import { AtcCodeSheet } from '@/features/medications/AtcCodeSheet';
import { atcCodeFromText } from '@/features/medications/atc-text-links';

/**
 * The code sheet of an ATC code met in a document (ATC5). A default export so a reader loads it as a
 * lazy chunk, only when a code is tapped.
 */
export default function AtcTextCodeSheet(props: {
  readonly code: string;
  readonly written: string;
  readonly open: boolean;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <AtcCodeSheet
      code={atcCodeFromText(props.code, props.written)}
      origin="text"
      open={props.open}
      onClose={props.onClose}
    />
  );
}
