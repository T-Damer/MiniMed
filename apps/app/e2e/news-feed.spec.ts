import { mountBuiltApp } from '@localmed/app/e2e/mount-built-app';
import { expect, type Page, type Route, test } from '@playwright/test';

const FEED_URL = 'https://feeds.test/medical.xml';
const BLOCKED_FEED_URL = 'https://closed.test/feed.xml';
const SITE_URL = 'https://site.test/articles/long';
const REFUSED_URL = 'https://refuses.test/article';
const SLOW_URL = 'https://slow.test/article';
const CORS_HEADERS = { 'access-control-allow-origin': '*' };
/** The preview server is cross-origin isolated (COEP), so a framed site must opt in like this; production hosts are not isolated. */
const FRAMEABLE = {
  'cross-origin-resource-policy': 'cross-origin',
  'cross-origin-embedder-policy': 'require-corp',
};

function rfc822(msAgo: number): string {
  return new Date(Date.now() - msAgo).toUTCString();
}

function feedXml(options: { readonly extraItem?: boolean } = {}): string {
  const extra = options.extraItem
    ? `<item><title>Свежая запись после обновления</title><link>${SITE_URL}?n=4</link><guid>g4</guid><pubDate>${rfc822(60_000)}</pubDate><description>Новая.</description></item>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Тестовые медицинские новости</title>
    <link>https://feeds.test/</link>
    <language>ru</language>
    ${extra}
    <item>
      <title>Новые рекомендации по гипертонии</title>
      <link>${SITE_URL}</link>
      <guid>g1</guid>
      <pubDate>${rfc822(3_600_000)}</pubDate>
      <description>Кратко о рекомендациях.</description>
    </item>
    <item>
      <title>Запись про закрытый для встраивания сайт</title>
      <link>${REFUSED_URL}</link>
      <guid>g2</guid>
      <pubDate>${rfc822(7_200_000)}</pubDate>
      <description>Сайт запрещает встраивание.</description>
    </item>
    <item>
      <title>Вчерашняя запись с полным текстом</title>
      <link>${SITE_URL}?n=3</link>
      <guid>g3</guid>
      <pubDate>${rfc822(26 * 3_600_000)}</pubDate>
      <description>Вступление.</description>
      <content:encoded><![CDATA[<p>${'Полный текст статьи из самой ленты. '.repeat(20)}</p><script>window.__pwned = true</script><img src="https://img.test/a.png" alt="x">]]></content:encoded>
    </item>
  </channel>
</rss>`;
}

const PAGE_HTML =
  '<!doctype html><html><body><h1 id="remote-heading">Страница сайта внутри ленты</h1></body></html>';

interface FeedHost {
  readonly requests: string[];
  setExtraItem(value: boolean): void;
  setReachable(value: boolean): void;
}

async function installFeedHosts(page: Page): Promise<FeedHost> {
  const requests: string[] = [];
  let extraItem = false;
  let reachable = true;
  await page.route(FEED_URL, async (route: Route) => {
    requests.push(route.request().url());
    if (!reachable) {
      await route.abort('connectionrefused');
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/rss+xml; charset=utf-8',
      headers: CORS_HEADERS,
      body: feedXml({ extraItem }),
    });
  });
  // A feed host that does not allow cross-origin reads: a CORS request (it carries an Origin header) fails in the page,
  // while a no-cors probe still reaches it (Playwright would otherwise add CORS headers to a fulfilled reply).
  await page.route(BLOCKED_FEED_URL, async (route) => {
    requests.push(route.request().url());
    if ((await route.request().allHeaders()).origin) {
      await route.abort('failed');
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/rss+xml', body: feedXml() });
  });
  // The article host answers HEAD (framing probe) and the iframe request with a plain page.
  await page.route(/^https:\/\/site\.test\//u, async (route) => {
    requests.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      headers: { ...CORS_HEADERS, ...FRAMEABLE },
      body: PAGE_HTML,
    });
  });
  // A site that forbids framing and exposes the header to the page (as the Android client can read it).
  await page.route(/^https:\/\/refuses\.test\//u, async (route) => {
    requests.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      headers: {
        ...CORS_HEADERS,
        'access-control-expose-headers': 'x-frame-options',
        'x-frame-options': 'DENY',
      },
      body: PAGE_HTML,
    });
  });
  // A site that never answers: the viewer must not stay blank.
  await page.route(/^https:\/\/slow\.test\//u, async () => {
    // Intentionally left pending.
  });
  await page.route(/^https:\/\/img\.test\//u, async (route) => {
    requests.push(route.request().url());
    await route.abort();
  });
  return {
    requests,
    setExtraItem: (value) => {
      extraItem = value;
    },
    setReachable: (value) => {
      reachable = value;
    },
  };
}

async function openNews(page: Page): Promise<void> {
  await page
    .locator('.app-bottom-nav')
    .getByRole('button', { name: /^Лента/u })
    .click();
  await expect(page.getByTestId('news-page')).toBeVisible();
}

async function subscribeByAddress(page: Page, url: string): Promise<void> {
  await page.getByRole('link', { name: 'Добавить источник' }).first().click();
  await expect(page.getByTestId('news-add')).toBeVisible();
  await page.getByRole('textbox', { name: 'Адрес ленты или сайта' }).fill(url);
  await page.getByRole('button', { name: 'Проверить', exact: true }).click();
  await expect(page.getByTestId('news-add-result')).toContainText('Найдена лента');
  await page.getByTestId('news-add-result').getByRole('button', { name: 'Подписаться' }).click();
  await expect(page.getByTestId('news-page')).toBeVisible();
}

test.describe('news feed tab', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('is the fourth tab and makes no request until a source is added', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (!['127.0.0.1', 'localhost'].includes(url.hostname) && url.protocol.startsWith('http')) {
        external.push(request.url());
      }
    });
    await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
    const nav = page.locator('.app-bottom-nav');
    await expect(nav.locator('.app-nav-button')).toHaveCount(4);
    await expect(nav.locator('.app-nav-button').nth(2)).toHaveAttribute('aria-label', 'Лента');
    await nav.getByRole('button', { name: 'Лента', exact: true }).click();
    await expect(page).toHaveURL(/#\/news$/u);
    await expect(page.getByTestId('news-empty')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Рекомендуемые источники' })).toBeVisible();
    await expect(page.locator('[data-suggested]').first()).toBeVisible();
    // Suggested feeds are offered, never subscribed on their own.
    await expect(page.getByRole('button', { name: /^Подписаться: / }).first()).toBeEnabled();
    await expect(page.getByTestId('news-unread-badge')).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(external).toEqual([]);
    await page.screenshot({ path: test.info().outputPath('news-empty-phone.png') });
  });

  test('adds a feed by address, groups items by day and counts unread on the tab', async ({
    page,
  }) => {
    await installFeedHosts(page);
    await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
    await openNews(page);
    await subscribeByAddress(page, FEED_URL);

    await expect(page.getByRole('heading', { name: 'Сегодня', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Вчера', exact: true })).toBeVisible();
    await expect(page.locator('[data-news-item]')).toHaveCount(3);
    await expect(page.locator('[data-news-item]').first()).toContainText(
      'Новые рекомендации по гипертонии',
    );
    await expect(page.locator('[data-news-chip]')).toHaveCount(1);
    const badge = page.getByTestId('news-unread-badge');
    await expect(badge).toHaveText('3');
    await expect(page.locator('[data-read="false"]')).toHaveCount(3);

    // The tab keeps its state when the user leaves and comes back.
    await page
      .locator('.app-bottom-nav')
      .getByRole('button', { name: 'Поиск', exact: true })
      .click();
    await page
      .locator('.app-bottom-nav')
      .getByRole('button', { name: /^Лента/u })
      .click();
    await expect(page.locator('[data-news-item]')).toHaveCount(3);

    await page.getByRole('button', { name: 'Отметить всё прочитанным' }).click();
    await expect(page.locator('[data-read="false"]')).toHaveCount(0);
    await expect(badge).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('news-list-phone.png') });
  });

  test('shows cached items offline with the fetch time and refreshes new ones when back online', async ({
    page,
    context,
  }) => {
    const hosts = await installFeedHosts(page);
    await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
    await openNews(page);
    await subscribeByAddress(page, FEED_URL);
    await expect(page.locator('[data-news-item]')).toHaveCount(3);

    // No network: the list stays, the banner says so and names when it was fetched.
    await context.setOffline(true);
    await expect(page.getByTestId('news-offline')).toBeVisible();
    await expect(page.getByTestId('news-offline')).toContainText('обновления');
    await expect(page.locator('[data-news-item]')).toHaveCount(3);
    const requestsBefore = hosts.requests.length;
    await page.getByRole('button', { name: 'Обновить ленту' }).click();
    await expect(page.getByTestId('news-offline')).toBeVisible();
    expect(hosts.requests.length).toBe(requestsBefore);
    await context.setOffline(false);
    await expect(page.getByTestId('news-offline')).toHaveCount(0);

    // The source is down after a restart: the cache still opens, the failure is stated.
    hosts.setReachable(false);
    await page.reload();
    await expect(page.getByTestId('news-page')).toBeVisible();
    await expect(page.locator('[data-news-item]')).toHaveCount(3);
    await page.getByRole('button', { name: 'Обновить ленту' }).click();
    await expect(page.getByTestId('news-errors')).toContainText(
      'Не удалось связаться с источником',
    );
    await expect(page.locator('[data-news-item]')).toHaveCount(3);

    // Back up: the refresh brings the new record, unread.
    hosts.setReachable(true);
    hosts.setExtraItem(true);
    await page.getByRole('button', { name: 'Обновить ленту' }).click();
    await expect(page.locator('[data-news-item]')).toHaveCount(4);
    await expect(page.getByTestId('news-errors')).toHaveCount(0);
    await expect(page.getByTestId('news-unread-badge')).toHaveText('4');
  });

  test('opens an item in a sandboxed viewer, marks it read and offers the browser', async ({
    page,
  }) => {
    await installFeedHosts(page);
    await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
    await openNews(page);
    await subscribeByAddress(page, FEED_URL);

    await page.locator('[data-news-item]').filter({ hasText: 'Новые рекомендации' }).click();
    await expect(page).toHaveURL(/#\/news\/item\//u);
    const viewer = page.getByTestId('news-viewer');
    await expect(
      viewer.getByRole('heading', { name: 'Новые рекомендации по гипертонии' }),
    ).toBeVisible();
    await expect(page.getByTestId('news-viewer-address')).toContainText('site.test/articles/long');

    const frame = page.locator('iframe.news-frame__frame');
    await expect(frame).toBeVisible();
    const sandbox = (await frame.getAttribute('sandbox')) ?? '';
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');
    await expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
    await expect(
      page.frameLocator('iframe.news-frame__frame').locator('#remote-heading'),
    ).toHaveText('Страница сайта внутри ленты');

    const external = viewer.getByRole('link', { name: 'Открыть в браузере' }).first();
    await expect(external).toHaveAttribute('target', '_blank');
    await expect(external).toHaveAttribute('rel', /noopener/u);
    await expect(external).toHaveAttribute('href', SITE_URL);
    await page.screenshot({ path: test.info().outputPath('news-viewer-phone.png') });

    await page.getByRole('button', { name: 'К ленте' }).click();
    await expect(page).toHaveURL(/#\/news$/u);
    await expect(page.locator('[data-news-item][data-read="true"]')).toHaveCount(1);
    await expect(page.getByTestId('news-unread-badge')).toHaveText('2');
  });

  test('reads the text the feed published, without scripts or remote images', async ({ page }) => {
    const hosts = await installFeedHosts(page);
    await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
    await openNews(page);
    await subscribeByAddress(page, FEED_URL);

    await page.locator('[data-news-item]').filter({ hasText: 'Вчерашняя запись' }).click();
    const article = page.getByTestId('news-article');
    await expect(article).toContainText('Полный текст статьи из самой ленты.');
    // The first view of an item with a full text is the text; nothing was framed.
    await expect(page.locator('iframe.news-frame__frame')).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned),
    ).toBeUndefined();
    await expect(article.locator('img')).toHaveCount(0);
    expect(hosts.requests.some((url) => url.startsWith('https://img.test'))).toBe(false);

    // The same record can be switched to the page, then back to the text.
    await page.getByRole('radio', { name: 'Страница' }).check({ force: true });
    await expect(page.locator('iframe.news-frame__frame')).toBeVisible();
    await page.getByRole('radio', { name: 'Из ленты' }).check({ force: true });
    await expect(page.getByTestId('news-article')).toBeVisible();
  });

  test('shows the images of a source only after they are switched on for it', async ({ page }) => {
    const hosts = await installFeedHosts(page);
    await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
    await openNews(page);
    await subscribeByAddress(page, FEED_URL);
    await page.getByRole('link', { name: 'Управление источниками' }).click();
    await expect(page.getByTestId('news-sources')).toBeVisible();
    await page.getByRole('switch', { name: /Показывать изображения/u }).click();
    await page
      .getByRole('link', { name: 'К ленте' })
      .or(page.getByRole('button', { name: 'К ленте' }))
      .first()
      .click();
    await page.locator('[data-news-item]').filter({ hasText: 'Вчерашняя запись' }).click();
    await expect(page.getByTestId('news-article').locator('img')).toHaveCount(1);
    await expect
      .poll(() => hosts.requests.some((url) => url.startsWith('https://img.test')))
      .toBe(true);
  });

  test('offers the browser instead of a blank frame when the site forbids framing', async ({
    page,
  }) => {
    await installFeedHosts(page);
    await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
    await openNews(page);
    await subscribeByAddress(page, FEED_URL);

    await page.locator('[data-news-item]').filter({ hasText: 'закрытый для встраивания' }).click();
    const fallback = page.getByTestId('news-frame-fallback');
    await expect(fallback).toBeVisible();
    await expect(fallback).toContainText('не разрешает показ внутри приложения');
    await expect(page.locator('iframe.news-frame__frame')).toHaveCount(0);
    const open = fallback.getByRole('link', { name: 'Открыть в браузере' });
    await expect(open).toHaveAttribute('href', REFUSED_URL);
    await expect(open).toHaveAttribute('rel', /noopener/u);
    await page.screenshot({ path: test.info().outputPath('news-framing-refused-phone.png') });
  });

  test('falls back when a page never loads in the frame', async ({ page }) => {
    test.setTimeout(120_000);
    await installFeedHosts(page);
    await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
    await openNews(page);
    await page.getByRole('link', { name: 'Добавить источник' }).first().click();
    await page.getByRole('textbox', { name: 'Адрес ленты или сайта' }).fill(SLOW_URL);
    await page.getByRole('button', { name: 'Проверить', exact: true }).click();
    // The address never answers: say so and offer it as a website instead of leaving a blank page.
    await expect(page.getByRole('alert')).toContainText('не ответил', { timeout: 40_000 });
    await page.getByRole('button', { name: 'Добавить как сайт' }).click();
    await expect(page.getByTestId('news-page')).toBeVisible();
    await page.locator('[data-news-site]').click();
    await expect(page.getByTestId('news-frame-fallback')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('news-frame-fallback')).toContainText('не открывается');
    await expect(page.getByRole('link', { name: 'Открыть в браузере' }).first()).toBeVisible();
  });

  test('says honestly when the browser cannot read a source and adds it as a website', async ({
    page,
  }) => {
    await installFeedHosts(page);
    await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
    await openNews(page);
    await page.getByRole('link', { name: 'Добавить источник' }).first().click();
    await page.getByRole('textbox', { name: 'Адрес ленты или сайта' }).fill(BLOCKED_FEED_URL);
    await page.getByRole('button', { name: 'Проверить', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(
      'Этот источник не разрешает чтение из браузера — откройте в приложении для Android или как сайт.',
    );
    await page.getByRole('button', { name: 'Добавить как сайт' }).click();
    await expect(page.locator('[data-news-site]')).toHaveCount(1);
    await expect(page.getByTestId('news-unread-badge')).toHaveCount(0);
    await page.locator('[data-news-site]').click();
    await expect(page).toHaveURL(/#\/news\/site\//u);
    await expect(page.getByTestId('news-viewer')).toBeVisible();
  });

  test('validates addresses before any request', async ({ page }) => {
    const hosts = await installFeedHosts(page);
    await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
    await openNews(page);
    await page.getByRole('link', { name: 'Добавить источник' }).first().click();
    const field = page.getByRole('textbox', { name: 'Адрес ленты или сайта' });
    await field.fill('javascript:alert(1)');
    await page.getByRole('button', { name: 'Проверить', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('только ссылки http и https');
    await field.fill('два слова');
    await page.getByRole('button', { name: 'Проверить', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('не похож на ссылку');
    expect(hosts.requests).toEqual([]);
  });

  test('renames and removes a source and the cache goes with it', async ({ page }) => {
    await installFeedHosts(page);
    await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
    await openNews(page);
    await subscribeByAddress(page, FEED_URL);
    await page.getByRole('link', { name: 'Управление источниками' }).click();
    await page.getByRole('button', { name: /^Переименовать/u }).click();
    await page.getByRole('textbox', { name: 'Название источника' }).fill('Моя подборка');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.locator('[data-source]')).toContainText('Моя подборка');
    await page.screenshot({ path: test.info().outputPath('news-sources-phone.png') });
    await page.getByRole('button', { name: /^Удалить: Моя подборка/u }).click();
    await page.getByRole('button', { name: 'Удалить', exact: true }).last().click();
    await expect(page.getByTestId('news-sources')).toContainText('Подписок пока нет');
    await page.getByRole('button', { name: 'К ленте' }).click();
    await expect(page.getByTestId('news-empty')).toBeVisible();
    await expect(page.getByTestId('news-unread-badge')).toHaveCount(0);
  });

  test('subscribes to a suggested source on request only', async ({ page }) => {
    const suggestedHosts: string[] = [];
    await page.route('https://medportal.ru/**', async (route) => {
      suggestedHosts.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: 'application/rss+xml',
        headers: CORS_HEADERS,
        body: feedXml(),
      });
    });
    await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
    await openNews(page);
    expect(suggestedHosts).toEqual([]);
    await page.getByRole('button', { name: /^Подписаться: MedPortal/u }).click();
    await expect(page.locator('[data-news-item]')).toHaveCount(3);
    await expect(page.locator('[data-news-chip]')).toContainText('MedPortal');
    expect(suggestedHosts).toHaveLength(1);
  });
});

test.describe('news feed on a desktop screen', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('lists items with the same layout on a wide screen', async ({ page }) => {
    await installFeedHosts(page);
    await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
    await openNews(page);
    await subscribeByAddress(page, FEED_URL);
    await expect(page.locator('[data-news-item]')).toHaveCount(3);
    await page.screenshot({ path: test.info().outputPath('news-list-desktop.png') });
  });
});
