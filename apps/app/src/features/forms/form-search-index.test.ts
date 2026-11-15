import { describe, expect, it } from 'vitest';

import { listFormSchemas } from '@/features/forms/form-registry';
import { FORM_SEARCH_INDEX } from '@/features/forms/form-search-index';

describe('FORM_SEARCH_INDEX', () => {
  it('lists every shipped form schema with its number and title, in the registry order', () => {
    expect(FORM_SEARCH_INDEX).toEqual(
      listFormSchemas().map(({ id, formNumber, title }) => ({ id, formNumber, title })),
    );
  });
});
