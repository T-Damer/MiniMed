let lockCount = 0;
let savedOverflow = '';
let savedScrollY = 0;

export function lockBodyScroll(): () => void {
  if (lockCount === 0) {
    savedOverflow = document.body.style.overflow;
    savedScrollY = window.scrollY;
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
      window.scrollTo(0, savedScrollY);
    }
  };
}
