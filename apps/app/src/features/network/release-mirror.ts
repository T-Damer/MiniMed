import { Capacitor } from '@capacitor/core';

/**
 * GitHub release asset hosts send no CORS headers, and the app downloads content through WebView
 * fetch on every platform. Assets are therefore read from the Pages mirror of
 * `content/releases/<tag>/<file>`: same-origin on the web (and from the Vite release cache in DEV),
 * absolute on native builds whose own origin is the local bundle.
 */
export const RELEASE_ASSET_MIRROR = 'https://t-damer.github.io/MiniMed/app/content/releases';

export function releaseAssetMirrorUrl(
  tag: string,
  fileName: string,
  options: { readonly native?: boolean; readonly baseUrl?: string; readonly sha256?: string } = {},
): string {
  const relativePath = `${encodeURIComponent(tag)}/${encodeURIComponent(fileName)}`;
  if (options.native ?? Capacitor.isNativePlatform())
    return `${RELEASE_ASSET_MIRROR}/${relativePath}`;
  const url = new URL(
    `./content/releases/${relativePath}`,
    new URL(options.baseUrl ?? import.meta.env.BASE_URL, window.location.href),
  );
  if (options.sha256) url.searchParams.set('sha256', options.sha256);
  return url.toString();
}
