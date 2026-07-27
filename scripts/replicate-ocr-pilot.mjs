#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, extname, relative, resolve, sep } from 'node:path';
import Replicate from 'replicate';

const MODEL = 'datalab-to/marker';
const DEFAULT_SOURCE_ROOT = 'data/raw';
const OUTPUT_ROOT = 'data/intermediate/replicate-ocr';
const SUPPORTED_EXTENSIONS = new Set(['.docx', '.pdf']);

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function isInsideRoot(root, candidate) {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..');
}

async function resolveInput(input, sourceRoot) {
  const resolvedRoot = await realpath(resolve(sourceRoot));
  const resolvedInput = await realpath(resolve(input));
  if (!isInsideRoot(resolvedRoot, resolvedInput)) {
    throw new Error('Input path escapes the configured private source root.');
  }
  if (!SUPPORTED_EXTENSIONS.has(extname(resolvedInput).toLocaleLowerCase('en-US'))) {
    throw new Error('The OCR pilot accepts only PDF and DOCX files.');
  }
  if (!(await stat(resolvedInput)).isFile()) throw new Error('OCR input must be a file.');
  return { resolvedInput, resolvedRoot };
}

function outputPathFor(input) {
  const extension = extname(input);
  return resolve(OUTPUT_ROOT, `${basename(input, extension)}.ocr-draft.json`);
}

async function selfTest() {
  const root = resolve('/tmp/localmed-private');
  assert.equal(isInsideRoot(root, resolve(root, 'source.pdf')), true);
  assert.equal(isInsideRoot(root, resolve(root, 'nested/source.docx')), true);
  assert.equal(isInsideRoot(root, resolve(root, '../source.pdf')), false);
  console.log('replicate-ocr-pilot self-test passed');
}

async function main() {
  if (process.argv.includes('--self-test')) return selfTest();

  const input = argumentValue('--input');
  if (!input) throw new Error('Usage: --input <file.pdf|file.docx> [--source-root <directory>].');
  const { resolvedInput, resolvedRoot } = await resolveInput(
    input,
    argumentValue('--source-root') ?? DEFAULT_SOURCE_ROOT,
  );
  const outputPath = outputPathFor(resolvedInput);
  const source = await readFile(resolvedInput);
  const plan = {
    model: MODEL,
    source: relative(resolvedRoot, resolvedInput),
    output: relative(process.cwd(), outputPath),
    forceOcr: true,
    useLlm: process.argv.includes('--use-llm'),
  };
  if (process.argv.includes('--dry-run')) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  if (!process.argv.includes('--force')) {
    try {
      await stat(outputPath);
      throw new Error('OCR draft already exists. Pass --force to replace this draft.');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        // Expected: the draft is new.
      } else {
        throw error;
      }
    }
  }

  const token = process.env.REPLICATE_API_TOKEN ?? process.env.REPLICATE_API;
  if (!token) throw new Error('REPLICATE_API_TOKEN or REPLICATE_API is required.');
  const mediaType =
    extname(resolvedInput).toLocaleLowerCase('en-US') === '.pdf'
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const replicate = new Replicate({ auth: token });
  const output = await replicate.run(MODEL, {
    input: {
      file: new File([source], basename(resolvedInput), { type: mediaType }),
      force_ocr: true,
      use_llm: plan.useLlm,
    },
  });
  const marker = output;
  if (
    !marker ||
    typeof marker !== 'object' ||
    !('markdown' in marker) ||
    typeof marker.markdown !== 'string'
  ) {
    throw new Error('Replicate Marker returned no Markdown.');
  }

  const report = {
    schemaVersion: 1,
    status: 'draft-review-required',
    generatedAt: new Date().toISOString(),
    model: MODEL,
    source: {
      path: plan.source,
      sha256: createHash('sha256').update(source).digest('hex'),
      sizeBytes: source.byteLength,
    },
    pageCount:
      'page_count' in marker && typeof marker.page_count === 'number' ? marker.page_count : null,
    markdown: marker.markdown,
  };
  await mkdir(resolve(OUTPUT_ROOT), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Review-required OCR draft written to ${plan.output}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
