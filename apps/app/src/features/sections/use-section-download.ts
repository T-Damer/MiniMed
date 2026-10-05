import type { ContentModuleCatalogEntry } from '@localmed/contracts';
import { type Accessor, createMemo, createSignal } from 'solid-js';

import { isModuleReleased } from '@/features/modules/local-packaged-modules';
import {
  type DrugDownloadPlan,
  moduleDownloadPlan,
} from '@/features/onboarding/onboarding-downloads';
import { sectionManifest } from './section-manifest';
import { buildSections, type Section, selectedModules, skippedGroupKey } from './section-model';
import { type SectionStatus, sectionStatus } from './section-plan';
import { useModuleInstaller } from './use-module-installer';

export interface SectionDownload {
  /** Undefined until the release catalog and the module runtime are loaded. */
  readonly sections: Accessor<readonly Section[] | undefined>;
  readonly failed: Accessor<boolean>;
  readonly problem: Accessor<boolean>;
  /** Some start of the list is still running: packages are queued or downloading. */
  readonly downloading: Accessor<boolean>;
  readonly status: (section: Section) => SectionStatus;
  readonly isSelected: (sectionId: string) => boolean;
  readonly selectedCount: Accessor<number>;
  /** Packages of the ticked sections that are still missing, shared ones once. */
  readonly plan: Accessor<DrugDownloadPlan>;
  readonly isGroupIncluded: (sectionId: string, groupId: string) => boolean;
  readonly skipped: Accessor<ReadonlySet<string>>;
  readonly isInstalled: (module: ContentModuleCatalogEntry) => boolean;
  readonly toggleSection: (sectionId: string) => void;
  readonly toggleGroup: (sectionId: string, groupId: string) => void;
  /** Queues what the ticked sections still lack and clears the ticks. */
  readonly start: () => Promise<void>;
}

const EMPTY_PLAN: DrugDownloadPlan = { pending: [], bytes: 0, complete: false };

function toggled(set: ReadonlySet<string>, value: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(value)) next.add(value);
  return next;
}

/**
 * State of the «Скачать по разделам» list: the sections derived from the catalog and the section
 * manifest, the user's ticks and the queue. The downloads themselves run through the module
 * runtime, so they appear in the shared download queue like any other.
 */
export function useSectionDownload(onContentChanged: () => Promise<void>): SectionDownload {
  const installer = useModuleInstaller(onContentChanged, 'Не удалось скачать разделы.');
  const [selected, setSelected] = createSignal<ReadonlySet<string>>(new Set<string>());
  const [skipped, setSkipped] = createSignal<ReadonlySet<string>>(new Set<string>());

  const sections = createMemo(() => {
    const snapshot = installer.snapshot();
    return snapshot
      ? buildSections(snapshot.catalog, sectionManifest(), isModuleReleased)
      : undefined;
  });

  const modules = createMemo(() =>
    selectedModules(sections() ?? [], { sectionIds: selected(), skippedGroups: skipped() }),
  );
  const plan = createMemo(() => {
    const snapshot = installer.snapshot();
    return snapshot ? moduleDownloadPlan(modules(), snapshot.isInstalled) : EMPTY_PLAN;
  });
  const status = (section: Section): SectionStatus => {
    const snapshot = installer.snapshot();
    return sectionStatus(
      section,
      skipped(),
      snapshot?.isInstalled ?? (() => false),
      snapshot?.tasks ?? [],
    );
  };

  return {
    sections,
    failed: installer.failed,
    problem: installer.problem,
    downloading: installer.starting,
    status,
    isSelected: (sectionId) => selected().has(sectionId),
    selectedCount: () => selected().size,
    plan,
    isGroupIncluded: (sectionId, groupId) => !skipped().has(skippedGroupKey(sectionId, groupId)),
    skipped,
    isInstalled: (module) => installer.snapshot()?.isInstalled(module) ?? false,
    toggleSection: (sectionId) => setSelected((current) => toggled(current, sectionId)),
    toggleGroup: (sectionId, groupId) =>
      setSkipped((current) => toggled(current, skippedGroupKey(sectionId, groupId))),
    start: async () => {
      const pending = plan().pending;
      if (pending.length === 0) return;
      setSelected(new Set<string>());
      await installer.start(pending);
    },
  };
}
