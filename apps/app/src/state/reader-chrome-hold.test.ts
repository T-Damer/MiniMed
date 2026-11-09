import { describe, expect, it } from 'vitest';

import { extendReaderChromeHold, READER_CHROME_HOLD_MAX_MS } from '@/state/reader-chrome-hold';

describe('extendReaderChromeHold', () => {
  it('lets a zero hold show the controls without ending a jump that holds them', () => {
    // A restore jump holds the controls for 2.5 s; the new text asks for a zero hold right after.
    const jump = extendReaderChromeHold(0, 1000, 2500);
    expect(extendReaderChromeHold(jump, 1005, 0)).toBe(3500);
  });

  it('extends a running hold and caps one request', () => {
    expect(extendReaderChromeHold(1200, 1000, 700)).toBe(1700);
    expect(extendReaderChromeHold(0, 1000, 60_000)).toBe(1000 + READER_CHROME_HOLD_MAX_MS);
    expect(extendReaderChromeHold(0, 1000, -5)).toBe(1000);
  });
});
