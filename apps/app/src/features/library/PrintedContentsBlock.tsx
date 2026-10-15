import type { MedicalSection } from '@localmed/contracts';
import { For, type JSX } from 'solid-js';

import { Disclosure } from '@/components/Disclosure';
import { presentContentsLine } from '@/features/library/printed-contents';
import '@/features/library/printed-contents.css';

function linesOf(sections: readonly MedicalSection[]): readonly string[] {
  return sections.flatMap((section) => [
    ...(section.title.trim() === '' ? [] : [section.title]),
    ...section.chunks.flatMap((chunk) =>
      chunk.originalText.split('\n').filter((line) => line.trim() !== ''),
    ),
  ]);
}

/**
 * The contents the PDF printed at its start, collapsed: the reader has its own outline, and these
 * lines (with their leader dots and page numbers of the paper original) are not what a reader
 * opens a guideline for. The text is kept whole.
 */
export function PrintedContentsBlock(props: {
  readonly sections: readonly MedicalSection[];
  /** Open when the place being opened is inside the printed contents. */
  readonly defaultOpen: boolean;
}): JSX.Element {
  return (
    <Disclosure
      variant="inline"
      class="printed-contents"
      title="Оглавление печатной версии"
      defaultOpen={props.defaultOpen}
    >
      <ul class="printed-contents__list">
        <For each={linesOf(props.sections)}>
          {(line) => <li class="printed-contents__line">{presentContentsLine(line)}</li>}
        </For>
      </ul>
    </Disclosure>
  );
}
