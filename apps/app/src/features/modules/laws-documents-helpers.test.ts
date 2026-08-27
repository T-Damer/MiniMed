import { describe, expect, it, vi } from 'vitest';

import { openCatalogDocument } from '@/features/modules/laws-documents-helpers';

describe('openCatalogDocument', () => {
  it('opens an installed document or opens it after a successful install', async () => {
    const install = vi.fn(async () => true);
    const open = vi.fn();

    await expect(openCatalogDocument({ installed: true, install, open })).resolves.toBe(true);
    expect(install).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledOnce();

    open.mockClear();
    await expect(openCatalogDocument({ installed: false, install, open })).resolves.toBe(true);
    expect(install).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledOnce();
  });

  it('does not open a document after a failed install', async () => {
    const open = vi.fn();

    await expect(
      openCatalogDocument({ installed: false, install: async () => false, open }),
    ).resolves.toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});
