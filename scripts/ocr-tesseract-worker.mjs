#!/usr/bin/env node
// A persistent Tesseract worker for the OCR1 second opinion (tools/ingest/scripts/grls_ocr_second_opinion.py).
//
//   node scripts/ocr-tesseract-worker.mjs <tessdata dir>
//
// Reads lines `<page image>\t<output json>` from stdin, recognises each image with `rus`+`eng`, page
// segmentation 3, writes the JSON (text, confidence, lines with their boxes in pixels) and answers
// `done\t<page image>` (or `error\t<page image>\t<message>`) on stdout. The language data is the pack the
// app downloads for the user's own files (`apps/app/public/tessdata/{rus,eng}.traineddata.gz`).
import { createWorker } from 'tesseract.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';

const langPath = process.argv[2];
if (!langPath) {
  console.error('usage: ocr-tesseract-worker.mjs <tessdata dir>');
  process.exit(2);
}
const worker = await createWorker(['rus', 'eng'], 1, { langPath, gzip: true, cacheMethod: 'none' });
await worker.setParameters({ tessedit_pageseg_mode: '3', preserve_interword_spaces: '1' });

const lines = createInterface({ input: process.stdin });
for await (const request of lines) {
  const [image, output] = request.split('\t');
  if (!image || !output) continue;
  try {
    const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
    const recognised = [];
    for (const block of data.blocks ?? [])
      for (const paragraph of block.paragraphs ?? [])
        for (const line of paragraph.lines ?? [])
          recognised.push({
            text: line.text.replace(/\n$/, ''),
            confidence: line.confidence,
            bbox: line.bbox,
          });
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, JSON.stringify({ confidence: data.confidence, lines: recognised }));
    process.stdout.write(`done\t${image}\n`);
  } catch (error) {
    process.stdout.write(`error\t${image}\t${String(error?.message ?? error).replace(/\s+/g, ' ')}\n`);
  }
}
await worker.terminate();
