from __future__ import annotations

from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"{label} anchor not found")
    return text.replace(old, new, 1)


def patch_analysis() -> None:
    path = Path("packages/search-lexical/src/analysis.ts")
    text = path.read_text(encoding="utf-8")

    import_line = "import { extractSupplementalClinicalFacts } from './clinical-facts';\n"
    if import_line not in text:
        text = replace_once(
            text,
            "import { expandAliases } from './aliases';\n",
            "import { expandAliases } from './aliases';\n" + import_line,
            "analysis import",
        )

    text = replace_once(
        text,
        "  extractNegations(query, aliases, facts);\n  extractAliasFacts(query, aliases, facts);\n",
        """  extractNegations(query, aliases, facts);
  const negativeRanges = facts
    .filter((fact) => fact.kind === 'negative-finding')
    .map((fact) => fact.range);
  for (const candidate of extractSupplementalClinicalFacts(query, negativeRanges)) {
    addFact(facts, candidate);
  }
  extractAliasFacts(query, aliases, facts);
""",
        "analysis extraction",
    )

    text = replace_once(
        text,
        "  const clinicalTerms = [...new Set([...positiveTerms, ...canonicalTerms])].slice(0, MAX_FTS_TERMS);\n",
        """  const factTerms = termsWithStems(
    facts
      .filter(
        (fact) =>
          fact.polarity === 'positive' &&
          (fact.kind === 'symptom' || fact.kind === 'location' || fact.kind === 'epidemiology'),
      )
      .map((fact) => fact.normalizedValue),
  );
  const clinicalTerms = [...new Set([...positiveTerms, ...canonicalTerms, ...factTerms])].slice(
    0,
    MAX_FTS_TERMS,
  );
""",
        "analysis clinical terms",
    )
    path.write_text(text, encoding="utf-8")


def patch_search_workspace() -> None:
    path = Path("apps/app/src/features/search/SearchWorkspace.tsx")
    text = path.read_text(encoding="utf-8")

    text = replace_once(
        text,
        "import { createMemo, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';",
        "import { createEffect, createMemo, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';",
        "Solid import",
    )
    text = replace_once(
        text,
        "import { HighlightedText } from '../../components/HighlightedText';\n",
        "import { HighlightedText } from '../../components/HighlightedText';\nimport type { SearchHistoryEntry } from '../history/search-history';\n",
        "history import",
    )
    text = replace_once(
        text,
        "interface SearchWorkspaceProps {\n  readonly core: MedicalCore;\n}\n",
        "export interface SearchRestoreRequest {\n  readonly id: number;\n  readonly query: string;\n}\n\ninterface SearchWorkspaceProps {\n  readonly core: MedicalCore;\n  readonly history: readonly SearchHistoryEntry[];\n  readonly restoreRequest: SearchRestoreRequest | undefined;\n  readonly onHistoryEntry: (entry: Omit<SearchHistoryEntry, 'id' | 'searchedAt'>) => void;\n}\n",
        "workspace props",
    )
    text = replace_once(
        text,
        "const HISTORY_KEY = 'localmed.search-history.v2';\n",
        "const DRAFT_KEY = 'localmed.search-draft.v1';\n",
        "draft key",
    )
    text = replace_once(
        text,
        """function saveHistory(query: string, current: readonly string[]): readonly string[] {
  const next = [query, ...current.filter((item) => item !== query)].slice(0, 6);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}

""",
        "",
        "legacy history helper",
    )
    text = replace_once(
        text,
        "  const [history, setHistory] = createSignal<readonly string[]>([]);\n",
        "",
        "legacy history signal",
    )
    text = replace_once(
        text,
        "  let copyTimer: ReturnType<typeof setTimeout> | undefined;\n",
        "  let copyTimer: ReturnType<typeof setTimeout> | undefined;\n  let lastRestoreRequestId = -1;\n",
        "restore request state",
    )
    text = replace_once(
        text,
        """  onMount(() => {
    setHistory(loadStringArray(HISTORY_KEY));
    setBookmarks(new Set(loadStringArray(BOOKMARKS_KEY)));
  });
""",
        """  onMount(() => {
    setBookmarks(new Set(loadStringArray(BOOKMARKS_KEY)));
    const draft = localStorage.getItem(DRAFT_KEY)?.trim();
    if (draft) {
      setQuery(draft);
      scheduleAnalysis(draft);
      requestAnimationFrame(() => {
        if (textarea) resizeTextarea(textarea);
      });
    }
  });

  createEffect(() => {
    const request = props.restoreRequest;
    if (!request || request.id === lastRestoreRequestId) return;
    lastRestoreRequestId = request.id;
    updateQuery(request.query);
    requestAnimationFrame(() => {
      if (textarea) resizeTextarea(textarea);
    });
    void runSearch(request.query);
  });
""",
        "mount and restore effect",
    )
    text = replace_once(
        text,
        """  function updateQuery(value: string): void {
    setQuery(value);
    scheduleAnalysis(value);
  }
""",
        """  function updateQuery(value: string): void {
    setQuery(value);
    if (value.trim()) localStorage.setItem(DRAFT_KEY, value);
    else localStorage.removeItem(DRAFT_KEY);
    scheduleAnalysis(value);
  }
""",
        "draft persistence",
    )
    text = replace_once(
        text,
        """    setError(undefined);
    setActiveCategory('all');
    const result = await props.core.search({
""",
        """    setError(undefined);
    setActiveCategory('all');
    setContext(undefined);
    setSelectedResult(undefined);
    const result = await props.core.search({
""",
        "new search reset",
    )
    text = replace_once(
        text,
        """    setResponse(result.value);
    setDraftAnalysis(result.value.analysis);
    setHistory((current) => saveHistory(trimmed, current));
    const first = result.value.groups[0]?.results[0];
    if (first) await openResult(first);
    else {
      setContext(undefined);
      setSelectedResult(undefined);
    }
""",
        """    setResponse(result.value);
    setDraftAnalysis(result.value.analysis);
    props.onHistoryEntry({
      query: trimmed,
      resultCount: result.value.groups.length,
      candidateCount: result.value.diagnostics.candidateCount,
      modeUsed: result.value.modeUsed,
    });
""",
        "search history recording",
    )
    text = replace_once(
        text,
        """    setQuery('');
    setDraftAnalysis(undefined);
""",
        """    setQuery('');
    localStorage.removeItem(DRAFT_KEY);
    setDraftAnalysis(undefined);
""",
        "draft clearing",
    )
    text = replace_once(
        text,
        "  async function copyFocusChunk(): Promise<void> {\n",
        """  function closeReader(): void {
    setContext(undefined);
    setSelectedResult(undefined);
    setShowFullSection(false);
  }

  async function copyFocusChunk(): Promise<void> {
""",
        "reader close function",
    )
    text = replace_once(
        text,
        '<section class="workspace archive-desk" aria-label="Локальный медицинский поиск">',
        '<section class="workspace archive-desk search-home" aria-label="Локальный медицинский поиск">',
        "search home class",
    )
    text = replace_once(
        text,
        '<span>Ctrl / ⌘ + Enter — поиск</span>',
        '<span class="keyboard-only">Ctrl / ⌘ + Enter — поиск</span>',
        "keyboard shortcut class",
    )
    text = replace_once(
        text,
        '<Show when={!response() && history().length > 0}>',
        '<Show when={!response() && props.history.length > 0}>',
        "history conditional",
    )
    text = replace_once(
        text,
        '<For each={history()}>',
        '<For each={props.history.slice(0, 6)}>',
        "history loop",
    )
    text = replace_once(
        text,
        '<aside class="reader-column source-folder" aria-live="polite">',
        """<Show when={context()}>
        <button
          class="reader-backdrop"
          type="button"
          aria-label="Закрыть источник"
          onClick={closeReader}
        />
      </Show>
      <aside
        class="reader-column source-folder source-drawer"
        classList={{ open: Boolean(context()) }}
        aria-live="polite"
        aria-hidden={!context()}
      >""",
        "source drawer",
    )
    text = replace_once(
        text,
        """              <header class="reader-header">
                <div>
""",
        """              <header class="reader-header">
                <button class="reader-close" type="button" aria-label="Закрыть источник" onClick={closeReader}>
                  ×
                </button>
                <div>
""",
        "reader close button",
    )
    path.write_text(text, encoding="utf-8")


def patch_landing_favicon() -> None:
    path = Path("apps/landing/src/pages/index.astro")
    text = path.read_text(encoding="utf-8")
    text = replace_once(
        text,
        '    <meta name="theme-color" content="#48453f" />\n',
        '    <meta name="theme-color" content="#48453f" />\n    <link rel="icon" type="image/svg+xml" href="./favicon.svg" />\n',
        "landing favicon",
    )
    path.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    patch_analysis()
    patch_search_workspace()
    patch_landing_favicon()
