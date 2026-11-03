/**
 * A dialog whose owner is torn down while it is open (a parent `<Show when>` or `<Match>` that
 * drops it, the page behind it going away) would vanish between two frames. The exit still has to
 * play: this copies the backdrop with its panel into the document, puts it into its closing state
 * and removes it when the animations are over. The copy is inert and hidden from assistive tech;
 * the live dialog is already gone.
 */

/** Upper bound at normal speed, in case an exit animation never reports finishing. */
const GHOST_FALLBACK_MS = 700;

function copyCanvases(from: HTMLElement, to: HTMLElement): void {
  const source = from.querySelectorAll('canvas');
  const target = to.querySelectorAll('canvas');
  source.forEach((canvas, index) => {
    const copy = target.item(index);
    if (!copy || canvas.width === 0 || canvas.height === 0) return;
    try {
      copy.getContext('2d')?.drawImage(canvas, 0, 0);
    } catch (cause) {
      // A tainted or lost-context canvas stays blank for the length of the exit.
      console.warn('Холст не скопирован для закрытия окна', cause);
    }
  });
}

function scrollOffsets(root: HTMLElement): readonly (readonly [number, number])[] {
  const offsets: [number, number][] = [];
  root.querySelectorAll<HTMLElement>('*').forEach((element, index) => {
    if (element.scrollTop > 0) offsets.push([index, element.scrollTop]);
  });
  return offsets;
}

/** Plays the exit of `backdrop` on a copy of it; returns false when there is nothing to show. */
export function playExitGhost(backdrop: HTMLElement, fallbackMs: number): boolean {
  if (!backdrop.isConnected) return false;
  const ghost = backdrop.cloneNode(true) as HTMLElement;
  ghost.querySelectorAll('[id]').forEach((element) => {
    element.removeAttribute('id');
  });
  ghost.querySelectorAll('video, audio, iframe').forEach((element) => {
    element.remove();
  });
  ghost.setAttribute('aria-hidden', 'true');
  ghost.setAttribute('inert', '');
  ghost.removeAttribute('role');
  ghost.querySelector('[role="dialog"], [role="alertdialog"]')?.removeAttribute('role');
  ghost.classList.add('overlay-backdrop--closing', 'overlay-backdrop--ghost');
  const panel = ghost.querySelector<HTMLElement>('.overlay-dialog');
  panel?.classList.remove('overlay-dialog--dragging');
  panel?.classList.add('overlay-dialog--closing');
  const offsets = scrollOffsets(backdrop);
  // An exit that is already on its way carries on from where it is, not from its start.
  const livePanel = backdrop.querySelector<HTMLElement>('.overlay-dialog');
  const progress = [
    ...(backdrop.classList.contains('overlay-backdrop--closing') ? backdrop.getAnimations() : []),
    ...(livePanel?.classList.contains('overlay-dialog--closing') ? livePanel.getAnimations() : []),
  ].map((animation) => ({ startTime: animation.startTime, currentTime: animation.currentTime }));
  document.body.append(ghost);
  copyCanvases(backdrop, ghost);
  if (offsets.length > 0) {
    const copies = ghost.querySelectorAll<HTMLElement>('*');
    for (const [index, top] of offsets) {
      const copy = copies.item(index);
      if (copy) copy.scrollTop = top;
    }
  }
  let done = false;
  const remove = (): void => {
    if (done) return;
    done = true;
    window.clearTimeout(fallback);
    ghost.remove();
  };
  const fallback = window.setTimeout(remove, Math.max(GHOST_FALLBACK_MS, fallbackMs));
  // Only the backdrop's and the panel's own exits: the content may hold endless spinners.
  const animations = [...ghost.getAnimations(), ...(panel?.getAnimations() ?? [])];
  if (progress.length === animations.length) {
    animations.forEach((animation, index) => {
      const live = progress[index];
      if (!live) return;
      // The start time, not the current time: it is the same moment on the shared timeline, so
      // a main thread that was busy for a while does not make the copy start behind the original.
      if (live.startTime !== null) animation.startTime = live.startTime;
      else if (live.currentTime !== null) animation.currentTime = live.currentTime;
    });
  }
  if (animations.length === 0) {
    remove();
    return true;
  }
  void Promise.allSettled(animations.map((animation) => animation.finished)).then(remove);
  return true;
}
