import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReferenceImageResolver, type ResolvedReferenceImage } from './reference-image-assets';

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return `sha256:${[...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
}

async function imageFixture(): Promise<{
  manifest: Uint8Array;
  image: Uint8Array;
  path: string;
  source: string;
  documentId: string;
}> {
  const image = new TextEncoder().encode('reference-image');
  const imageHash = (await sha256(image)).slice('sha256:'.length);
  const source = 'https://www.krasotaimedicina.ru/upload/iblock/a/a.jpg';
  const documentId = 'krasotaimedicina.disease.0123456789abcdef';
  const manifest = new TextEncoder().encode(
    JSON.stringify({
      schemaVersion: 1,
      sourceUrl: 'https://www.krasotaimedicina.ru',
      images: {
        [documentId]: [
          {
            alt: 'Иллюстрация',
            contentType: 'image/jpeg',
            path: `assets/${imageHash}.jpg`,
            sha256: await sha256(image),
            size: image.byteLength,
            sourceUrl: source,
          },
        ],
      },
    }),
  );
  return { manifest, image, path: `assets/${imageHash}.jpg`, source, documentId };
}

function fixtureResponse(bytes: Uint8Array, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => bytes.slice().buffer,
  } as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ReferenceImageResolver', () => {
  it('rejects corrupted image bytes and retries after a failed read', async () => {
    const fixture = await imageFixture();
    vi.stubGlobal('window', { location: { origin: 'http://localhost' } });
    let corrupt = true;
    const fetchValue = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/manifest.json?sha256=')) {
        return fixtureResponse(fixture.manifest);
      }
      return fixtureResponse(corrupt ? new Uint8Array([0]) : fixture.image);
    });
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:verified');
    const resolver = new ReferenceImageResolver({
      fetch: fetchValue,
      baseUrl: 'http://localhost/content/reference-images/',
      manifestSha256: await sha256(fixture.manifest),
    });
    await expect(resolver.resolveFirst(fixture.documentId)).rejects.toThrow('контрольной суммы');
    expect(createObjectURL).not.toHaveBeenCalled();
    corrupt = false;
    await expect(resolver.resolveFirst(fixture.documentId)).resolves.toMatchObject({
      url: 'blob:verified',
    });
    resolver.dispose();
  });

  it('resolves only a manifest member for its stable document and verifies bytes', async () => {
    const fixture = await imageFixture();
    vi.stubGlobal('window', {
      location: { origin: 'http://localhost' },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const fetchValue = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/manifest.json?sha256=')) return fixtureResponse(fixture.manifest);
      if (url.endsWith(`/${fixture.path}`)) return fixtureResponse(fixture.image);
      return fixtureResponse(new Uint8Array(), 404);
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:reference-1');
    const resolver = new ReferenceImageResolver({
      fetch: fetchValue,
      baseUrl: 'http://localhost/content/reference-images/',
      manifestSha256: await sha256(fixture.manifest),
    });
    const image = await resolver.resolve(fixture.documentId, fixture.source);

    expect(image).toEqual<ResolvedReferenceImage>({
      alt: 'Иллюстрация',
      contentType: 'image/jpeg',
      sourceUrl: fixture.source,
      url: 'blob:reference-1',
    });
    await expect(resolver.resolveFirst(fixture.documentId)).resolves.toBe(image);
    await expect(
      resolver.resolve('krasotaimedicina.disease.ffffffffffffffff', fixture.source),
    ).resolves.toBeNull();
    await expect(
      resolver.resolve(fixture.documentId, 'https://example.test/a.jpg'),
    ).resolves.toBeNull();
    expect(fetchValue).toHaveBeenCalledTimes(2);
    resolver.dispose();
  });

  it('clears cached blobs explicitly', async () => {
    const fixture = await imageFixture();
    const fetchValue = vi.fn(async (input: RequestInfo | URL) => {
      return String(input).includes('/manifest.json?sha256=')
        ? fixtureResponse(fixture.manifest)
        : fixtureResponse(fixture.image);
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:reference-1');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.stubGlobal('window', {
      location: { origin: 'http://localhost' },
    });
    const resolver = new ReferenceImageResolver({
      fetch: fetchValue,
      baseUrl: 'http://localhost/content/reference-images/',
      manifestSha256: await sha256(fixture.manifest),
    });
    await resolver.resolve(fixture.documentId, fixture.source);
    resolver.clear();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:reference-1');
    resolver.dispose();
  });
});
