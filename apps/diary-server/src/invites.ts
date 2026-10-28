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

/**
 * The forms a typed code may be stored under: as typed (codes issued before 2026-10-27 were
 * mixed-case) and normalised to the grouped capitals of `newInviteCode`.
 */
export function inviteCandidates(typed: string): readonly string[] {
  const exact = typed.trim();
  const letters = exact.toUpperCase().replaceAll(/[^A-Z0-9]/gu, '');
  const grouped = letters.replaceAll(/(.{4})(?=.)/gu, '$1-');
  return [...new Set([exact, grouped])];
}
