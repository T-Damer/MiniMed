export type HapticStrength = 'light' | 'medium' | 'heavy';

const PATTERNS: Readonly<Record<HapticStrength, number | readonly number[]>> = {
  light: 8,
  medium: [12, 8, 12],
  heavy: [24, 12, 32],
};

export function hapticPattern(strength: HapticStrength): number | readonly number[] {
  return PATTERNS[strength];
}

export function hapticFeedback(strength: HapticStrength): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
  return navigator.vibrate(hapticPattern(strength) as VibratePattern);
}

export function installButtonHaptics(root: Document = document): () => void {
  const handleClick = (event: MouseEvent): void => {
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    if (!(button instanceof HTMLButtonElement) || button.disabled) return;

    const explicit = button.dataset['haptic'];
    const strength: HapticStrength =
      explicit === 'heavy' || button.matches('[aria-label^="Удалить"], .danger')
        ? 'heavy'
        : explicit === 'medium' ||
            button.matches('.app-nav-button, .search-button, .content-download-pill')
          ? 'medium'
          : 'light';
    hapticFeedback(strength);
  };

  root.addEventListener('click', handleClick);
  return () => root.removeEventListener('click', handleClick);
}
