/**
 * Doctors' sign-up codes: easy to read out and type — capitals and digits without look-alikes
 * (no 0/O, 1/I/L), grouped `K7MP-2QXR-9HTN`, accepted in any case and with any separators.
 */
import { randomBytes } from '@localmed/diary-sync';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function newInviteCode(): string {
  const characters = [...randomBytes(12)].map((byte) => ALPHABET[byte % ALPHABET.length]);
  return characters.join('').replaceAll(/(.{4})(?=.)/gu, '$1-');
}
