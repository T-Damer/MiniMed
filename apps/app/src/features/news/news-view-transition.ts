import { createSignal } from 'solid-js';

import { motionRate } from '@/state/motion';

/** Shared-element name of a source's avatar while it flies from its card into the source sheet. */
export const NEWS_AVATAR_TRANSITION = 'news-avatar';

const [avatarTransitionName, setAvatarTransitionName] = createSignal<string | undefined>();

/** The name the sheet's avatar carries while a transition is running; `undefined` otherwise. */
export const sheetAvatarTransitionName = avatarTransitionName;

/**
 * Runs `update` (which opens the source sheet) as a View Transition when the browser has them and
 * animations are on: the card's avatar becomes the sheet's avatar by the shared name, and the root
 * cross-fades. Otherwise `update` runs at once and the sheet's own rise animation plays (motion
 * tokens). The names are on the elements only for the length of the transition: a name may exist
 * once per document.
 */
export function openThroughAvatarTransition(
  avatar: HTMLElement | undefined,
  update: () => void,
): void {
  if (
    !avatar ||
    typeof document.startViewTransition !== 'function' ||
    motionRate() === 0 ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    update();
    return;
  }
  avatar.style.viewTransitionName = NEWS_AVATAR_TRANSITION;
  document.documentElement.classList.add('news-vt');
  const transition = document.startViewTransition(() => {
    avatar.style.viewTransitionName = '';
    setAvatarTransitionName(NEWS_AVATAR_TRANSITION);
    update();
  });
  const end = (): void => {
    avatar.style.viewTransitionName = '';
    document.documentElement.classList.remove('news-vt');
    setAvatarTransitionName(undefined);
  };
  transition.ready.catch((cause: unknown) => {
    console.warn('Переход карточки источника не сыграл.', cause);
  });
  transition.finished.then(end, (cause: unknown) => {
    console.warn('Переход карточки источника прерван.', cause);
    end();
  });
}
