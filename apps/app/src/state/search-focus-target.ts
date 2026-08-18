type SearchFocusElement = HTMLInputElement | HTMLTextAreaElement;

function isVisibleSearchTarget(element: SearchFocusElement): boolean {
  return (
    !element.disabled &&
    element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility !== 'hidden'
  );
}

function topmostModal(root: ParentNode): Element | null {
  const modals = root.querySelectorAll<HTMLElement>('[aria-modal="true"], .overlay-dialog');
  return modals.length > 0 ? modals.item(modals.length - 1) : null;
}

function maxAncestorZIndex(element: Element, root: ParentNode): number {
  let maxZ = 0;
  let current: Element | null = element;
  while (current && current !== root) {
    const zIndex = Number.parseInt(getComputedStyle(current).zIndex, 10);
    if (Number.isFinite(zIndex)) maxZ = Math.max(maxZ, zIndex);
    current = current.parentElement;
  }
  return maxZ;
}

export function pickSearchFocusTarget(root: ParentNode = document): SearchFocusElement | undefined {
  const candidates = Array.from(
    root.querySelectorAll<SearchFocusElement>('[data-search-focus-target]'),
  ).filter(isVisibleSearchTarget);
  if (candidates.length === 0) return undefined;

  const modal = topmostModal(root);
  if (modal) {
    const inModal = candidates.filter((element) => modal.contains(element));
    if (inModal.length > 0) {
      return inModal[inModal.length - 1];
    }
  }

  let best: SearchFocusElement | undefined;
  let bestZ = Number.NEGATIVE_INFINITY;
  let bestIndex = -1;
  candidates.forEach((element, index) => {
    const zIndex = maxAncestorZIndex(element, root);
    if (zIndex > bestZ || (zIndex === bestZ && index > bestIndex)) {
      best = element;
      bestZ = zIndex;
      bestIndex = index;
    }
  });
  return best;
}
