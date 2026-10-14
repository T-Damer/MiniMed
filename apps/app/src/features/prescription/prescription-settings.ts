/**
 * The release settings of the prescription tool (RX4): read once from
 * `data/prescription-settings.json`, validated at the boundary. `computedDoses: false` turns every
 * computed number off at once (single and daily dose, units, caps, quantity); the quoted sentences, the
 * forms, the blank and the recipe text stay. Nothing here knows a drug.
 */
import { type PrescriptionSettings, parsePrescriptionSettings } from '@localmed/contracts';

import settingsJson from './data/prescription-settings.json';

export type { PrescriptionSettings };

export const PRESCRIPTION_SETTINGS: PrescriptionSettings = parsePrescriptionSettings(settingsJson);
