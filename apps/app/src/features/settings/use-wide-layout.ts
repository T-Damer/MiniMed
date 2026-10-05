import { type Accessor, createSignal, onCleanup, onMount } from 'solid-js';

/** The settings list and the open page sit side by side from this width (master–detail). */
export const SETTINGS_WIDE_QUERY = '(min-width: 900px)';

export function useWideLayout(): Accessor<boolean> {
  const [wide, setWide] = createSignal(
    typeof window !== 'undefined' && window.matchMedia(SETTINGS_WIDE_QUERY).matches,
  );
  onMount(() => {
    const media = window.matchMedia(SETTINGS_WIDE_QUERY);
    const sync = (): void => {
      setWide(media.matches);
    };
    sync();
    media.addEventListener('change', sync);
    onCleanup(() => media.removeEventListener('change', sync));
  });
  return wide;
}
