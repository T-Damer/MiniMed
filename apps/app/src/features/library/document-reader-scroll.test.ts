import { describe, expect, it } from 'vitest';

import {
  isReaderJumpArrived,
  READER_JUMP_TOLERANCE_PX,
  readerJumpDelta,
} from '@/features/library/document-reader-scroll';

const viewport = { top: 60, bottom: 760 };

describe('readerJumpDelta', () => {
  it('start puts the target top at the start offset below the sticky headings', () => {
    expect(readerJumpDelta({ top: 1182, height: 300 }, 'start', viewport, 182)).toBe(1000);
    expect(readerJumpDelta({ top: 182, height: 300 }, 'start', viewport, 182)).toBe(0);
    expect(readerJumpDelta({ top: 40, height: 300 }, 'start', viewport, 182)).toBe(-142);
  });

  it('center puts a short target in the middle of the reading area, below the chrome', () => {
    // The middle of 60..760 is 410: a 20px target belongs at top 400.
    expect(readerJumpDelta({ top: 400, height: 20 }, 'center', viewport, 0)).toBe(0);
    expect(readerJumpDelta({ top: 2400, height: 20 }, 'center', viewport, 0)).toBe(2000);
    expect(readerJumpDelta({ top: -900, height: 20 }, 'center', viewport, 0)).toBe(-1300);
  });

  it('center aligns a target taller than the reading area to the area top', () => {
    expect(readerJumpDelta({ top: 500, height: 900 }, 'center', viewport, 0)).toBe(432);
  });
});

describe('isReaderJumpArrived', () => {
  it('accepts a remainder inside the tolerance in both directions', () => {
    expect(isReaderJumpArrived(0)).toBe(true);
    expect(isReaderJumpArrived(READER_JUMP_TOLERANCE_PX)).toBe(true);
    expect(isReaderJumpArrived(-READER_JUMP_TOLERANCE_PX)).toBe(true);
    expect(isReaderJumpArrived(READER_JUMP_TOLERANCE_PX + 0.5)).toBe(false);
    expect(isReaderJumpArrived(-120)).toBe(false);
  });
});
