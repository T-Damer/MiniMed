import { expect, test } from '@playwright/test';
import { mountBuiltApp, waitForSearchEditable, waitForSearchReady } from './mount-built-app';

// NAV1: a second tab used to wait for ever. It can now take the database over: the owner lets go
// (reload into standby, which releases every OPFS pool lock) and the second tab opens the pool.

test('a second tab takes the database over, and the first can take it back', async ({
  context,
}) => {
  test.setTimeout(420_000);
  const first = await context.newPage();
  await first.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(first, { skipLargeCompanionPacks: true, waitForCore: true });
  await waitForSearchEditable(first);

  const second = await context.newPage();
  await second.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(second, { skipLargeCompanionPacks: true });
  const takeOver = second.getByRole('button', { name: 'Использовать здесь' });
  await expect(takeOver).toBeVisible({ timeout: 60_000 });

  await takeOver.click();
  // The first tab let go: it stands by and offers the way back; the second one opens the database.
  const takeBack = first.getByRole('button', { name: 'Использовать здесь' });
  await expect(takeBack).toBeVisible({ timeout: 60_000 });
  await waitForSearchReady(second);
  await waitForSearchEditable(second);

  await takeBack.click();
  await expect(second.getByRole('button', { name: 'Использовать здесь' })).toBeVisible({
    timeout: 60_000,
  });
  await waitForSearchReady(first);
  await waitForSearchEditable(first);
});
