import { iconKeyFor } from '@/features/news/news-icons';

/**
 * Avatars of the suggested sources, bundled with the app so that looking at the suggestions sends
 * no request (ADR-0024). One 96 px PNG per site host (`avatars/<host>.png`), inlined as a data URL.
 * A suggested source without a file (its site refuses non-browser clients) gets the monogram.
 */
const FILES = import.meta.glob<string>('./avatars/*.png', {
  eager: true,
  query: '?inline',
  import: 'default',
});

const BY_HOST: ReadonlyMap<string, string> = new Map(
  Object.entries(FILES).map(([path, data]) => [
    path.replace(/^\.\/avatars\//u, '').replace(/\.png$/u, ''),
    data,
  ]),
);

/** The bundled avatar of the site at `url`, when there is one. */
export function bundledAvatarFor(url: string): string | undefined {
  return BY_HOST.get(iconKeyFor(url));
}

export function bundledAvatarHosts(): readonly string[] {
  return [...BY_HOST.keys()];
}
