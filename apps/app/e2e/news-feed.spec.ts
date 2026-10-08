import { mountBuiltApp } from '@localmed/app/e2e/mount-built-app';
import { expect, type Page, type Route, test } from '@playwright/test';

const FEED_URL = 'https://feeds.test/medical.xml';
const LONG_FEED_URL = 'https://long.test/feed.xml';
const BLOCKED_FEED_URL = 'https://closed.test/feed.xml';
const SITE_URL = 'https://site.test/articles/long';
/** An article host a browser cannot read (no CORS): the feed text stays the view. */
const CLOSED_ARTICLE_URL = 'https://closed.test/article';
const SLOW_URL = 'https://slow.test/article';
const HERO_URL = 'https://img.test/hero.png';
const CORS_HEADERS = { 'access-control-allow-origin': '*' };
/** The preview server is cross-origin isolated (COEP), so a framed or embedded resource must opt in like this; production hosts are not isolated. */
const EMBEDDABLE = {
  'cross-origin-resource-policy': 'cross-origin',
  'cross-origin-embedder-policy': 'require-corp',
};
/** A 24 px green disc on white: the site's «apple-touch-icon». */
const ICON_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAATUlEQVR4nGP4T2PAMPwt0Ks1IojJtoAYwwlZgtUCUgwmZBH9LaDEcGyWMFDbcHRLRi0YtWDUAnrnZGpYgg4GxgJyLMIFBrZGowaguQUAe1RvO3Dh13EAAAAASUVORK5CYII=';

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
    <description>Новости для проверки ленты.</description>
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
      <title>Запись про сайт, который нельзя прочитать из браузера</title>
      <link>${CLOSED_ARTICLE_URL}</link>
      <guid>g2</guid>
      <pubDate>${rfc822(7_200_000)}</pubDate>
      <description>Сайт не отдаёт страницу браузеру.</description>
    </item>
    <item>
      <title>Вчерашняя запись с полным текстом</title>
      <link>${SITE_URL}?n=3</link>
      <guid>g3</guid>
      <pubDate>${rfc822(26 * 3_600_000)}</pubDate>
      <description>Вступление.</description>
      <enclosure url="${HERO_URL}" type="image/png" length="1234"/>
      <content:encoded><![CDATA[<p>${'Полный текст статьи из самой ленты. '.repeat(20)}</p><script>window.__pwned = true</script><img src="https://img.test/a.png" alt="x">]]></content:encoded>
    </item>
  </channel>
</rss>`;
}

/** 90 recent entries: more than one screenful, more than the first chunk the list draws, under the 99+ cap of the badge. */
function longFeedXml(): string {
  const items = Array.from({ length: 90 }, (_, index) => {
    const number = index + 1;
    return `<item><title>Запись ${number}: длинная лента для проверки прокрутки и отметки прочитанного</title><link>https://long.test/n/${number}</link><guid>l${number}</guid><pubDate>${rfc822(number * 60_000)}</pubDate></item>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Длинная лента</title><link>https://long.test/</link><language>ru</language>${items}</channel></rss>`;
}

const PARAGRAPH =
  'Подробный текст статьи про новые рекомендации: показания, дозы, противопоказания и порядок наблюдения пациентов, с цифрами и ссылками на источники.';

const PAGE_HTML = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Рекомендации — Тестовый сайт</title><meta name="author" content="Редакция"><script>window.__ran = true</script><style>.cover{display:block}</style></head><body onload="window.__ran = true">
<nav class="menu"><a href="/">Главная страница сайта</a></nav>
<article><h1 id="remote-heading">Новые рекомендации по гипертонии</h1><p>${PARAGRAPH}</p><p>${PARAGRAPH}</p><p>${PARAGRAPH}</p><p><a href="/docs/order.pdf" onclick="alert(1)">Приказ</a></p></article>
<footer>Подвал сайта с реквизитами</footer>
</body></html>`;

const HOME_HTML = `<!doctype html><html><head><title>Тестовые новости</title><link rel="apple-touch-icon" href="/touch.png"></head><body>Главная</body></html>`;

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
  // The site behind the feed: a home page that declares an icon, and the icon.
  await page.route('https://feeds.test/', async (route) => {
    requests.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      headers: CORS_HEADERS,
      body: HOME_HTML,
    });
  });
  await page.route('https://feeds.test/touch.png', async (route) => {
    requests.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      headers: CORS_HEADERS,
      body: Buffer.from(ICON_PNG_BASE64, 'base64'),
    });
  });
  await page.route(LONG_FEED_URL, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/rss+xml; charset=utf-8',
      headers: CORS_HEADERS,
      body: longFeedXml(),
    });
  });
  // A host that does not allow cross-origin reads: a CORS request (it carries an Origin header) fails in the page,
  // while a no-cors probe still reaches it (Playwright would otherwise add CORS headers to a fulfilled reply).
  await page.route(/^https:\/\/closed\.test\//u, async (route) => {
    requests.push(route.request().url());
    if ((await route.request().allHeaders()).origin) {
      await route.abort('failed');
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/rss+xml', body: feedXml() });
  });
  // The article host: a readable page, which the app extracts and may also show as it is.
  await page.route(/^https:\/\/site\.test\//u, async (route) => {
    requests.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      headers: { ...CORS_HEADERS, ...EMBEDDABLE },
      body: PAGE_HTML,
    });
  });
  // A site that never answers: the viewer must not stay blank.
  await page.route(/^https:\/\/slow\.test\//u, async () => {
    // Intentionally left pending.
  });
  await page.route(/^https:\/\/img\.test\//u, async (route) => {
    requests.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      headers: { ...CORS_HEADERS, 'cross-origin-resource-policy': 'cross-origin' },
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4d7657"/><stop offset="1" stop-color="#c9a55a"/></linearGradient></defs><rect width="640" height="360" fill="url(#g)"/></svg>',
    });
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

/** «+» card → the sources page → the address → the sheet's «Подписаться» → back to the feed. */
async function subscribeByAddress(page: Page, url: string): Promise<void> {
  await page.getByTestId('news-add-entry').click();
  await expect(page.getByTestId('news-sources')).toBeVisible();
  await page.getByRole('textbox', { name: 'Адрес ленты или сайта' }).fill(url);
  await page.getByRole('button', { name: 'Проверить адрес' }).click();
  const sheet = page.locator('.news-sheet');
  await expect(sheet.getByTestId('news-source-items')).toBeVisible();
  await sheet.getByRole('button', { name: 'Подписаться', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await page.getByRole('button', { name: 'К ленте' }).click();
  await expect(page.getByTestId('news-page')).toBeVisible();
}

test.describe('news feed tab', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('is the fourth tab, offers sources as cards and makes no request until one is added', async ({
    page,
  }) => {
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
    await expect(page.getByTestId('news-unread-badge')).toHaveCount(0);

    // Header: «<icon> Лента», PubMed and settings on the right, and a «?»; no refresh before a source exists.
    await expect(page.getByRole('heading', { name: 'Лента', exact: true })).toBeVisible();
    await expect(page.getByTestId('news-pubmed-entry')).toContainText('PubMed');
    await expect(page.getByRole('link', { name: 'Управление источниками' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Обновить ленту' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Как это работает' })).toBeVisible();

    // The rail: «+» first, then the suggested sources. Opening one is a tap on its card, never a subscription.
    const rail = page.getByTestId('news-rail');
    await expect(rail.getByTestId('news-add-entry')).toHaveAccessibleName('Добавить свой источник');
    await expect(rail.locator('[data-suggested]').first()).toBeVisible();
    expect(await rail.locator('[data-suggested]').count()).toBeGreaterThanOrEqual(12);
    // Avatars are bundled: a logo where we have one, a coloured monogram where the site refuses clients.
    await expect(rail.locator('[data-suggested="who-news-ru"] img.news-avatar__image')).toHaveCount(
      1,
    );
    await expect(
      rail.locator('[data-suggested="nejm-current"] .news-avatar__mark'),
    ).not.toBeEmpty();
    await page.waitForTimeout(500);
    expect(external).toEqual([]);
    await page.screenshot({ path: test.info().outputPath('news-empty-phone.png') });
  });

  test('explains itself behind the «?» of the header', async ({ page }) => {
    await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
    await openNews(page);
    await page.getByRole('button', { name: 'Как это работает' }).click();
    const help = page.getByRole('dialog', { name: 'Как это работает' });
    await expect(help).toContainText('Запись становится прочитанной, когда вы пролистали её');
    await expect(help).toContainText('Запросы уходят только к этим сайтам');
  });

  test('adds a feed by address, previews it first and shows one flat list of posts', async ({
    page,
  }) => {
    const hosts = await installFeedHosts(page);
    await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
    await openNews(page);
    await page.getByTestId('news-add-entry').click();
    await page.getByRole('textbox', { name: 'Адрес ленты или сайта' }).fill(FEED_URL);
    await page.getByRole('button', { name: 'Проверить адрес' }).click();
    // The sheet shows what the address is before anything is subscribed: name, description, latest entries.
    const sheet = page.locator('.news-sheet');
    await expect(sheet).toContainText('Тестовые медицинские новости');
    await expect(sheet).toContainText('Новости для проверки ленты.');
    await expect(sheet.getByTestId('news-source-items')).toContainText(
      'Новые рекомендации по гипертонии',
    );
    await page.screenshot({ path: test.info().outputPath('news-source-sheet-phone.png') });
    await sheet.getByRole('button', { name: 'Подписаться', exact: true }).click();
    await expect(sheet).toHaveCount(0);
    await page.getByRole('button', { name: 'К ленте' }).click();

    // One flat list, newest first: no day headings, no filter chips, no «read all».
    await expect(page.locator('[data-news-item]')).toHaveCount(3);
    await expect(page.locator('[data-news-item]').first()).toContainText(
      'Новые рекомендации по гипертонии',
    );
    await expect(page.getByRole('heading', { name: 'Сегодня', exact: true })).toHaveCount(0);
    await expect(page.locator('.news-chip, [data-news-chip]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Отметить всё/u })).toHaveCount(0);
    // The description line under the title: how many sources, when updated.
    await expect(page.getByTestId('news-page')).toContainText('1 источник · обновлено');
    // Title only, at most six lines; a small account line with the site and the age.
    const first = page.locator('[data-news-item]').first();
    await expect(first.locator('.news-item__title')).toHaveCSS('-webkit-line-clamp', '6');
    await expect(first.locator('.news-item__source')).toHaveText('Тестовые медицинские новости');
    await expect(first.locator('.news-item__domain')).toHaveText('site.test');
    await expect(first.locator('.news-item__time')).toHaveText('1 ч');
    await expect(first.locator('.news-item__snippet')).toHaveCount(0);
    // The avatar is inline before the name, not a column of its own.
    const avatarBox = await first.locator('.news-avatar').boundingBox();
    const titleBox = await first.locator('.news-item__title').boundingBox();
    expect(avatarBox?.width).toBeLessThanOrEqual(24);
    expect(Math.abs((avatarBox?.x ?? 0) - (titleBox?.x ?? 99))).toBeLessThan(2);

    const badge = page.getByTestId('news-unread-badge');
    await expect(badge).toHaveText('3');
    await expect(page.locator('[data-read="false"]')).toHaveCount(3);
    // The site's icon was fetched once for the source and kept: the avatar became its picture.
    await expect(first.locator('img.news-avatar__image')).toHaveAttribute('src', /^data:image\//u);
    expect(hosts.requests.filter((url) => url === 'https://feeds.test/touch.png')).toHaveLength(1);
    await page.screenshot({ path: test.info().outputPath('news-list-phone.png') });

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
  });

  test('marks entries read as they are scrolled past and draws the list in chunks', async ({
    page,
  }) => {
    await installFeedHosts(page);
    await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
    await openNews(page);
    await subscribeByAddress(page, LONG_FEED_URL);
    const badge = page.getByTestId('news-unread-badge');
    await expect(badge).toHaveText('90');
    // First chunk only; nothing is read while it is on screen.
    await expect(page.locator('[data-news-item]')).toHaveCount(60);
    await expect(page.locator('[data-read="true"]')).toHaveCount(0);

    await page.mouse.wheel(0, 5000);
    await expect
      .poll(async () => page.locator('[data-news-item]').count(), { timeout: 15_000 })
      .toBeGreaterThan(60);
    // The ones that went up past the top are read (one batched write), the ones below are not.
    await expect
      .poll(async () => page.locator('[data-read="true"]').count(), { timeout: 15_000 })
      .toBeGreaterThan(5);
    const read = await page.locator('[data-read="true"]').count();
    const unread = await page.locator('[data-read="false"]').count();
    expect(unread).toBeGreaterThan(0);
    await expect(badge).toHaveText(String(90 - read));
    // The first entry, far above the screen, is read; the last drawn one is not.
    await expect(page.locator('[data-news-item]').first()).toHaveAttribute('data-read', 'true');
    await expect(page.locator('[data-news-item]').last()).toHaveAttribute('data-read', 'false');
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

    // Back up: the refresh brings the new record, unread. The failure toast pauses its timer while
    // the pointer rests on it, so the pointer leaves before the next press.
    hosts.setReachable(true);
    hosts.setExtraItem(true);
    await page.mouse.move(0, 600);
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Обновить ленту' }).click();
    await expect(page.locator('[data-news-item]')).toHaveCount(4);
    await expect(page.getByTestId('news-errors')).toHaveCount(0);
    await expect(page.getByTestId('news-unread-badge')).toHaveText('4');
  });

  test('reads the article of the site inside the app: heading in the content, no tabs, saved for offline', async ({
    page,
    context,
  }) => {
    const hosts = await installFeedHosts(page);
    await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
    await openNews(page);
    await subscribeByAddress(page, FEED_URL);

    await page.locator('[data-news-item]').filter({ hasText: 'Новые рекомендации' }).click();
    await expect(page).toHaveURL(/#\/news\/item\//u);
    const viewer = page.getByTestId('news-viewer');
    const article = page.getByTestId('news-article');
    // The page was downloaded by the app and reduced to its article: heading, text, none of the site chrome.
    await expect(article.getByRole('heading', { level: 1 })).toHaveText(
      'Новые рекомендации по гипертонии',
    );
    await expect(article).toHaveAttribute('data-article-source', 'page');
    await expect(article).toContainText('Подробный текст статьи про новые рекомендации');
    await expect(article).not.toContainText('Главная страница сайта');
    await expect(article).not.toContainText('Подвал сайта');
    await expect(article.locator('a[href="https://site.test/docs/order.pdf"]')).toHaveText(
      'Приказ',
    );
    expect(
      await page.evaluate(() => (window as unknown as { __ran?: boolean }).__ran),
    ).toBeUndefined();
    // The header is one compact row: back, the source's avatar and short name, round icon buttons.
    await expect(viewer.locator('.news-viewer__source-name')).toHaveText(
      'Тестовые медицинские новости',
    );
    await expect(viewer.getByRole('radio')).toHaveCount(0);
    await expect(viewer.getByRole('tab')).toHaveCount(0);
    const external = viewer.getByRole('link', { name: 'Открыть в браузере' });
    await expect(external).toHaveAttribute('target', '_blank');
    await expect(external).toHaveAttribute('rel', /noopener/u);
    await expect(external).toHaveAttribute('href', SITE_URL);
    const headerBox = await viewer.locator('.page__above-header').boundingBox();
    expect(headerBox?.height).toBeLessThan(64);
    await page.screenshot({ path: test.info().outputPath('news-viewer-phone.png') });

    // Back in the list the entry is read; the article stays on the device and opens with no network.
    await page.getByRole('button', { name: 'К ленте' }).click();
    await expect(page).toHaveURL(/#\/news$/u);
    await expect(page.locator('[data-news-item][data-read="true"]')).toHaveCount(1);
    await expect(page.getByTestId('news-unread-badge')).toHaveText('2');
    await context.setOffline(true);
    const before = hosts.requests.length;
    await page.locator('[data-news-item]').filter({ hasText: 'Новые рекомендации' }).click();
    await expect(page.getByTestId('news-article')).toHaveAttribute('data-article-source', 'page');
    await expect(page.getByTestId('news-article')).toContainText(
      'Подробный текст статьи про новые рекомендации',
    );
    expect(hosts.requests.length).toBe(before);
  });

  test('shows the raw page in a sandbox without scripts when asked, and goes back to the article', async ({
    page,
  }) => {
    await installFeedHosts(page);
    await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
    await openNews(page);
    await subscribeByAddress(page, FEED_URL);
    await page.locator('[data-news-item]').filter({ hasText: 'Новые рекомендации' }).click();
    await expect(page.getByTestId('news-article')).toHaveAttribute('data-article-source', 'page');

    const toggle = page.getByTestId('news-viewer-raw');
    await expect(toggle).toHaveAccessibleName('Показать страницу сайта');
    await toggle.click();
    const frame = page.getByTestId('news-page-frame');
    await expect(frame).toBeVisible();
    const sandbox = (await frame.getAttribute('sandbox')) ?? '';
    expect(sandbox).not.toContain('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');
    await expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
    const document = (await frame.getAttribute('srcdoc')) ?? '';
    expect(document).not.toContain('<script');
    expect(document).not.toContain('onload');
    expect(document).not.toContain('onclick');
    expect(document).toContain('<base href="https://site.test/articles/long"');
    expect(document).toContain("script-src 'none'");
    await expect(
      page.frameLocator('[data-testid="news-page-frame"]').locator('#remote-heading'),
    ).toHaveText('Новые рекомендации по гипертонии');
    await expect(
      page.frameLocator('[data-testid="news-page-frame"]').getByText('Главная страница сайта'),
    ).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('news-viewer-raw-phone.png') });

    await expect(toggle).toHaveAccessibleName('Показать статью');
    await toggle.click();
    await expect(page.getByTestId('news-article')).toBeVisible();
    await expect(page.getByTestId('news-page-frame')).toHaveCount(0);
  });

  test('reads the text the feed published when it is a full article, without fetching the page', async ({
    page,
  }) => {
    const hosts = await installFeedHosts(page);
    await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
    await openNews(page);
    await subscribeByAddress(page, FEED_URL);

    await page.locator('[data-news-item]').filter({ hasText: 'Вчерашняя запись' }).click();
    const article = page.getByTestId('news-article');
    await expect(article).toContainText('Полный текст статьи из самой ленты.');
    await expect(article).toHaveAttribute('data-article-source', 'feed');
    expect(
      await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned),
    ).toBeUndefined();
    await expect(article.locator('img')).toHaveCount(0);
    expect(hosts.requests.some((url) => url.startsWith('https://img.test'))).toBe(false);
    // The feed carried the article: the page itself was not downloaded.
    expect(hosts.requests.some((url) => url === `${SITE_URL}?n=3`)).toBe(false);
  });

  test('keeps the feed text and says why when the site cannot be read from a browser', async ({
    page,
  }) => {
    await installFeedHosts(page);
    await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
    await openNews(page);
    await subscribeByAddress(page, FEED_URL);

    await page.locator('[data-news-item]').filter({ hasText: 'нельзя прочитать' }).click();
    const article = page.getByTestId('news-article');
    await expect(article).toContainText('Сайт не отдаёт страницу браузеру.');
    await expect(article).toHaveAttribute('data-article-source', 'feed');
    await expect(article.locator('.news-article__problem')).toContainText(
      'Сайт не разрешает загрузить статью из браузера',
    );
    const open = page.getByRole('link', { name: 'Открыть в браузере' });
    await expect(open).toHaveAttribute('href', CLOSED_ARTICLE_URL);
    await expect(open).toHaveAttribute('rel', /noopener/u);
    await page.screenshot({ path: test.info().outputPath('news-article-closed-phone.png') });
  });

  test('shows the images of a source only after they are switched on for it', async ({ page }) => {
    const hosts = await installFeedHosts(page);
    await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
    await openNews(page);
    await subscribeByAddress(page, FEED_URL);
    // The list shows titles only: no thumbnail, whatever the switch says.
    await expect(page.locator('[data-news-thumbnail]')).toHaveCount(0);
    await page.getByRole('link', { name: 'Управление источниками' }).click();
    await expect(page.getByTestId('news-sources')).toBeVisible();
    await page.getByRole('switch', { name: /Показывать изображения/u }).click();
    await page.getByRole('button', { name: 'К ленте' }).click();
    await page.locator('[data-news-item]').filter({ hasText: 'Вчерашняя запись' }).click();
    // Hero picture (the enclosure) plus the one inside the text.
    await expect(page.getByTestId('news-article').locator('img')).toHaveCount(2);
    const cover = page.getByTestId('news-article-cover');
    await expect(cover).toHaveAttribute('src', HERO_URL);
    await expect(cover).toHaveAttribute('referrerpolicy', 'no-referrer');
    await expect(cover).toHaveAttribute('loading', 'lazy');
    const coverBox = await cover.boundingBox();
    // A fixed 16:9 box, so the text below does not jump when the picture arrives.
    expect(Math.abs((coverBox?.width ?? 0) / (coverBox?.height ?? 1) - 16 / 9)).toBeLessThan(0.05);
    await expect(page.getByTestId('news-article-images')).toHaveCount(0);
    await expect
      .poll(() => hosts.requests.some((url) => url.startsWith('https://img.test')))
      .toBe(true);
    await page.screenshot({ path: test.info().outputPath('news-article-images-phone.png') });
  });

  test('offers to show the pictures of a source from the article, and never fetches them before', async ({
    page,
  }) => {
    const hosts = await installFeedHosts(page);
    await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
    await openNews(page);
    await subscribeByAddress(page, FEED_URL);
    await page.locator('[data-news-item]').filter({ hasText: 'Вчерашняя запись' }).click();
    await expect(page.getByTestId('news-article-cover')).toHaveCount(0);
    expect(hosts.requests.some((url) => url.startsWith('https://img.test'))).toBe(false);
    await page.getByTestId('news-article-images').click();
    await expect(page.getByTestId('news-article-cover')).toBeVisible();
    await expect(page.getByTestId('news-article-images')).toHaveCount(0);
  });

  test('falls back when a website never answers', async ({ page }) => {
    test.setTimeout(120_000);
    await installFeedHosts(page);
    await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
    await openNews(page);
    await page.getByTestId('news-add-entry').click();
    await page.getByRole('textbox', { name: 'Адрес ленты или сайта' }).fill(SLOW_URL);
    await page.getByRole('button', { name: 'Проверить адрес' }).click();
    // The address never answers: say so and offer it as a website instead of leaving a blank page.
    const sheet = page.locator('.news-sheet');
    await expect(sheet.getByRole('alert')).toContainText('не ответил', { timeout: 40_000 });
    await sheet.getByRole('button', { name: 'Добавить как сайт' }).click();
    await page.getByRole('button', { name: 'К ленте' }).click();
    await page.locator('[data-news-site]').click();
    await expect(page.getByTestId('news-frame-fallback')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('news-frame-fallback')).toContainText('не загрузилась');
    await expect(page.getByRole('link', { name: 'Открыть в браузере' }).first()).toBeVisible();
  });

  test('shows a website the app can read as the page itself, with no tabs', async ({ page }) => {
    await installFeedHosts(page);
    await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
    await openNews(page);
    await page.getByTestId('news-add-entry').click();
    await page.getByRole('textbox', { name: 'Адрес ленты или сайта' }).fill(SITE_URL);
    await page.getByRole('button', { name: 'Проверить адрес' }).click();
    const sheet = page.locator('.news-sheet');
    await sheet.getByRole('button', { name: 'Добавить как сайт' }).click();
    await expect(page.getByTestId('news-sources')).toContainText('site.test');
    await page.getByRole('button', { name: 'К ленте' }).click();
    await expect(page.getByTestId('news-unread-badge')).toHaveCount(0);
    await page.locator('[data-news-site]').click();
    await expect(page).toHaveURL(/#\/news\/site\//u);
    await expect(page.getByTestId('news-page-frame')).toBeVisible();
    await expect(page.getByTestId('news-viewer-raw')).toHaveCount(0);
  });

  test('says honestly when the browser cannot read a source and adds it as a website', async ({
    page,
  }) => {
    await installFeedHosts(page);
    await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
    await openNews(page);
    await page.getByTestId('news-add-entry').click();
    await page.getByRole('textbox', { name: 'Адрес ленты или сайта' }).fill(BLOCKED_FEED_URL);
    await page.getByRole('button', { name: 'Проверить адрес' }).click();
    const sheet = page.locator('.news-sheet');
    await expect(sheet.getByRole('alert')).toContainText(
      'Этот источник не разрешает чтение из браузера — откройте в приложении для Android или как сайт.',
    );
    await sheet.getByRole('button', { name: 'Добавить как сайт' }).click();
    await page.getByRole('button', { name: 'К ленте' }).click();
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
    await page.getByTestId('news-add-entry').click();
    const field = page.getByRole('textbox', { name: 'Адрес ленты или сайта' });
    await field.fill('javascript:alert(1)');
    await page.getByRole('button', { name: 'Проверить адрес' }).click();
    await expect(page.getByRole('alert')).toContainText('только ссылки http и https');
    await field.fill('два слова');
    await page.getByRole('button', { name: 'Проверить адрес' }).click();
    await expect(page.getByRole('alert')).toContainText('не похож на ссылку');
    expect(hosts.requests).toEqual([]);
  });

  test('lists sources in compact rows and removes one with its cache', async ({ page }) => {
    await installFeedHosts(page);
    await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
    await openNews(page);
    await subscribeByAddress(page, FEED_URL);
    await page.getByRole('link', { name: 'Управление источниками' }).click();
    const row = page.locator('[data-source]');
    await expect(row).toHaveCount(1);
    // Avatar, name, «site · updated» under it, the images switch and a delete icon: no renaming.
    await expect(row.locator('.news-source__title')).toHaveText('Тестовые медицинские новости');
    await expect(row.locator('.news-source__detail')).toContainText('feeds.test · только что');
    await expect(row.getByRole('switch', { name: /Показывать изображения/u })).toBeVisible();
    await expect(row.getByRole('button', { name: /^Переименовать/u })).toHaveCount(0);
    await expect(row.locator('img.news-avatar__image')).toHaveCount(1);
    const rowBox = await row.boundingBox();
    expect(rowBox?.height).toBeLessThan(72);
    // «Добавить» and «Настройки» are one page: the address field sits above the list.
    await expect(page.getByRole('textbox', { name: 'Адрес ленты или сайта' })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('news-sources-phone.png') });
    await page.getByRole('button', { name: /^Удалить: Тестовые/u }).click();
    await page.getByRole('button', { name: 'Удалить', exact: true }).last().click();
    await expect(page.getByTestId('news-sources')).toContainText('Подписок пока нет');
    await page.getByRole('button', { name: 'К ленте' }).click();
    await expect(page.getByTestId('news-empty')).toBeVisible();
    await expect(page.getByTestId('news-unread-badge')).toHaveCount(0);
  });

  test('subscribes to a suggested source from its sheet, which opens as a transition from the card', async ({
    page,
  }) => {
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
    await page.getByTestId('news-rail').locator('[data-suggested="medportal-news"] button').click();
    const sheet = page.locator('.news-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('MedPortal');
    await expect(sheet.getByTestId('news-source-items')).toContainText(
      'Новые рекомендации по гипертонии',
    );
    // The names of the transition live only while it runs.
    await expect(page.locator('html')).not.toHaveClass(/news-vt/u);
    expect(suggestedHosts).toHaveLength(1);
    await page.screenshot({ path: test.info().outputPath('news-suggested-sheet-phone.png') });
    await sheet.getByRole('button', { name: 'Подписаться', exact: true }).click();
    await expect(page.locator('[data-news-item]')).toHaveCount(3);
    // The card left the rail; MedPortal's feed carries no pictures, so its images stay off.
    await expect(
      page.getByTestId('news-rail').locator('[data-suggested="medportal-news"]'),
    ).toHaveCount(0);
    await page.getByRole('link', { name: 'Управление источниками' }).click();
    await expect(page.getByRole('switch', { name: /Показывать изображения/u })).not.toBeChecked();
  });

  test('starts a suggested source that carries pictures with its images on', async ({ page }) => {
    await page.route('https://medicalxpress.com/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/rss+xml',
        headers: CORS_HEADERS,
        body: feedXml(),
      });
    });
    await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
    await openNews(page);
    await page.getByTestId('news-rail').locator('[data-suggested="medical-xpress"] button').click();
    await page
      .getByTestId('news-source-sheet')
      .getByRole('button', { name: 'Подписаться', exact: true })
      .click();
    await expect(page.locator('[data-news-item]')).toHaveCount(3);
    await page.getByRole('link', { name: 'Управление источниками' }).click();
    await expect(page.getByRole('switch', { name: /Показывать изображения/u })).toBeChecked();
  });

  test('searches PubMed on request, saves the search and refreshes it with the other sources', async ({
    page,
  }) => {
    const hits: { readonly url: URL; readonly at: number }[] = [];
    let ids = ['41000002', '41000001'];
    await page.route('https://eutils.ncbi.nlm.nih.gov/**', async (route) => {
      const url = new URL(route.request().url());
      hits.push({ url, at: Date.now() });
      const body = url.pathname.endsWith('esearch.fcgi')
        ? { esearchresult: { count: '1523', idlist: ids } }
        : {
            result: {
              uids: ids,
              ...Object.fromEntries(
                ids.map((id) => [
                  id,
                  {
                    uid: id,
                    title: `Исследование глаукомы ${id}.`,
                    source: 'Ophthalmology',
                    pubdate: '2026 Oct 2',
                    sortpubdate: '2026/10/02 00:00',
                    authors: [
                      { name: 'Smith AB' },
                      { name: 'Doe C' },
                      { name: 'Lee D' },
                      { name: 'Kim E' },
                    ],
                  },
                ]),
              ),
            },
          };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: CORS_HEADERS,
        body: JSON.stringify(body),
      });
    });
    await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
    await openNews(page);
    await page.getByRole('link', { name: 'Поиск в PubMed' }).first().click();
    await expect(page.getByTestId('news-pubmed')).toBeVisible();
    // What is sent is stated behind the «?» before the first search, and nothing is sent until the user searches.
    await page.getByRole('button', { name: 'Как это работает' }).click();
    await expect(page.getByTestId('news-pubmed-notice')).toContainText('отправляется в NCBI');
    await page.keyboard.press('Escape');
    expect(hits).toEqual([]);
    await page.getByRole('searchbox', { name: 'Запрос' }).fill('glaucoma AND treatment');
    await page.getByRole('button', { name: 'Найти', exact: true }).click();
    const results = page.getByTestId('news-pubmed-results');
    await expect(results).toContainText('Исследование глаукомы 41000002');
    await expect(results).toContainText('Ophthalmology');
    await expect(results).toContainText('Smith AB, Doe C, Lee D и др.');
    await expect(results).toContainText('Найдено: 1');
    const link = results.locator('[data-pubmed-article="41000002"]');
    await expect(link).toHaveAttribute('href', 'https://pubmed.ncbi.nlm.nih.gov/41000002/');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/u);
    const search = hits[0]?.url;
    expect(search?.searchParams.get('term')).toBe('glaucoma AND treatment');
    expect(search?.searchParams.get('tool')).toBe('minimed');
    expect(search?.searchParams.get('sort')).toBeNull();
    expect(hits).toHaveLength(2);
    // NCBI allows three requests a second: the two requests of one search are spaced.
    expect((hits[1]?.at ?? 0) - (hits[0]?.at ?? 0)).toBeGreaterThanOrEqual(350);
    await page.screenshot({ path: test.info().outputPath('news-pubmed-phone.png') });

    await page.getByRole('button', { name: 'Подписаться на этот поиск' }).click();
    await expect(page.getByTestId('news-pubmed-saved')).toBeVisible();
    await page.getByRole('button', { name: 'К ленте' }).click();
    await expect(page.locator('[data-news-item]')).toHaveCount(2);
    await expect(page.locator('[data-news-item]').first().locator('.news-item__source')).toHaveText(
      'PubMed: glaucoma AND treatment',
    );

    // The saved search opens as a record with a link to PubMed: there is no page to read.
    await page.locator('[data-news-item]').first().click();
    await expect(page.getByTestId('news-page-frame')).toHaveCount(0);
    await expect(page.getByTestId('news-viewer-raw')).toHaveCount(0);
    await expect(page.getByTestId('news-article')).toContainText('PMID');
    await expect(page.getByRole('link', { name: 'Открыть в PubMed' })).toHaveAttribute(
      'href',
      /^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/\d+\/$/u,
    );
    await page.getByRole('button', { name: 'К ленте' }).first().click();

    // A new article appears when the feed is refreshed.
    ids = ['41000003', '41000002', '41000001'];
    await page.getByRole('button', { name: 'Обновить ленту' }).click();
    await expect(page.locator('[data-news-item]')).toHaveCount(3);
  });

  test('says so when PubMed finds nothing or cannot be reached', async ({ page }) => {
    let reachable = true;
    await page.route('https://eutils.ncbi.nlm.nih.gov/**', async (route) => {
      if (!reachable) {
        await route.abort('connectionrefused');
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: CORS_HEADERS,
        body: JSON.stringify({ esearchresult: { count: '0', idlist: [] } }),
      });
    });
    await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
    await openNews(page);
    await page.getByRole('link', { name: 'Поиск в PubMed' }).first().click();
    const field = page.getByRole('searchbox', { name: 'Запрос' });
    await field.fill('zzzz-no-such-term');
    await page.getByRole('button', { name: 'Найти', exact: true }).click();
    await expect(page.getByTestId('news-pubmed-results')).toContainText('ничего не найдено');
    reachable = false;
    await field.fill('glaucoma');
    await page.getByRole('button', { name: 'Найти', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Не удалось связаться');
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
