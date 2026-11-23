import { createSignal } from 'solid-js';

import type { AskAiContextBlock } from '@/features/ask-ai/ask-ai-context';

export interface AskAiSelectionContext {
  readonly excerpt: string;
  readonly documentTitle?: string | undefined;
  readonly sectionTitle?: string | undefined;
  readonly sourceRef?: string | undefined;
  readonly contextBlocks?: readonly AskAiContextBlock[] | undefined;
}

const [activeSelection, setActiveSelection] = createSignal<AskAiSelectionContext | null>(null);

export function openAskAiForExcerpt(context: AskAiSelectionContext): void {
  const trimmed = context.excerpt.trim();
  if (!trimmed) return;
  setActiveSelection({
    excerpt: trimmed,
    ...(context.documentTitle ? { documentTitle: context.documentTitle } : {}),
    ...(context.sectionTitle ? { sectionTitle: context.sectionTitle } : {}),
    ...(context.sourceRef ? { sourceRef: context.sourceRef } : {}),
    ...(context.contextBlocks?.length ? { contextBlocks: context.contextBlocks } : {}),
  });
}

export function closeAskAiSheet(): void {
  setActiveSelection(null);
}

export function askAiSelection(): AskAiSelectionContext | null {
  return activeSelection();
}
