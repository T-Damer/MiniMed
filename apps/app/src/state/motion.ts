/**
 * AnimationManager: one speed for every animation in the app, chosen in Settings.
 *
 * CSS transitions and keyframe animations keep their own durations and easings; the manager sets
 * each running animation's playback rate as it starts (`transitionrun`/`animationstart`, captured
 * at the document) and wraps `Element.animate` for scripted ones. «Off» collapses durations to
 * almost zero in CSS, so end states and `transitionend`/`animationend` handlers still happen.
 * Code that times things itself (timers, requestAnimationFrame) uses {@link motionMs}.
 */
import {
  type AppPreferences,
  loadAppPreferences,
  type MotionSpeed,
  subscribeAppPreferences,
} from '@/state/app-preferences';

/** Playback rate per speed: above 1 is faster; «off» is handled by CSS and finished animations. */
const RATE: Readonly<Record<MotionSpeed, number>> = { off: 0, fast: 1.6, normal: 1, slow: 0.6 };

let rate = 1;

/** The current playback rate: 0 when animations are off. */
export function motionRate(): number {
  return rate;
}

/** A duration in milliseconds at the chosen speed (0 when animations are off). */
export function motionMs(ms: number): number {
  return rate === 0 ? 0 : Math.round(ms / rate);
}

function applySpeed(speed: MotionSpeed): void {
  rate = RATE[speed];
  document.documentElement.dataset['motion'] = speed;
}

function retime(event: Event): void {
  if (rate === 1 || rate === 0) return;
  const target = event.target;
  if (!(target instanceof Element) || typeof target.getAnimations !== 'function') return;
  for (const animation of target.getAnimations()) {
    if (animation.playbackRate !== rate) animation.updatePlaybackRate(rate);
  }
}

let installed = false;

export function installMotionManager(): () => void {
  applySpeed(loadAppPreferences().motionSpeed);
  const unsubscribe = subscribeAppPreferences((preferences: AppPreferences) =>
    applySpeed(preferences.motionSpeed),
  );
  document.addEventListener('transitionrun', retime, true);
  document.addEventListener('animationstart', retime, true);
  if (!installed && typeof Element.prototype.animate === 'function') {
    installed = true;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function motionAwareAnimate(
      this: Element,
      keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
      options?: number | KeyframeAnimationOptions,
    ): Animation {
      const animation = animate.call(this, keyframes, options);
      if (rate === 0) animation.finish();
      else if (rate !== 1) animation.updatePlaybackRate(rate);
      return animation;
    };
  }
  return () => {
    unsubscribe();
    document.removeEventListener('transitionrun', retime, true);
    document.removeEventListener('animationstart', retime, true);
  };
}
