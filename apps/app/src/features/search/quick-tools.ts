import type { AppGlyphName } from '@/components/AppGlyph';
import { openUserLibraryDocument } from '@/features/library/user-library-routing';
import { notesPath } from '@/features/notes/notes-routing';
import type { SearchCatalogTool } from '@/features/search/searchCatalog';
import { openDocumentOverlay } from '@/state/document-navigation';
import type { ItemRef } from '@/state/item-collections';

/**
 * Anything a doctor can pin: catalog calculators and questionnaires, plus app-level tools. Opening
 * is data (a route or a callback), so the UI never branches on a tool id.
 */
export interface QuickTool {
  readonly id: string;
  readonly title: string;
  readonly kindLabel: string;
  readonly icon: AppGlyphName;
  readonly href?: string;
  readonly run?: () => void;
  /** Where the tool sits in «Все инструменты»; catalog tools without it are reached via their lists. */
  readonly group?: QuickToolGroupId;
  /** Set while the tool cannot open yet; shown instead of opening. */
  readonly unavailableReason?: string;
  /** Present when the tool takes files: its row accepts a drop and hands the files here. */
  readonly dropFiles?: (files: readonly File[]) => void;
}

export type QuickToolGroupId = 'reception' | 'calculations' | 'reference' | 'files';

/** The sections of «Все инструменты», in display order. */
export const QUICK_TOOL_GROUPS: readonly {
  readonly id: QuickToolGroupId;
  readonly title: string;
}[] = [
  { id: 'reception', title: 'Приём' },
  { id: 'calculations', title: 'Расчёты' },
  { id: 'reference', title: 'Справочное' },
  { id: 'files', title: 'Файлы' },
];

/** Groups tools by section, keeping section and tool order; empty sections are left out. */
export function groupQuickTools(tools: readonly QuickTool[]): readonly {
  readonly id: QuickToolGroupId;
  readonly title: string;
  readonly tools: readonly QuickTool[];
}[] {
  return QUICK_TOOL_GROUPS.flatMap((group) => {
    const members = tools.filter((tool) => tool.group === group.id);
    return members.length > 0 ? [{ ...group, tools: members }] : [];
  });
}

/**
 * Stable ids for app-level tools that are not catalog entries. «Все инструменты» lists only these
 * real app features; calculators and questionnaires are starred from their own pages instead.
 */
export const APP_TOOL_IDS = {
  conversation: 'minimed.app.conversation',
  ecgPhoto: 'ecg-photo-caliper',
  forms: 'minimed.app.forms',
  notes: 'minimed.app.notes',
  imaging: 'minimed.app.imaging',
  calculators: 'minimed.app.calculators',
  reference: 'minimed.app.reference',
  /** Not listed any more; kept so tools starred in older versions still open. */
  patients: 'minimed.app.patients',
  assessments: 'minimed.app.assessments',
} as const;

export function quickToolsFromCatalog(tools: readonly SearchCatalogTool[]): readonly QuickTool[] {
  return tools.map((tool) => ({
    id: tool.id,
    title: tool.title,
    kindLabel: tool.scope === 'assessments' ? 'Опросник' : 'Калькулятор',
    icon: tool.icon,
    href: tool.href,
  }));
}

export interface ResolvedToolRef {
  readonly id: string;
  /** Undefined when the stored id is no longer in the catalog. */
  readonly tool: QuickTool | undefined;
}

export function resolveToolRefs(
  ids: readonly string[],
  toolsById: ReadonlyMap<string, QuickTool>,
): readonly ResolvedToolRef[] {
  return ids.map((id) => ({ id, tool: toolsById.get(id) }));
}

export interface ResolvedItemRef extends ResolvedToolRef {
  readonly ref: ItemRef;
}

/**
 * Collection entries as openable rows. Tools resolve from the live catalog (undefined when gone);
 * documents open by their stable id; personal notes open their record in the patient card.
 */
export function resolveItemRefs(
  items: readonly ItemRef[],
  toolsById: ReadonlyMap<string, QuickTool>,
): readonly ResolvedItemRef[] {
  return items.map((ref) => {
    if (ref.kind === 'tool') return { ref, id: ref.id, tool: toolsById.get(ref.id) };
    const title = ref.title ?? ref.id;
    return {
      ref,
      id: ref.id,
      tool:
        ref.kind === 'document'
          ? {
              id: ref.id,
              title,
              kindLabel: ref.documentKind === 'user' ? 'Мой файл' : 'Документ',
              icon: 'file-text',
              // A file from «Мои файлы» opens in the personal reader, not the official overlay.
              run: () =>
                ref.documentKind === 'user'
                  ? openUserLibraryDocument({ documentId: ref.id, title })
                  : openDocumentOverlay(ref.id),
            }
          : {
              id: ref.id,
              title,
              kindLabel: 'Личная запись',
              icon: 'notes',
              href: notesPath(ref.parentId, ref.parentId ? ref.id : undefined),
            },
    };
  });
}

export function openQuickTool(tool: QuickTool): void {
  if (tool.unavailableReason) return;
  if (tool.run) tool.run();
  else if (tool.href) window.location.hash = tool.href.replace(/^#?/u, '#');
}
