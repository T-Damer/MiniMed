import { describe, expect, it } from 'vitest';

import { formatDownloadSize, moduleDownloadPlan } from '@/features/onboarding/onboarding-downloads';
import { FIXTURE_CATALOG, FIXTURE_MANIFEST } from './section-fixtures';
import { buildSections, selectedModules } from './section-model';
import {
  pendingSizeLabel,
  sectionStatus,
  sectionSummary,
  selectionTotalLabel,
} from './section-plan';

const MIB = 1024 * 1024;
const sections = buildSections(
  FIXTURE_CATALOG,
  FIXTURE_MANIFEST,
  (module) => module.releaseState === 'published',
);
const psychiatry = sections.find((section) => section.id.includes('psychiatry'));
const cardiology = sections.find((section) => section.id.includes('cardiology'));
const none = new Set<string>();
if (!psychiatry || !cardiology) throw new Error('fixture sections missing');

describe('sectionStatus', () => {
  it('sums every package of a fresh section', () => {
    const status = sectionStatus(psychiatry, none, () => false, []);
    // 10 + 20 recommendations, 8 registry + 30 instructions.
    expect(status.plan.bytes).toBe(68 * MIB);
    expect(status.install).toBe('none');
    expect(status.queue).toBeNull();
  });

  it('does not count what is installed again', () => {
    const installed = new Set(['kr.1', 'minimed.medications.nervous-system.ru']);
    const status = sectionStatus(psychiatry, none, (module) => installed.has(module.id), []);
    expect(status.install).toBe('partial');
    expect(status.plan.pending.map((module) => module.id)).toEqual([
      'kr.2',
      'minimed.medications.instructions.nervous-system.ru',
    ]);
    expect(status.plan.bytes).toBe(50 * MIB);
  });

  it('is complete when everything is installed', () => {
    const status = sectionStatus(psychiatry, none, () => true, []);
    expect(status.install).toBe('complete');
    expect(status.plan.pending).toEqual([]);
    expect(status.plan.bytes).toBe(0);
  });

  it('shows the queue state of the section through the shared download tasks', () => {
    const tasks = [
      { moduleId: 'kr.1', state: 'queued', downloadedBytes: 0, totalBytes: null },
    ] as never;
    expect(sectionStatus(psychiatry, none, () => false, tasks).queue).toBe('queued');
  });
});

describe('labels', () => {
  it('summarises contents and the size still to download', () => {
    const fresh = sectionStatus(cardiology, none, () => false, []);
    expect(sectionSummary(cardiology, none, fresh)).toBe(
      `1 клиническая рекомендация · препараты: 2 группы · ${formatDownloadSize(81 * MIB)}`,
    );
  });

  it('says «скачано» for a finished section and «ещё» for a started one', () => {
    const done = sectionStatus(psychiatry, none, () => true, []);
    expect(pendingSizeLabel(done.plan, done.install)).toBe('скачано');
    const started = sectionStatus(psychiatry, none, (module) => module.id === 'kr.1', []);
    expect(pendingSizeLabel(started.plan, started.install)).toBe(
      `ещё ${formatDownloadSize(58 * MIB)}`,
    );
  });

  it('omits the size when a package declares none instead of guessing', () => {
    const plan = moduleDownloadPlan(
      selectedModules(sections, {
        sectionIds: new Set([psychiatry.id]),
        skippedGroups: none,
      }).filter((module) => module.id === 'minimed.medications.instructions.nervous-system.ru'),
      () => false,
    );
    expect(plan.bytes).toBe(30 * MIB);
    const unknown = { ...plan, bytes: null };
    expect(pendingSizeLabel(unknown, 'none')).toBe('');
  });
});

describe('selectionTotalLabel', () => {
  const selection = { sectionIds: new Set(sections.map((s) => s.id)), skippedGroups: none };

  it('asks for a section first', () => {
    expect(
      selectionTotalLabel(
        0,
        moduleDownloadPlan([], () => false),
      ),
    ).toBe('Выберите раздел');
  });

  it('sizes the union of the ticked sections once, shared packages included once', () => {
    const plan = moduleDownloadPlan(selectedModules(sections, selection), () => false);
    // 10 + 20 + 5 recommendations; nervous-system 38 and cardiovascular 38 once each.
    expect(plan.bytes).toBe((35 + 38 + 38) * MIB);
    expect(selectionTotalLabel(2, plan)).toBe(
      `Скачать выбранное · ${formatDownloadSize(111 * MIB)}`,
    );
  });

  it('says the selection is already downloaded when nothing is pending', () => {
    const plan = moduleDownloadPlan(selectedModules(sections, selection), () => true);
    expect(selectionTotalLabel(2, plan)).toBe('Выбранное уже скачано');
  });
});
