import { type Accessor, createSignal, onCleanup } from 'solid-js';
import type { ToolAgeFilter } from '@/features/tools/tool-age-filter';
import {
  getToolAgeFilter,
  setToolAgeFilter,
  subscribeAppPreferences,
} from '@/state/app-preferences';

/**
 * The remembered «Дети / Взрослые / Все» choice as a reactive pair: every list of tools reads the
 * same preference, so changing it in one place changes it in all of them.
 */
export function createToolAgeFilter(): readonly [
  Accessor<ToolAgeFilter>,
  (next: ToolAgeFilter) => void,
] {
  const [filter, setFilter] = createSignal<ToolAgeFilter>(getToolAgeFilter());
  onCleanup(subscribeAppPreferences((preferences) => setFilter(preferences.toolAgeFilter)));
  return [filter, (next) => void setToolAgeFilter(next)];
}
