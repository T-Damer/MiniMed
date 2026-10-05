import type { JSX } from 'solid-js';

import { ReferenceImageExamplesPanel } from '@/features/settings/ReferenceImageExamples';
import { ReferenceImagesSettings } from '@/features/settings/ReferenceImagesSettings';

/** «Справочные изображения»: what the set holds, examples from it and the download itself. */
export function ReferenceImagesPage(): JSX.Element {
  return (
    <>
      <ReferenceImageExamplesPanel />
      <ReferenceImagesSettings />
    </>
  );
}
