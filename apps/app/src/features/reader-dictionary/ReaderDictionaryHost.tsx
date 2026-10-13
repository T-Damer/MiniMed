import type { MedicalCore } from '@localmed/contracts';
import { createEffect, createSignal, type JSX, lazy, Show } from 'solid-js';

import { readerDictionaryRequest } from '@/features/reader-dictionary/reader-dictionary-state';

const ReaderDictionarySheet = lazy(() =>
  import('@/features/reader-dictionary/ReaderDictionarySheet').then(
    ({ ReaderDictionarySheet: component }) => ({ default: component }),
  ),
);

/**
 * Mounted once at the app root. The sheet's code is fetched on the first lookup and the sheet then
 * stays mounted, so closing it can play its exit animation.
 */
export function ReaderDictionaryHost(props: {
  readonly core: MedicalCore | undefined;
  readonly onContentChanged: () => Promise<void>;
}): JSX.Element {
  const [used, setUsed] = createSignal(false);
  createEffect(() => {
    if (readerDictionaryRequest()) setUsed(true);
  });
  return (
    <Show when={used()}>
      <ReaderDictionarySheet core={props.core} onContentChanged={props.onContentChanged} />
    </Show>
  );
}
