import type { Page } from '@playwright/test';

/**
 * Waits until no history layer entry is left on top of the page the app is on. A dialog or sheet is
 * a history layer (`state/history-layer.ts`): closing it takes its entry off one task later and the
 * traversal arrives asynchronously. A spec that sets `location.hash` right after the dialog is gone
 * races that step on a busy machine, and the step lands the page back on the old address. Real
 * users cannot navigate within a task of closing a dialog; specs can.
 */
export async function waitForHistoryLayersClosed(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const state = window.history.state as { minimedEntry?: { layer?: boolean } } | null;
    return state?.minimedEntry?.layer !== true;
  });
}
