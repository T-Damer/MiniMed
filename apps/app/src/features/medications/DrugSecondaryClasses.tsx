import { type JSX, Show } from 'solid-js';
import { secondaryClassLine } from '@/features/drug-interactions/secondary-classes';
import { loadSecondaryClasses } from '@/features/drug-interactions/secondary-classes-load';
import { createQuietResource } from '@/state/quiet-resource';

import '@/features/medications/drug-screen.css';

/**
 * «также: снотворное (через фенобарбитал)»: the extra classes that one component of a combination
 * product brings (CLS1, CLS2), as one small plain line under the code. They come from a few-kB file
 * of their own, not from the 2.1 MB interaction index; a drug without any shows nothing, and a file
 * that fails to load is logged and the screen simply has no line.
 */
export function DrugSecondaryClasses(props: { readonly slug: string | undefined }): JSX.Element {
  const line = createQuietResource(
    () => props.slug,
    (slug) =>
      loadSecondaryClasses()
        .then((catalog) => secondaryClassLine(catalog.get(slug)) ?? undefined)
        .catch((cause: unknown) => {
          console.error('Не удалось загрузить дополнительные классы препаратов.', cause);
          return undefined;
        }),
  );
  return (
    <Show when={line.value()}>
      {(text) => (
        <p class="drug-links__also" data-testid="drug-secondary-classes">
          {text()}
        </p>
      )}
    </Show>
  );
}
