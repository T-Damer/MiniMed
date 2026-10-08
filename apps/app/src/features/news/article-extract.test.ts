import { describe, expect, it } from 'vitest';

import { extractArticle } from '@/features/news/article-extract';
import type { SafeNode } from '@/features/news/feed-content';

const PARAGRAPH =
  'Росздравнадзор провёл внеплановую проверку качества, безопасности и обращения лекарственных средств, выявил нарушения и направил материалы в уполномоченные органы.';

const NEWS_PAGE = `<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8">
<title>Новость дня — Тестовый надзор</title>
<meta property="og:title" content="Заголовок из мета">
<meta property="og:image" content="/upload/cover.jpg">
<meta name="author" content="Пресс-служба">
<base href="https://news.test/section/">
<script>window.__pwned = true</script>
<style>.x{color:red}</style>
</head><body>
<header class="site-header"><a href="/">Главная</a> <a href="/news">Новости</a></header>
<nav class="menu"><ul><li><a href="/a">Раздел один</a></li><li><a href="/b">Раздел два</a></li></ul></nav>
<div class="page">
  <div class="news-detail">
    <h1>Проверка качества лекарств выявила нарушения</h1>
    <div class="date">8 октября 2026</div>
    <div class="share social"><a href="#">Поделиться</a><a href="#">Твитнуть</a></div>
    <div class="text">
      <p>${PARAGRAPH}</p>
      <p>${PARAGRAPH}
      <p>Вторая часть текста, с запятыми, точками и <a href="/docs/order.pdf">ссылкой на приказ</a>.
      <img src="data:image/gif;base64,R0lGOD" data-src="/upload/photo.jpg" alt="Фото проверки" width="640">
      <img src="/img/pixel.gif" width="1" height="1">
      <p>${PARAGRAPH}</p>
      <p><a href="/docs/order.pdf">Приказ об утверждении</a></p>
    </div>
    <div class="related"><h3>Читайте также</h3><ul><li><a href="/n/1">Другая новость один</a></li><li><a href="/n/2">Другая новость два</a></li></ul></div>
    <div class="comments"><p>Комментарий читателя, который не должен попасть в статью, хотя он и длинный по меркам формы.</p></div>
  </div>
  <aside class="sidebar"><p>Реклама и блок справа, который не нужен.</p></aside>
</div>
<footer><p>© Тестовый надзор</p></footer>
</body></html>`;

function textOf(nodes: readonly SafeNode[]): string {
  return nodes
    .map((node) => (typeof node === 'string' ? node : node.children ? textOf(node.children) : ''))
    .join(' ');
}

function find(nodes: readonly SafeNode[], tag: string): SafeNode[] {
  const out: SafeNode[] = [];
  for (const node of nodes) {
    if (typeof node === 'string') continue;
    if (node.tag === tag) out.push(node);
    if (node.children) out.push(...find(node.children, tag));
  }
  return out;
}

describe('extractArticle', () => {
  const article = extractArticle(NEWS_PAGE, 'https://news.test/news/49721');

  it('finds the title, author and cover of the page', () => {
    expect(article?.title).toBe('Проверка качества лекарств выявила нарушения');
    expect(article?.byline).toBe('Пресс-служба');
    expect(article?.imageUrl).toBe('https://news.test/upload/cover.jpg');
  });

  it('keeps the article text, with unclosed paragraphs split properly', () => {
    const text = textOf(article?.content ?? []);
    expect(text).toContain('Росздравнадзор провёл внеплановую проверку');
    expect(text).toContain('Вторая часть текста');
    expect(find(article?.content ?? [], 'p').length).toBeGreaterThanOrEqual(4);
  });

  it('drops navigation, share bar, related links, comments, sidebar, footer and scripts', () => {
    const text = textOf(article?.content ?? []);
    for (const noise of [
      'Главная',
      'Раздел один',
      'Поделиться',
      'Читайте также',
      'Другая новость',
      'Комментарий читателя',
      'Реклама',
      '© Тестовый',
      '__pwned',
    ]) {
      expect(text).not.toContain(noise);
    }
    expect(JSON.stringify(article?.content)).not.toContain('script');
  });

  it("does not repeat the title as the article's first heading", () => {
    expect(textOf(article?.content ?? [])).not.toContain('Проверка качества лекарств выявила');
  });

  it('makes links and lazy images absolute against the page base and skips tracking pixels', () => {
    const links = find(article?.content ?? [], 'a');
    expect(links[0]).toMatchObject({ href: 'https://news.test/docs/order.pdf' });
    const images = find(article?.content ?? [], 'img');
    expect(images).toEqual([
      { tag: 'img', src: 'https://news.test/upload/photo.jpg', alt: 'Фото проверки' },
    ]);
  });

  it('keeps a paragraph that is a single link, and drops a block of several', () => {
    expect(textOf(article?.content ?? [])).toContain('Приказ об утверждении');
    expect(textOf(article?.content ?? [])).not.toContain('Другая новость');
  });

  it('returns nothing for a page without article-sized text', () => {
    const home =
      '<html><body><nav><a href="/a">Раздел</a></nav><div><p>Коротко.</p><ul><li><a href="/x">Одна</a></li><li><a href="/y">Другая</a></li></ul></div></body></html>';
    expect(extractArticle(home, 'https://news.test/')).toBeUndefined();
    expect(extractArticle('', 'https://news.test/')).toBeUndefined();
  });

  it('falls back to <article> and og:title when the page has no h1', () => {
    const page = `<html><head><meta property="og:title" content="Мета-заголовок"></head><body><article><p>${PARAGRAPH}</p><p>${PARAGRAPH}</p></article></body></html>`;
    const extracted = extractArticle(page, 'https://a.test/x');
    expect(extracted?.title).toBe('Мета-заголовок');
    expect(textOf(extracted?.content ?? [])).toContain('внеплановую проверку');
  });

  it('never keeps scripts, event handlers or javascript links from a hostile page', () => {
    const hostile = `<html><body><article><p onclick="alert(1)">${PARAGRAPH} <a href="javascript:alert(2)">x</a><img src="javascript:alert(3)" onerror="alert(4)"></p><p>${PARAGRAPH}</p></article></body></html>`;
    const serialized = JSON.stringify(extractArticle(hostile, 'https://a.test/')?.content);
    expect(serialized).not.toContain('javascript');
    expect(serialized).not.toContain('onclick');
    expect(serialized).not.toContain('onerror');
    expect(serialized).not.toContain('alert');
  });
});
