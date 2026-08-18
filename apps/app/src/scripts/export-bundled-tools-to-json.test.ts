import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ToolDefinitionRecordSchema } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

const MODULE_FILES = [
  'content/tool-modules/core-clinical.json',
  'content/tool-modules/obstetrics-gynecology.json',
  'content/tool-modules/psychology.json',
] as const;

describe('exported tool modules', () => {
  it('contains expected tool counts and unique source ids', () => {
    for (const relativePath of MODULE_FILES) {
      const source = JSON.parse(readFileSync(resolve(process.cwd(), relativePath), 'utf8')) as {
        tools: readonly unknown[];
      };
      const records = source.tools.map((tool) => ToolDefinitionRecordSchema.parse(tool));
      const sourceIds = records.flatMap((record) => record.sources.map((link) => link.id));
      expect(new Set(sourceIds).size).toBe(sourceIds.length);
    }

    const core = JSON.parse(
      readFileSync(resolve(process.cwd(), 'content/tool-modules/core-clinical.json'), 'utf8'),
    ) as { version: string; tools: readonly { id: string }[] };
    expect(core.version).toBe('0.1.0-preview.2');
    expect(core.tools.some((tool) => tool.id === 'body-surface-area-mosteller')).toBe(true);
    expect(core.tools.length).toBe(22);
  });
});
