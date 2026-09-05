import { readdirSync, readFileSync } from 'node:fs';

import { ToolCatalogEntrySchema, ToolDefinitionRecordSchema } from '@localmed/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearDownloadedAssessments,
  getAssessmentCatalog,
  loadAssessmentDefinition,
  registerDownloadedAssessment,
  searchAssessments,
} from '@/features/assessments/assessment-catalog';
import {
  loadAssessmentInstallationState,
  setDatabaseAssessmentIds,
} from '@/features/assessments/assessment-packs';
import {
  loadCalculatorInstallationState,
  moduleIdsForCalculatorSection,
  setDatabaseCalculatorIds,
} from '@/features/calculators/calculator-packs';
import {
  clearDownloadedCalculators,
  getCalculatorRegistry,
  registerDownloadedCalculator,
  searchCalculators,
} from '@/features/calculators/calculator-registry';
import { getCalculatorSchema } from '@/features/calculators/calculator-schema-catalog';
import { MODULE_CATALOG, moduleForTool, TOOL_CATALOG } from '@/features/modules/module-catalog';

const modules = readdirSync('content/tool-modules')
  .filter((file) => file.endsWith('.json'))
  .map((file) => {
    const source = JSON.parse(readFileSync(`content/tool-modules/${file}`, 'utf8')) as {
      id: string;
      tools: unknown[];
    };
    return {
      id: source.id,
      tools: source.tools.map((tool) => ToolDefinitionRecordSchema.parse(tool)),
    };
  });

afterEach(() => {
  clearDownloadedCalculators();
  clearDownloadedAssessments();
  setDatabaseCalculatorIds([]);
  setDatabaseAssessmentIds([]);
  vi.unstubAllGlobals();
});

describe('core tool discovery', () => {
  it('indexes every authored tool and its exact download pack without executable definitions', () => {
    expect(TOOL_CATALOG).toHaveLength(69);
    for (const source of modules) {
      const catalog = MODULE_CATALOG.modules.find((entry) => entry.id === source.id);
      expect(catalog?.tools).toEqual(
        source.tools.map((record) =>
          ToolCatalogEntrySchema.parse({ ...record, preview: record.definition }),
        ),
      );
      for (const record of source.tools) expect(moduleForTool(record.id)?.id).toBe(source.id);
    }
    for (const entry of TOOL_CATALOG) {
      expect(entry).not.toHaveProperty('definition');
      expect(entry).not.toHaveProperty('questions');
      if (entry.kind === 'calculator') expect(entry.preview).not.toHaveProperty('steps');
    }
    expect(moduleIdsForCalculatorSection('pediatrics')).toContain('minimed.tools.pediatrics.ru');
    expect(moduleIdsForCalculatorSection('anthropometry')).toContain(
      'minimed.tools.pediatrics-growth.ru',
    );
  });

  it('shows and searches all tools on a fresh offline installation without marking them ready', async () => {
    clearDownloadedCalculators();
    clearDownloadedAssessments();
    expect(getCalculatorRegistry()).toHaveLength(52);
    expect(getAssessmentCatalog()).toHaveLength(19);
    expect(searchCalculators('Шварца')).not.toHaveLength(0);
    expect(searchAssessments('FLACC')).not.toHaveLength(0);
    const calculatorState = loadCalculatorInstallationState(getCalculatorRegistry());
    const assessmentState = loadAssessmentInstallationState(getAssessmentCatalog());
    expect(calculatorState.installedIds).toEqual(new Set(['unit-conversion', 'ecg-photo-caliper']));
    expect(assessmentState.installedIds.size).toBe(0);
    for (const entry of TOOL_CATALOG) {
      if (entry.kind === 'calculator') expect(getCalculatorSchema(entry.id)).toBeUndefined();
    }
    await expect(loadAssessmentDefinition('flacc-pain-scale')).rejects.toThrow('unavailable');
  });

  it('requires the actual payload even with saved install flags, then unlocks every tool in its pack', () => {
    const source = modules.find((module) => module.id === 'minimed.tools.pediatrics.ru');
    if (!source) throw new Error('Missing pediatrics fixture.');
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
      localStorage: {
        getItem: () =>
          JSON.stringify({
            schemaVersion: 2,
            sectionIds: ['pediatrics', 'pediatric-pain'],
            calculatorIds: source.tools.map((entry) => entry.id),
            manualIds: source.tools.map((entry) => entry.id),
            excludedIds: [],
            moduleDependencies: {},
          }),
      },
    });
    for (const entry of source.tools) {
      expect(
        loadCalculatorInstallationState(getCalculatorRegistry()).installedIds.has(entry.id),
      ).toBe(false);
      expect(
        loadAssessmentInstallationState(getAssessmentCatalog()).installedIds.has(entry.id),
      ).toBe(false);
      registerDownloadedCalculator(entry);
      registerDownloadedAssessment(entry);
    }
    setDatabaseCalculatorIds(
      source.tools.filter((entry) => entry.kind === 'calculator').map((entry) => entry.id),
    );
    setDatabaseAssessmentIds(
      source.tools.filter((entry) => entry.kind === 'assessment').map((entry) => entry.id),
    );
    for (const entry of source.tools) {
      const installed =
        entry.kind === 'calculator'
          ? loadCalculatorInstallationState(getCalculatorRegistry())
          : loadAssessmentInstallationState(getAssessmentCatalog());
      expect(installed.installedIds.has(entry.id)).toBe(true);
    }
    clearDownloadedCalculators();
    clearDownloadedAssessments();
    expect(getCalculatorRegistry()).toHaveLength(52);
    expect(getAssessmentCatalog()).toHaveLength(19);
  });
});
