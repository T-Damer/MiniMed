import { type ComponentProps, type JSX, lazy, Suspense } from 'solid-js';

import { SkeletonLines } from '@/components/PageSkeleton';
import type { DefinitionReferencePanel } from '@/features/reference/DefinitionReferencePanel';

/**
 * The dictionary panel reads the ~10 MB release catalog: imported directly, it put the catalog's
 * download and validation in front of the search screen at every start (PERF5). Its code comes when
 * the panel is opened; text lines stand in for the moment it takes.
 */
const Panel = lazy(() =>
  import('@/features/reference/DefinitionReferencePanel').then(
    ({ DefinitionReferencePanel: component }) => ({ default: component }),
  ),
);

export function LazyDefinitionReferencePanel(
  props: ComponentProps<typeof DefinitionReferencePanel>,
): JSX.Element {
  return (
    <Suspense fallback={<SkeletonLines label="Открываем словарь" lines={4} />}>
      <Panel {...props} />
    </Suspense>
  );
}
