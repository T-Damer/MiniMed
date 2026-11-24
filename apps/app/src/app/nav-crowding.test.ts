import { describe, expect, it } from 'vitest';
import { navLeavesRoomForTools } from './nav-crowding';

describe('room beside the bottom bar', () => {
  it('a four-tab bar on a 390 px phone leaves room for the floating tools', () => {
    expect(navLeavesRoomForTools(289, 390)).toBe(true);
  });

  it('a six-tab bar on the same phone does not', () => {
    expect(navLeavesRoomForTools(337, 390)).toBe(false);
  });

  it('flags crowding when left-side tabs/recorder or a side cutout leaves too little room', () => {
    expect(navLeavesRoomForTools(289, 390, 90)).toBe(true);
    expect(navLeavesRoomForTools(289, 390, 50)).toBe(false);
    expect(navLeavesRoomForTools(289, 390, 90, 44, 0)).toBe(false);
    expect(navLeavesRoomForTools(289, 390, 90, 0, 44)).toBe(false);
  });
});
