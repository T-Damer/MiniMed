import JSZip from 'jszip';

function importXmlNode(target: XMLDocument, source: Element): Element {
  return target.importNode(source, true) as Element;
}

export async function preserveXlsmVba(
  original: ArrayBuffer,
  edited: ArrayBuffer,
): Promise<ArrayBuffer> {
  const [sourceZip, targetZip] = await Promise.all([
    JSZip.loadAsync(original),
    JSZip.loadAsync(edited),
  ]);
  const vba = sourceZip.file('xl/vbaProject.bin');
  if (vba) targetZip.file('xl/vbaProject.bin', await vba.async('uint8array'));

  const parser = new DOMParser();
  const serializer = new XMLSerializer();
  const sourceTypesText = await sourceZip.file('[Content_Types].xml')?.async('text');
  const targetTypesText = await targetZip.file('[Content_Types].xml')?.async('text');
  if (sourceTypesText && targetTypesText) {
    const sourceTypes = parser.parseFromString(sourceTypesText, 'application/xml');
    const targetTypes = parser.parseFromString(targetTypesText, 'application/xml');
    const sourceOverrides = Array.from(sourceTypes.getElementsByTagNameNS('*', 'Override'));
    const targetOverrides = Array.from(targetTypes.getElementsByTagNameNS('*', 'Override'));
    const sourceWorkbook = sourceOverrides.find(
      (entry) => entry.getAttribute('PartName') === '/xl/workbook.xml',
    );
    const targetWorkbook = targetOverrides.find(
      (entry) => entry.getAttribute('PartName') === '/xl/workbook.xml',
    );
    if (sourceWorkbook && targetWorkbook)
      targetWorkbook.setAttribute(
        'ContentType',
        sourceWorkbook.getAttribute('ContentType') ??
          'application/vnd.ms-excel.sheet.macroEnabled.main+xml',
      );
    const sourceVba = sourceOverrides.find(
      (entry) => entry.getAttribute('PartName') === '/xl/vbaProject.bin',
    );
    if (
      sourceVba &&
      !targetOverrides.some((entry) => entry.getAttribute('PartName') === '/xl/vbaProject.bin')
    )
      targetTypes.documentElement.appendChild(importXmlNode(targetTypes, sourceVba));
    targetZip.file('[Content_Types].xml', serializer.serializeToString(targetTypes));
  }

  const relationshipsPath = 'xl/_rels/workbook.xml.rels';
  const sourceRelationshipsText = vba
    ? await sourceZip.file(relationshipsPath)?.async('text')
    : undefined;
  const targetRelationshipsText = vba
    ? await targetZip.file(relationshipsPath)?.async('text')
    : undefined;
  if (vba && sourceRelationshipsText && targetRelationshipsText) {
    const sourceRelationships = parser.parseFromString(sourceRelationshipsText, 'application/xml');
    const targetRelationships = parser.parseFromString(targetRelationshipsText, 'application/xml');
    const sourceVba = Array.from(
      sourceRelationships.getElementsByTagNameNS('*', 'Relationship'),
    ).find((entry) => entry.getAttribute('Type')?.endsWith('/vbaProject'));
    const targetEntries = Array.from(
      targetRelationships.getElementsByTagNameNS('*', 'Relationship'),
    );
    if (
      sourceVba &&
      !targetEntries.some((entry) => entry.getAttribute('Type')?.endsWith('/vbaProject'))
    ) {
      const copy = importXmlNode(targetRelationships, sourceVba);
      const usedIds = new Set(targetEntries.map((entry) => entry.getAttribute('Id')));
      let nextId = 1;
      while (usedIds.has(`rId${String(nextId)}`)) nextId += 1;
      copy.setAttribute('Id', `rId${String(nextId)}`);
      targetRelationships.documentElement.appendChild(copy);
    }
    targetZip.file(relationshipsPath, serializer.serializeToString(targetRelationships));
  }

  return await targetZip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}
