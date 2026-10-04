import { type Accessor, createResource } from 'solid-js';

import { loadMfgCountries } from '@/features/medications/mfg-countries';
import type { MfgCountryCatalog } from '@/features/medications/mfg-country';

/**
 * The manufacturing-country catalog for a medication screen, or undefined until it has loaded.
 * The lazy chunk is requested only once `enabled` is true, so a screen that shows no drug never
 * fetches it; a chunk that fails to load is logged and the screen simply shows no countries.
 */
export function useMfgCountries(
  enabled: Accessor<boolean>,
): Accessor<MfgCountryCatalog | undefined> {
  const [catalog] = createResource(
    () => (enabled() ? true : undefined),
    () =>
      loadMfgCountries().catch((cause: unknown) => {
        console.error('Не удалось загрузить страны производства препаратов.', cause);
        return undefined;
      }),
  );
  return () => catalog();
}
