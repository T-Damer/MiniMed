import { parsePrescriptionSettings } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import settingsJson from './data/prescription-settings.json';
import { PRESCRIPTION_SETTINGS } from './prescription-settings';

describe('the release settings of the prescription tool', () => {
  it('ship with computed doses OFF until an independent audit finds no wrong dose (RX5: 15 of 170)', () => {
    expect(settingsJson).toEqual({ computedDoses: false });
    expect(PRESCRIPTION_SETTINGS.computedDoses).toBe(false);
  });

  it('are validated at the boundary: a missing, extra or mistyped key is an error, never a silent «on»', () => {
    expect(parsePrescriptionSettings({ computedDoses: false })).toEqual({ computedDoses: false });
    expect(() => parsePrescriptionSettings({})).toThrow(/Prescription settings/u);
    expect(() => parsePrescriptionSettings({ computedDoses: 'no' })).toThrow();
    expect(() => parsePrescriptionSettings({ computedDoses: true, drugs: [] })).toThrow();
    expect(() => parsePrescriptionSettings(null)).toThrow();
  });
});
