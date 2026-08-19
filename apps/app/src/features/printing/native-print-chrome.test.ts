import { describe, expect, it } from 'vitest';

import {
  NATIVE_PRINT_CRUMBS_CLASS,
  NATIVE_PRINT_HEADER_CLASS,
  NATIVE_PRINT_ICON_BUTTON_CLASS,
  NATIVE_PRINT_SHARE_BUTTON_CLASS,
  NATIVE_PRINT_TITLE_CLASS,
} from '@/features/printing/native-print-chrome';

describe('native print header chrome', () => {
  it('reuses the document circle-button header classes', () => {
    expect(NATIVE_PRINT_HEADER_CLASS).toContain('document-page__chrome');
    expect(NATIVE_PRINT_ICON_BUTTON_CLASS).toContain('ui-button--icon');
    expect(NATIVE_PRINT_ICON_BUTTON_CLASS).toContain('document-page__back');
    expect(NATIVE_PRINT_SHARE_BUTTON_CLASS).toContain('ui-button--icon');
    expect(NATIVE_PRINT_SHARE_BUTTON_CLASS).toContain('native-print-preview__share');
    expect(NATIVE_PRINT_CRUMBS_CLASS).toContain('document-crumbs');
    expect(NATIVE_PRINT_TITLE_CLASS).toContain('document-crumbs__current');
  });
});
