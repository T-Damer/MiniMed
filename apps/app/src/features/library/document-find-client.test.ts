import { describe, expect, it } from 'vitest';

import { DocumentFindClient } from '@/features/library/document-find-client';

describe('DocumentFindClient', () => {
  it('returns no matches for an empty query without searching', async () => {
    const client = new DocumentFindClient({ allowWorker: false });
    client.setUnits([{ id: 'chunk-1', text: 'Пневмония у детей требует наблюдения.' }]);
    await expect(client.find('', 'exact')).resolves.toEqual([]);
    client.dispose();
  });
});
