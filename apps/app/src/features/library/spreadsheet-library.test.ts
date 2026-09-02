import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { Workbook } from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';

import { preserveXlsmVba } from './spreadsheet-xlsm';

describe('spreadsheet library', () => {
  it('round-trips the styling and layout required by the reader', async () => {
    const source = new Workbook();
    const sheet = source.addWorksheet('Расписание');
    sheet.getColumn(1).width = 20;
    sheet.getRow(1).height = 24;
    sheet.mergeCells('A1:B2');
    const cell = sheet.getCell('A1');
    cell.value = 'Заголовок';
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC000' } };
    cell.font = { bold: true, color: { argb: 'FF000000' } };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF000000' } },
      right: { style: 'thin', color: { argb: 'FF000000' } },
      bottom: { style: 'thin', color: { argb: 'FF000000' } },
      left: { style: 'thin', color: { argb: 'FF000000' } },
    };

    const saved = await source.xlsx.writeBuffer({ useStyles: true });
    const reopened = new Workbook();
    await reopened.xlsx.load(saved);
    const restoredSheet = reopened.getWorksheet('Расписание');
    const restoredCell = restoredSheet?.getCell('A1');

    expect(restoredSheet?.model.merges).toEqual(['A1:B2']);
    expect(restoredSheet?.getColumn(1).width).toBe(20);
    expect(restoredSheet?.getRow(1).height).toBe(24);
    expect(restoredCell?.value).toBe('Заголовок');
    expect(restoredCell?.fill).toMatchObject({
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFC000' },
    });
    expect(restoredCell?.font).toMatchObject({ bold: true, color: { argb: 'FF000000' } });
    expect(restoredCell?.border).toMatchObject({
      top: { style: 'thin' },
      right: { style: 'thin' },
      bottom: { style: 'thin' },
      left: { style: 'thin' },
    });
  });

  it('keeps XLSM macros when edited cells are saved', async () => {
    vi.stubGlobal('DOMParser', DOMParser);
    vi.stubGlobal('XMLSerializer', XMLSerializer);
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Данные');
    sheet.getCell('A1').value = 'До';
    const sourceZip = await JSZip.loadAsync(await workbook.xlsx.writeBuffer());
    const contentTypes = await sourceZip.file('[Content_Types].xml')?.async('text');
    const relationships = await sourceZip.file('xl/_rels/workbook.xml.rels')?.async('text');
    if (!contentTypes || !relationships) throw new Error('Invalid XLSX fixture.');
    sourceZip.file(
      '[Content_Types].xml',
      contentTypes
        .replace(
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
          'application/vnd.ms-excel.sheet.macroEnabled.main+xml',
        )
        .replace(
          '</Types>',
          '<Override PartName="/xl/vbaProject.bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>',
        ),
    );
    sourceZip.file(
      'xl/_rels/workbook.xml.rels',
      relationships.replace(
        '</Relationships>',
        '<Relationship Id="rId99" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/></Relationships>',
      ),
    );
    sourceZip.file('xl/vbaProject.bin', new Uint8Array([1, 2, 3, 4]));
    const original = await sourceZip.generateAsync({ type: 'arraybuffer' });

    sheet.getCell('A1').value = 'После';
    const edited = new Uint8Array(await workbook.xlsx.writeBuffer()).buffer;
    const saved = await preserveXlsmVba(original, edited);
    const savedZip = await JSZip.loadAsync(saved);
    const savedVba = savedZip.file('xl/vbaProject.bin');
    if (!savedVba) throw new Error('VBA payload was removed.');

    expect(Array.from(await savedVba.async('uint8array'))).toEqual([1, 2, 3, 4]);
    expect(await savedZip.file('[Content_Types].xml')?.async('text')).toContain(
      'application/vnd.ms-excel.sheet.macroEnabled.main+xml',
    );
    expect(await savedZip.file('xl/_rels/workbook.xml.rels')?.async('text')).toContain(
      'vbaProject',
    );
    vi.unstubAllGlobals();
  });
});
