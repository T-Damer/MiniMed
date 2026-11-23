import { createSignal } from 'solid-js';

export interface AskAiSelectionContext {
  readonly excerpt: string;
  readonly documentTitle?: string | undefined;
  readonly sectionTitle?: string | undefined;
}

const [activeSelection, setActiveSelection] = createSignal<AskAiSelectionContext | null>(null);

export function openAskAiForExcerpt(context: AskAiSelectionContext): void {
  const trimmed = context.excerpt.trim();
  if (!trimmed) return;
  setActiveSelection({
    excerpt: trimmed,
    ...(context.documentTitle ? { documentTitle: context.documentTitle } : {}),
    ...(context.sectionTitle ? { sectionTitle: context.sectionTitle } : {}),
  });
}

export function closeAskAiSheet(): void {
  setActiveSelection(null);
}

export function askAiSelection(): AskAiSelectionContext | null {
  return activeSelection();
}
