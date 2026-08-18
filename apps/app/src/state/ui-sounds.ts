import { type CueName, createUISFX, type UISFXPlayer } from 'uisfx';

import {
  getSoundVolume,
  loadAppPreferences,
  subscribeAppPreferences,
} from '@/state/app-preferences';

const PRELOAD_CUES: readonly CueName[] = [
  'hover',
  'press',
  'select',
  'open',
  'forward',
  'back',
  'delete',
  'send',
  'start',
  'close',
  'check',
  'info',
  'warning',
  'snap',
  'swipe',
  'volume-change',
  'toggle-on',
  'toggle-off',
];

const FINE_HOVER_QUERY = '(hover: hover) and (pointer: fine)';

const CUE_GAIN: Partial<Record<CueName, number>> = {
  press: 1.35,
  forward: 1.35,
  select: 1.25,
  open: 1.2,
  back: 0.85,
};

export class UiSoundController {
  private readonly player: UISFXPlayer;
  private unlocked = false;
  private preferencesSubscribed = false;
  private hoverTarget: Element | null = null;

  constructor(player?: UISFXPlayer) {
    const preferences = loadAppPreferences();
    this.player =
      player ??
      createUISFX({
        pack: 'zen',
        volume: preferences.soundVolume,
        enabled: preferences.soundVolume > 0,
      });
    this.applyVolume(preferences.soundVolume);
  }

  ensurePreferences(): void {
    if (this.preferencesSubscribed) return;
    this.preferencesSubscribed = true;
    subscribeAppPreferences((preferences) => {
      this.applyVolume(preferences.soundVolume);
    });
  }

  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    void this.player.unlock().then((ready) => {
      if (!ready) return;
      void this.player.preload(PRELOAD_CUES);
    });
  }

  play(cue: CueName): void {
    this.ensurePreferences();
    const master = getSoundVolume();
    if (master <= 0) return;
    this.unlock();
    const gain = CUE_GAIN[cue] ?? 1;
    void this.player.play(cue, { volume: master * gain });
  }

  hover(target: Element, pointerType?: string, cue: CueName = 'hover'): void {
    if (pointerType === 'touch') return;
    if (!this.allowsHover()) return;
    if (this.hoverTarget === target) return;
    this.hoverTarget = target;
    this.play(cue);
  }

  clearHover(target?: Element | null): void {
    if (!target || this.hoverTarget === target) this.hoverTarget = null;
  }

  setVolume(volume: number): void {
    this.applyVolume(volume);
  }

  reset(): void {
    this.unlocked = false;
    this.preferencesSubscribed = false;
    this.hoverTarget = null;
    this.applyVolume(loadAppPreferences().soundVolume);
  }

  private allowsHover(): boolean {
    return typeof window.matchMedia === 'function' && window.matchMedia(FINE_HOVER_QUERY).matches;
  }

  private applyVolume(volume: number): void {
    this.player.setVolume(volume);
    if (volume <= 0) {
      this.player.setEnabled(false);
      this.player.stopAll();
      this.hoverTarget = null;
      return;
    }
    this.player.setEnabled(true);
  }
}

export const uiSounds = new UiSoundController();

export function resetUiSoundsForTests(): void {
  uiSounds.reset();
}
