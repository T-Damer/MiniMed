export type HorizontalSwipeDirection = 'left' | 'right';

export interface HorizontalGestureOptions {
  readonly thresholdPx?: number;
  readonly axisLockPx?: number;
  readonly velocityThresholdPxPerMs?: number;
  readonly minimumVelocityDistancePx?: number;
}

interface HorizontalGestureState {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly startedAt: number;
  axis: 'pending' | 'horizontal';
}

export interface HorizontalGestureManager {
  readonly start: (pointerId: number, x: number, y: number, time?: number) => void;
  readonly move: (
    pointerId: number,
    x: number,
    y: number,
    time?: number,
  ) => HorizontalSwipeDirection | null;
  readonly end: (pointerId?: number) => void;
  readonly active: () => boolean;
}

export function createHorizontalGestureManager(
  options: HorizontalGestureOptions = {},
): HorizontalGestureManager {
  const thresholdPx = options.thresholdPx ?? 64;
  const axisLockPx = options.axisLockPx ?? 10;
  const velocityThresholdPxPerMs = options.velocityThresholdPxPerMs ?? 0.55;
  const minimumVelocityDistancePx = options.minimumVelocityDistancePx ?? 24;
  let state: HorizontalGestureState | undefined;

  const end = (pointerId?: number): void => {
    if (pointerId !== undefined && state?.pointerId !== pointerId) return;
    state = undefined;
  };

  const start = (pointerId: number, x: number, y: number, time = performance.now()): void => {
    state = {
      pointerId,
      startX: x,
      startY: y,
      startedAt: time,
      axis: 'pending',
    };
  };

  const move = (
    pointerId: number,
    x: number,
    y: number,
    time = performance.now(),
  ): HorizontalSwipeDirection | null => {
    const gesture = state;
    if (!gesture || gesture.pointerId !== pointerId) return null;

    const deltaX = x - gesture.startX;
    const deltaY = y - gesture.startY;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    if (gesture.axis === 'pending') {
      if (Math.hypot(deltaX, deltaY) < axisLockPx) return null;
      if (absY >= absX) {
        end(pointerId);
        return null;
      }
      gesture.axis = 'horizontal';
    }

    if (absY > absX * 0.8) {
      end(pointerId);
      return null;
    }

    const elapsed = Math.max(1, time - gesture.startedAt);
    const velocity = absX / elapsed;
    const passedDistance = absX >= thresholdPx;
    const passedVelocity =
      absX >= minimumVelocityDistancePx && velocity >= velocityThresholdPxPerMs;
    if (!passedDistance && !passedVelocity) return null;

    const direction: HorizontalSwipeDirection = deltaX < 0 ? 'left' : 'right';
    end(pointerId);
    return direction;
  };

  return {
    start,
    move,
    end,
    active: () => Boolean(state),
  };
}
