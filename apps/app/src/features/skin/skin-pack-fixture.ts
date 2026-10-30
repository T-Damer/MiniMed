/**
 * Test support: builds a small skin pack ZIP in the layout tools/derm-cnn/build_skin_pack.py writes.
 * Used by the unit tests and the browser spec; the app itself never imports it.
 */
import JSZip from 'jszip';

/** A real 64 × 48 AVIF (335 bytes), so a browser can decode the fixture photos. */
export const FIXTURE_AVIF_BASE64 =
  'AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADrbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAAAAAAAOcGl0bQAAAAAAAQAAAB5pbG9jAAAAAEQAAAEAAQAAAAEAAAETAAAAPAAAAChpaW5mAAAAAAABAAAAGmluZmUCAAAAAAEAAGF2MDFDb2xvcgAAAABqaXBycAAAAEtpcGNvAAAAFGlzcGUAAAAAAAAAQAAAADAAAAAQcGl4aQAAAAADCAgIAAAADGF2MUOBAAwAAAAAE2NvbHJuY2x4AAEADQAGgAAAABdpcG1hAAAAAAAAAAEAAQQBAoMEAAAARG1kYXQSAAoJGBV/vaICGg0IMi0cR4eF3dNNNMLFFQDPyip6YKTIPihe+yvy8SHpZE//xeWZFRrqM4ozaC1X1eg=';

export interface FixturePhoto {
  readonly class: string;
  readonly file: string;
  readonly width: number;
  readonly height: number;
  readonly source: string;
  readonly author: string;
  readonly licence: string;
  readonly url: string;
}

export interface FixturePackOptions {
  /** The app's class ids in order: the model manifest lists them. */
  readonly classIds: readonly string[];
  /** Conditions that get photos; each gets `perClass` photos. */
  readonly photoClasses?: readonly string[];
  readonly perClass?: number;
  /** Overrides for negative tests. */
  readonly info?: Record<string, unknown>;
  readonly manifest?: Record<string, unknown>;
  readonly photos?: readonly FixturePhoto[];
  readonly photoBytes?: Uint8Array;
  /** Extra or replaced entries by path; null leaves an entry out. */
  readonly entries?: Readonly<Record<string, Uint8Array | string | null>>;
  readonly version?: string;
}

function hexId(index: number): string {
  return index.toString(16).padStart(12, '0');
}

export function fixturePhotos(
  photoClasses: readonly string[],
  perClass: number,
): readonly FixturePhoto[] {
  const photos: FixturePhoto[] = [];
  for (const className of photoClasses) {
    for (let index = 0; index < perClass; index += 1) {
      photos.push({
        class: className,
        file: `photos/${hexId(photos.length + 1)}.avif`,
        width: 64,
        height: 48,
        source: index === 0 ? 'SCIN (Google)' : 'Wikimedia Commons',
        author: index === 0 ? '' : 'Test Author',
        licence: index === 0 ? 'SCIN Data Use License' : 'CC BY-SA 4.0',
        url: 'https://example.test/photo',
      });
    }
  }
  return photos;
}

export async function buildSkinPackZip(options: FixturePackOptions): Promise<Uint8Array> {
  const photos = options.photos ?? fixturePhotos(options.photoClasses ?? [], options.perClass ?? 3);
  const avif = options.photoBytes ?? Uint8Array.from(Buffer.from(FIXTURE_AVIF_BASE64, 'base64'));
  const zip = new JSZip();
  const add = (path: string, content: Uint8Array | string | null | undefined): void => {
    if (content === null || content === undefined) return;
    zip.file(path, content);
  };
  const manifest = {
    format: 'minimed-skin-cnn',
    version: 2,
    models: [{ file: 'model.onnx', inputSide: 224, details: true }],
    classes: options.classIds,
    malignantThreshold: 0.2,
    ...options.manifest,
  };
  const entries = options.entries ?? {};
  const pick = (path: string, fallback: Uint8Array | string): Uint8Array | string | null =>
    path in entries ? (entries[path] ?? null) : fallback;
  add(
    'skin-pack.json',
    pick(
      'skin-pack.json',
      JSON.stringify({
        format: 'minimed-skin-pack',
        formatVersion: 1,
        version: options.version ?? '2026.10.30',
        name: 'Кожа по фото',
        model: 'skin-model.json',
        photos: 'photos.json',
        ...options.info,
      }),
    ),
  );
  add('skin-model.json', pick('skin-model.json', JSON.stringify(manifest)));
  add('model.onnx', pick('model.onnx', new Uint8Array([8, 1, 18, 4, 116, 101, 115, 116])));
  add('photos.json', pick('photos.json', JSON.stringify({ photos })));
  for (const photo of photos) add(photo.file, pick(photo.file, avif));
  for (const [path, content] of Object.entries(entries)) {
    if (!zip.file(path) && content !== null) add(path, content);
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
}
