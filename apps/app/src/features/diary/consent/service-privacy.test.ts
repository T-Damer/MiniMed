import { describe, expect, it } from 'vitest';

import {
  privacyAcceptanceNeeded,
  SERVICE_PRIVACY,
  SERVICE_PRIVACY_CONTACT,
  SERVICE_PRIVACY_VERSION,
} from '@/features/diary/consent/service-privacy';

describe('the service privacy policy', () => {
  it('carries a version, a short summary and the one public contact, no other address', () => {
    expect(SERVICE_PRIVACY.version).toBe(SERVICE_PRIVACY_VERSION);
    expect(SERVICE_PRIVACY.summary.length).toBeGreaterThan(0);
    const addresses = JSON.stringify(SERVICE_PRIVACY).match(/[\w.+-]+@[\w-]+\.[A-Za-z]+/gu) ?? [];
    expect(new Set(addresses)).toEqual(new Set([SERVICE_PRIVACY_CONTACT]));
  });
});

describe('privacyAcceptanceNeeded', () => {
  it('asks a doctor who accepted nothing, or another wording', () => {
    expect(privacyAcceptanceNeeded(null)).toBe(true);
    expect(privacyAcceptanceNeeded({ version: 'service-privacy-2020-01-01' })).toBe(true);
  });

  it('does not ask for the current wording, nor while the answer is unknown', () => {
    expect(privacyAcceptanceNeeded({ version: SERVICE_PRIVACY_VERSION })).toBe(false);
    expect(privacyAcceptanceNeeded(undefined)).toBe(false);
  });
});
