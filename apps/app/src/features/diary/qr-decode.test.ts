import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';

import { DiaryPartCollector, encodeDiaryResults } from '@/features/diary/diary-codec';
import { parseDiaryResults } from '@/features/diary/diary-model';
import { decodeQrPixels } from '@/features/diary/qr-decode';

function renderQr(text: string, scale = 4, margin = 4) {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const size = (modules.size + margin * 2) * scale;
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let row = 0; row < modules.size; row += 1) {
    for (let column = 0; column < modules.size; column += 1) {
      if (!modules.get(row, column)) continue;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const y = (row + margin) * scale + dy;
          const x = (column + margin) * scale + dx;
          pixels.fill(0, (y * size + x) * 4, (y * size + x) * 4 + 3);
        }
      }
    }
  }
  return { pixels, size };
}

describe('diary QR codes', () => {
  it('decodes every generated part back into the same diary', async () => {
    const now = Date.parse('2026-09-24T12:00:00Z');
    const results = parseDiaryResults(
      {
        v: 1,
        invitation: {
          v: 1,
          id: 'glucose001',
          kind: 'glucose',
          issuedAt: '2026-09-01T09:00:00Z',
        },
        entries: Array.from({ length: 40 }, (_, index) => ({
          id: `g${String(index).padStart(6, '0')}`,
          at: new Date(Date.parse('2026-09-02T07:00:00Z') + index * 9 * 3_600_000).toISOString(),
          mmol: 5 + (index % 7) / 2,
          context: index % 2 === 0 ? 'fasting' : 'after-meal',
        })),
      },
      now,
    );
    const collector = new DiaryPartCollector();
    for (const part of await encodeDiaryResults(results)) {
      const { pixels, size } = renderQr(part);
      const decoded = decodeQrPixels(pixels, size, size);
      expect(decoded).toBe(part);
      collector.add(decoded ?? '');
    }
    expect((await collector.results(now)).entries).toEqual(results.entries);
  });

  it('returns null for an image without a code', () => {
    expect(decodeQrPixels(new Uint8ClampedArray(64 * 64 * 4).fill(255), 64, 64)).toBeNull();
  });
});
