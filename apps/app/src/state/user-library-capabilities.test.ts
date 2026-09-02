import { describe, expect, it } from 'vitest';

import {
  userLibraryFileCapability,
  userLibraryFilePickerCapabilities,
} from '@/state/user-library-capabilities';

describe('user-library file capabilities', () => {
  it('keeps reader actions scoped to the file renderer', () => {
    const pdf = userLibraryFileCapability('application/pdf', 'scan.pdf');
    expect(pdf.reader.actions).toEqual(['print', 'fullscreen', 'two-page', 'zoom']);

    for (const [mimeType, fileName] of [
      ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'table.xlsx'],
      ['application/vnd.ms-excel.sheet.macroenabled.12', 'table.xlsm'],
      ['application/vnd.ms-excel', 'table.xls'],
      ['text/csv', 'table.csv'],
    ] as const) {
      const spreadsheet = userLibraryFileCapability(mimeType, fileName);
      expect(spreadsheet.reader.actions).toEqual(['print', 'fullscreen']);
      expect(spreadsheet.reader.printOrientation).toBe('landscape');
    }
  });

  it('treats legacy Office and Pages files as download-only', () => {
    for (const [mimeType, fileName] of [
      ['application/msword', 'legacy.doc'],
      ['application/vnd.ms-powerpoint', 'legacy.ppt'],
      ['application/vnd.apple.pages', 'legacy.pages'],
    ] as const) {
      const capability = userLibraryFileCapability(mimeType, fileName);
      expect(capability.reader.renderer).toBe('download');
      expect(capability.reader.actions).toEqual([]);
      expect(capability.reader.search).toBe('none');
    }
  });

  it('keeps spreadsheets in the picker while exposing one renderer contract', () => {
    const pickerExtensions = userLibraryFilePickerCapabilities().flatMap(
      (capability) => capability.extensions,
    );
    expect(pickerExtensions).toEqual(expect.arrayContaining(['xls', 'xlsx', 'xlsm', 'csv']));
    expect(userLibraryFileCapability('application/vnd.ms-excel', 'table.xls').reader.renderer).toBe(
      'sheet',
    );
    expect(userLibraryFileCapability('text/csv', 'table.csv').textExtraction).toBe('spreadsheet');
  });
});
