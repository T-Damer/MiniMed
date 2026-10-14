/**
 * A tool that keeps its state in its own address (`#/notes/drug-interactions?c=…`): the state is
 * written onto the entry the tool is on, so back, a tab round trip and a reload bring it back.
 * Replaces the entry (no new one) and raises no route event: the tool already has the state.
 */
export function replaceToolUrl(routePrefix: string, nextHash: string): void {
  const current = window.location.hash;
  if (!current.startsWith(routePrefix) || current === nextHash) return;
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${window.location.search}${nextHash}`,
  );
}
