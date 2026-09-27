import { describe, expect, it } from 'vitest';

import { opfsImportProgressTotal } from '../src/sqlite-medical-store';

describe('OPFS import progress total', () => {
  it('uses the declared length only when the streamed bytes are the same bytes', () => {
    expect(opfsImportProgressTotal(76_000_000, null, 1_000)).toBe(76_000_000);
    expect(opfsImportProgressTotal(76_000_000, 'identity', 1_000)).toBe(76_000_000);
    expect(opfsImportProgressTotal(null, null, 1_000)).toBe(0);
  });

  it('reports an unknown total when the server compresses in transit', () => {
    // «Скачано 252 МБ из 76 МБ»: the HEAD length counted gzip bytes, the stream inflated ones.
    expect(opfsImportProgressTotal(76_000_000, 'gzip', 1_000)).toBe(0);
    expect(opfsImportProgressTotal(76_000_000, null, 252_000_000)).toBe(0);
  });
});
