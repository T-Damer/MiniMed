/**
 * Object URLs for stored blobs, one per key: a list that reloads its rows (every history change)
 * keeps showing the picture it already decoded, and every URL is revoked when the owner goes.
 */
export interface ObjectUrlCache {
  get(key: string, blob: Blob): string;
  revoke(key: string): void;
  revokeAll(): void;
}

export function createObjectUrlCache(
  create: (blob: Blob) => string = (blob) => URL.createObjectURL(blob),
  release: (url: string) => void = (url) => URL.revokeObjectURL(url),
): ObjectUrlCache {
  const urls = new Map<string, string>();
  return {
    get: (key, blob) => {
      const known = urls.get(key);
      if (known) return known;
      const url = create(blob);
      urls.set(key, url);
      return url;
    },
    revoke: (key) => {
      const url = urls.get(key);
      if (url === undefined) return;
      release(url);
      urls.delete(key);
    },
    revokeAll: () => {
      for (const url of urls.values()) release(url);
      urls.clear();
    },
  };
}
