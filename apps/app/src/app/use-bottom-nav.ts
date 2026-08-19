import { type Accessor, createEffect, createSignal, onCleanup, onMount } from 'solid-js';

import { ROOT_VIEW_ORDER, ROOT_VIEWS, type RootView } from '@/app/root-view';
import { hapticFeedback } from '@/state/haptics';

interface BottomNavBubblePosition {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface BottomNavBubbleMotion {
  readonly origin: 'center' | 'left' | 'right';
  readonly scaleX: number;
  readonly scaleY: number;
  readonly rotate: number;
}

interface BottomNavBubbleTravel {
  readonly edge: -1 | 0 | 1;
  readonly overscroll: number;
}

interface BottomNavGesture {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly startIndex: number;
  lastX: number;
  lastTime: number;
  lastDirection: number;
  moved: boolean;
}

const DEFAULT_BOTTOM_NAV_BUBBLE: BottomNavBubblePosition = {
  left: 0,
  top: 0,
  width: 42,
  height: 42,
};

export function useBottomNav(options: {
  readonly view: Accessor<RootView>;
  readonly navigate: (next: RootView) => void;
  readonly enabled: Accessor<boolean>;
}) {
  const [bottomNavBubble, setBottomNavBubble] =
    createSignal<BottomNavBubblePosition>(DEFAULT_BOTTOM_NAV_BUBBLE);
  const [bottomNavBubbleMotion, setBottomNavBubbleMotion] = createSignal<BottomNavBubbleMotion>({
    origin: 'center',
    scaleX: 1,
    scaleY: 1,
    rotate: 0,
  });
  const [bottomNavDragIndex, setBottomNavDragIndex] = createSignal<number>();
  const [bottomNavPressed, setBottomNavPressed] = createSignal(false);
  const [bottomNavDragging, setBottomNavDragging] = createSignal(false);

  let bottomNav: HTMLElement | undefined;
  let bottomNavResizeObserver: ResizeObserver | undefined;
  let bottomNavGesture: BottomNavGesture | undefined;
  let bottomNavBubbleFrame: number | undefined;
  let bottomNavBubbleSettleTimer: ReturnType<typeof setTimeout> | undefined;
  let suppressNavClickUntil = 0;
  let transitionObserver: MutationObserver | undefined;

  const navButtons = (): readonly HTMLButtonElement[] =>
    bottomNav ? Array.from(bottomNav.querySelectorAll<HTMLButtonElement>('.app-nav-button')) : [];

  const settleBottomNavBubbleMotion = (): void => {
    if (bottomNavBubbleSettleTimer) clearTimeout(bottomNavBubbleSettleTimer);
    bottomNavBubbleSettleTimer = setTimeout(() => {
      bottomNavBubbleSettleTimer = undefined;
      if (bottomNavDragging()) return;
      setBottomNavBubbleMotion({ origin: 'center', scaleX: 1, scaleY: 1, rotate: 0 });
    }, 380);
  };

  const scheduleBottomNavBubble = (): void => {
    if (bottomNavBubbleFrame !== undefined) cancelAnimationFrame(bottomNavBubbleFrame);
    bottomNavBubbleFrame = requestAnimationFrame(() => {
      bottomNavBubbleFrame = requestAnimationFrame(() => {
        bottomNavBubbleFrame = undefined;
        const nav = bottomNav;
        const activeIndex = ROOT_VIEW_ORDER.get(options.view()) ?? 0;
        const button = navButtons()[activeIndex];
        if (!nav || !button) return;
        const navRect = nav.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        if (buttonRect.width <= 0 || buttonRect.height <= 0) return;
        const next = {
          left: buttonRect.left - navRect.left,
          top: buttonRect.top - navRect.top,
          width: buttonRect.width,
          height: buttonRect.height,
        };
        const previous = bottomNavBubble();
        const dx = next.left - previous.left;
        if (!bottomNavDragging() && Math.abs(dx) > 4) {
          const speed = Math.min(1, Math.abs(dx) / 64);
          const direction = Math.sign(dx);
          setBottomNavBubbleMotion({
            origin: direction > 0 ? 'left' : 'right',
            scaleX: 1 + speed * 0.58,
            scaleY: 1 - speed * 0.16,
            rotate: direction * speed * 7,
          });
          settleBottomNavBubbleMotion();
        }
        setBottomNavBubble(next);
      });
    });
  };

  const bindNav = (element: HTMLElement): void => {
    bottomNav = element;
    bottomNavResizeObserver?.disconnect();
    bottomNavResizeObserver = new ResizeObserver(() => scheduleBottomNavBubble());
    bottomNavResizeObserver.observe(element);
    scheduleBottomNavBubble();
  };

  const navIndexAtX = (clientX: number): number => {
    const buttons = navButtons();
    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    buttons.forEach((button, index) => {
      const rect = button.getBoundingClientRect();
      const distance = Math.abs(clientX - (rect.left + rect.width / 2));
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });
    return closestIndex;
  };

  const moveBottomNavBubbleTo = (clientX: number): BottomNavBubbleTravel => {
    const nav = bottomNav;
    const current = bottomNavBubble();
    const buttons = navButtons();
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (!nav || !current || !first || !last) return { edge: 0, overscroll: 0 };
    const navRect = nav.getBoundingClientRect();
    const firstRect = first.getBoundingClientRect();
    const lastRect = last.getBoundingClientRect();
    const minCenter = firstRect.left - navRect.left + firstRect.width / 2;
    const maxCenter = lastRect.left - navRect.left + lastRect.width / 2;
    const relativeX = clientX - navRect.left;
    const edge: -1 | 0 | 1 = relativeX < 0 ? -1 : relativeX > navRect.width ? 1 : 0;
    const outsideDistance = edge === -1 ? -relativeX : edge === 1 ? relativeX - navRect.width : 0;
    const overscroll = Math.min(1, outsideDistance / Math.max(1, navRect.width * 0.35));
    const center = Math.max(minCenter, Math.min(maxCenter, relativeX));
    const left =
      edge === -1 ? 0 : edge === 1 ? navRect.width - current.width : center - current.width / 2;
    setBottomNavBubble({ ...current, left });
    return { edge, overscroll };
  };

  const bubbleStyle = (): string => {
    const position = bottomNavBubble();
    const motion = bottomNavBubbleMotion();
    const pressScale = bottomNavPressed() ? 0.92 : 1;
    return `left:${position.left}px;top:${position.top}px;width:${position.width}px;height:${position.height}px;transform-origin:${motion.origin} center;transform:scaleX(${motion.scaleX * pressScale}) scaleY(${motion.scaleY * pressScale}) rotate(${motion.rotate}deg)`;
  };

  const finishBottomNavGesture = (event: PointerEvent | undefined, commit = true): void => {
    const gesture = bottomNavGesture;
    if (!gesture || (event && gesture.pointerId !== event.pointerId)) return;
    const targetIndex = bottomNavDragIndex() ?? gesture.startIndex;
    const target = ROOT_VIEWS[targetIndex];
    if (gesture.moved && commit) {
      suppressNavClickUntil = performance.now() + 350;
      if (target && target.id !== options.view()) {
        hapticFeedback('medium');
        options.navigate(target.id);
      }
    }
    bottomNavGesture = undefined;
    setBottomNavPressed(false);
    setBottomNavDragging(false);
    setBottomNavBubbleMotion({ origin: 'center', scaleX: 1, scaleY: 1, rotate: 0 });
    setBottomNavDragIndex(undefined);
    if (event && bottomNav?.hasPointerCapture(event.pointerId)) {
      bottomNav.releasePointerCapture(event.pointerId);
    }
    scheduleBottomNavBubble();
  };

  const handlePointerDown = (event: PointerEvent): void => {
    if (!bottomNav || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const startIndex = navIndexAtX(event.clientX);
    const now = performance.now();
    bottomNavGesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startIndex,
      lastX: event.clientX,
      lastTime: now,
      lastDirection: 0,
      moved: false,
    };
    setBottomNavDragIndex(startIndex);
    setBottomNavPressed(true);
    setBottomNavBubbleMotion({ origin: 'center', scaleX: 1, scaleY: 1, rotate: 0 });
    moveBottomNavBubbleTo(event.clientX);
  };

  const handlePointerMove = (event: PointerEvent): void => {
    const gesture = bottomNavGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    if (!gesture.moved) {
      if (Math.hypot(deltaX, deltaY) < 8) return;
      if (Math.abs(deltaY) > Math.abs(deltaX)) {
        finishBottomNavGesture(event, false);
        return;
      }
      bottomNav?.setPointerCapture(event.pointerId);
      gesture.moved = true;
      setBottomNavDragging(true);
      suppressNavClickUntil = performance.now() + 350;
    }
    event.preventDefault();
    const now = performance.now();
    const elapsed = Math.max(8, now - gesture.lastTime);
    const deltaSinceLastMove = event.clientX - gesture.lastX;
    if (deltaSinceLastMove !== 0) gesture.lastDirection = Math.sign(deltaSinceLastMove);
    const velocity = Math.min(1, Math.abs(deltaSinceLastMove) / elapsed / 0.8);
    gesture.lastX = event.clientX;
    gesture.lastTime = now;
    const travel = moveBottomNavBubbleTo(event.clientX);
    setBottomNavBubbleMotion({
      origin: travel.edge === -1 ? 'left' : travel.edge === 1 ? 'right' : 'center',
      scaleX: Math.max(0.38, 1 + velocity * 0.72 - travel.overscroll * 0.62),
      scaleY: 1 - velocity * 0.18 + travel.overscroll * 0.12,
      rotate: gesture.lastDirection * (velocity * 8 + travel.overscroll * 2),
    });
    const nextIndex = navIndexAtX(event.clientX);
    if (nextIndex !== bottomNavDragIndex()) hapticFeedback('selection');
    setBottomNavDragIndex(nextIndex);
  };

  const handleClick = (next: RootView): void => {
    if (performance.now() < suppressNavClickUntil) {
      suppressNavClickUntil = 0;
      return;
    }
    options.navigate(next);
  };

  const handlePointerCancel = (event: PointerEvent): void => {
    finishBottomNavGesture(event, false);
  };

  const cancelOnWindowBlur = (): void => {
    if (bottomNavGesture) finishBottomNavGesture(undefined, false);
  };

  createEffect(() => {
    if (!options.enabled() || bottomNavDragIndex() !== undefined) return;
    options.view();
    scheduleBottomNavBubble();
  });

  onMount(() => {
    window.addEventListener('resize', scheduleBottomNavBubble);
    window.addEventListener('pointerup', finishBottomNavGesture);
    window.addEventListener('pointercancel', handlePointerCancel);
    window.addEventListener('blur', cancelOnWindowBlur);
    transitionObserver = new MutationObserver(() => {
      if (!document.documentElement.classList.contains('using-root-view-transition')) {
        scheduleBottomNavBubble();
      }
    });
    transitionObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    scheduleBottomNavBubble();
  });

  onCleanup(() => {
    window.removeEventListener('resize', scheduleBottomNavBubble);
    window.removeEventListener('pointerup', finishBottomNavGesture);
    window.removeEventListener('pointercancel', handlePointerCancel);
    window.removeEventListener('blur', cancelOnWindowBlur);
    transitionObserver?.disconnect();
    bottomNavResizeObserver?.disconnect();
    if (bottomNavBubbleFrame !== undefined) cancelAnimationFrame(bottomNavBubbleFrame);
    if (bottomNavBubbleSettleTimer) clearTimeout(bottomNavBubbleSettleTimer);
  });

  return {
    dragging: bottomNavDragging,
    pressed: bottomNavPressed,
    dragIndex: bottomNavDragIndex,
    bindNav,
    bubbleStyle,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp: finishBottomNavGesture,
    handlePointerCancel,
    handleClick,
  };
}
