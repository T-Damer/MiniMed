import type { AppGlyphName } from '@/components/AppGlyph';
import type { SearchCatalogTool } from '@/features/search/searchCatalog';

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
}

/** Stable ids for app-level tools that are not catalog entries. */
export const APP_TOOL_IDS = {
  conversation: 'minimed.app.conversation',
  reference: 'minimed.app.reference',
} as const;

/** Catalog tools also offered among built-in tools (they have their own home entry). */
export const FEATURED_CATALOG_TOOL_IDS: readonly string[] = ['ecg-photo-caliper'];

export function featuredCatalogTools(tools: readonly QuickTool[]): readonly QuickTool[] {
  return FEATURED_CATALOG_TOOL_IDS.flatMap((id) => tools.filter((tool) => tool.id === id));
}

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

export function openQuickTool(tool: QuickTool): void {
  if (tool.run) tool.run();
  else if (tool.href) window.location.hash = tool.href.replace(/^#?/u, '#');
}
