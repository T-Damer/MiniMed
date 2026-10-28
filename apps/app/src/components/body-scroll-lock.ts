let lockCount = 0;
let savedOverflow = '';
let savedGutter = '';
let savedScrollY = 0;

export function lockBodyScroll(): () => void {
  if (lockCount === 0) {
    const root = document.documentElement;
    savedOverflow = document.body.style.overflow;
    savedGutter = root.style.scrollbarGutter;
    savedScrollY = window.scrollY;
    // A page with a classic (space-taking) scrollbar keeps its gutter while locked, so hiding the
    // scrollbar does not widen the page and shift everything under the dialog.
    if (window.innerWidth > root.clientWidth) root.style.scrollbarGutter = 'stable';
    document.body.style.overflow = 'hidden';
  }
  lockCount += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) {
      document.body.style.overflow = savedOverflow;
      document.documentElement.style.scrollbarGutter = savedGutter;
      window.scrollTo(0, savedScrollY);
    }
  };
}
