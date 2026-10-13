import type { Accessor } from 'solid-js';

import type { SubstanceFallbackAsset } from '@/features/medications/instruction-fallback';
import { loadSubstanceFallback } from '@/features/medications/substance-fallback';
import { createQuietResource } from '@/state/quiet-resource';

/**
 * The fallback asset for a medication screen, or undefined until it has loaded. Requested only once
 * `enabled` is true; an asset that fails to load is logged and the screen simply shows no fallback.
 */
export function useSubstanceFallback(
  enabled: Accessor<boolean>,
): Accessor<SubstanceFallbackAsset | undefined> {
  const asset = createQuietResource(
    () => (enabled() ? true : undefined),
    () =>
      loadSubstanceFallback().catch((cause: unknown) => {
        console.error('Не удалось загрузить сопоставление инструкций по веществу.', cause);
        return undefined;
      }),
  );
  return () => asset.value();
}
