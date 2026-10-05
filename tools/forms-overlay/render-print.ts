/**
 * Renders the empty print layout of every committed form schema to a PDF (Chromium), the first
 * half of the layout-fidelity check (docs/FORMS_PLAN.md «Layout fidelity»). The PDF is the page
 * the print manager hands to the printer, at the paper size the schema declares; the second half
 * (`localmed_ingest.medical_form_overlay`) compares it with the official scan.
 *
 *   CHROMIUM_PATH=... bun tools/forms-overlay/render-print.ts [--out output/f3-screens/print]
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { chromium } from '@playwright/test';
import { renderFormPrintHtml } from '../../apps/app/src/features/forms/form-print';
import { parseFormSchema } from '../../packages/contracts/src/form-schema';

const root = resolve(import.meta.dirname, '../..');
const schemaDirectory = resolve(root, 'apps/app/src/features/forms/schemas');
const outFlag = process.argv.indexOf('--out');
const outputDirectory = resolve(
  root,
  outFlag > 0 ? (process.argv[outFlag + 1] ?? '') : 'output/f3-screens/print',
);
const only = process.argv.filter((argument, index, all) => all[index - 1] === '--form');

mkdirSync(outputDirectory, { recursive: true });
const executablePath = process.env['CHROMIUM_PATH'];
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ['--mute-audio'],
});
try {
  const page = await browser.newPage();
  for (const file of readdirSync(schemaDirectory)
    .filter((name) => name.endsWith('.json'))
    .sort()) {
    // a selected form is read by its file name (the id with dots turned into dashes), so a schema
    // another author is still building cannot stop the print of this one
    if (only.length > 0 && !only.some((id) => file === `${id.replaceAll('.', '-')}.json`)) continue;
    const schema = parseFormSchema(
      JSON.parse(readFileSync(resolve(schemaDirectory, file), 'utf8')),
    );
    if (only.length > 0 && !only.includes(schema.id)) continue;
    await page.setContent(renderFormPrintHtml(schema, {}), { waitUntil: 'load' });
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    writeFileSync(resolve(outputDirectory, `${schema.id}.pdf`), pdf);
    console.log(`${schema.id}: ${pdf.length} bytes`);
  }
} finally {
  await browser.close();
}
