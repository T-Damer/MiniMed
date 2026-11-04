/** The diaries' own addresses, and the bare page, which opens them (app/mount-diaries.tsx). */
export function diariesAddress(hash: string): boolean {
  return hash === '' || hash === '#' || hash === '#/' || hash.startsWith('#/notes/diaries');
}
