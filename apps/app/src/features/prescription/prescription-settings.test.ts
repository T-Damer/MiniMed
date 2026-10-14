import { parsePrescriptionSettings } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import settingsJson from './data/prescription-settings.json';
import { PRESCRIPTION_SETTINGS } from './prescription-settings';

describe('the release settings of the prescription tool', () => {
  it('ship with computed doses ON (a release that turns numbers off changes the JSON and this line)', () => {
    expect(settingsJson).toEqual({ computedDoses: true });
    expect(PRESCRIPTION_SETTINGS.computedDoses).toBe(true);
  });

  it('are validated at the boundary: a missing, extra or mistyped key is an error, never a silent «on»', () => {
    expect(parsePrescriptionSettings({ computedDoses: false })).toEqual({ computedDoses: false });
    expect(() => parsePrescriptionSettings({})).toThrow(/Prescription settings/u);
    expect(() => parsePrescriptionSettings({ computedDoses: 'no' })).toThrow();
    expect(() => parsePrescriptionSettings({ computedDoses: true, drugs: [] })).toThrow();
    expect(() => parsePrescriptionSettings(null)).toThrow();
  });
});
