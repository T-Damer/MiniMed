import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const dataPath = resolve(root, 'data/build/alias-review-batch.json');
const outputPath = resolve(root, 'data/build/alias-review.html');

const data = readFileSync(dataPath, 'utf8');

const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<title>Проверка кандидатов алиасов — MiniMed</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root {
    color-scheme: light dark;
    --bg: #0f1115;
    --panel: #171a21;
    --panel-2: #1e222c;
    --border: #2a2f3a;
    --text: #e7e9ee;
    --muted: #9aa1b0;
    --accent: #5b8cff;
    --ok: #33c07a;
    --reject: #e05a5a;
    --pending: #d9a441;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #f4f5f7;
      --panel: #ffffff;
      --panel-2: #f0f1f4;
      --border: #dde0e6;
      --text: #1a1d24;
      --muted: #666d7d;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
  header {
    padding: 14px 20px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
    background: var(--panel);
  }
  header h1 { font-size: 15px; margin: 0; font-weight: 600; }
  .progress-bar {
    flex: 1;
    min-width: 160px;
    height: 8px;
    background: var(--panel-2);
    border-radius: 4px;
    overflow: hidden;
    display: flex;
  }
  .progress-bar .seg-ok { background: var(--ok); }
  .progress-bar .seg-reject { background: var(--reject); }
  .stats { display: flex; gap: 14px; font-size: 12.5px; color: var(--muted); font-family: var(--mono); }
  .stats b { color: var(--text); }
  button.export {
    background: var(--accent);
    color: white;
    border: none;
    padding: 7px 14px;
    border-radius: 6px;
    font-size: 13px;
    cursor: pointer;
    font-weight: 600;
  }
  main {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .card {
    width: min(880px, 100%);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
  }
  .card-top {
    padding: 18px 22px;
    border-bottom: 1px solid var(--border);
  }
  .badge {
    display: inline-block;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--panel-2);
    color: var(--muted);
    margin-right: 8px;
  }
  .mapping {
    font-size: 19px;
    margin-top: 10px;
    line-height: 1.5;
  }
  .mapping .alias { color: var(--accent); font-weight: 600; }
  .mapping .arrow { color: var(--muted); margin: 0 8px; }
  .mapping .canonical { font-weight: 600; }
  .source-quote {
    margin-top: 10px;
    font-size: 12.5px;
    color: var(--muted);
    font-style: italic;
  }
  .source-quote b { color: var(--text); font-style: normal; }
  .query-row {
    padding: 14px 22px;
    background: var(--panel-2);
    font-family: var(--mono);
    font-size: 13.5px;
    border-bottom: 1px solid var(--border);
  }
  .query-row .label { color: var(--muted); margin-right: 8px; font-family: inherit; }
  .compare {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
  }
  .compare > div { padding: 16px 22px; }
  .compare > div:first-child { border-right: 1px solid var(--border); }
  .compare h3 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    margin: 0 0 10px;
  }
  .fact {
    font-size: 12.5px;
    padding: 4px 0;
    font-family: var(--mono);
  }
  .fact .kind { color: var(--accent); }
  .empty { color: var(--muted); font-size: 12.5px; font-style: italic; }
  .term-list { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 4px; }
  .term {
    font-family: var(--mono);
    font-size: 11.5px;
    background: var(--panel-2);
    border: 1px solid var(--border);
    padding: 1px 6px;
    border-radius: 4px;
    color: var(--muted);
  }
  .term.new { background: color-mix(in srgb, var(--ok) 18%, var(--panel-2)); color: var(--ok); border-color: var(--ok); font-weight: 600; }
  .alias-match { font-family: var(--mono); font-size: 12px; padding: 4px 0; }
  .note-row { padding: 14px 22px; border-top: 1px solid var(--border); }
  .note-row textarea {
    width: 100%;
    min-height: 52px;
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-family: inherit;
    font-size: 13px;
    padding: 8px 10px;
    resize: vertical;
  }
  .controls {
    display: flex;
    gap: 10px;
    padding: 16px 22px;
    border-top: 1px solid var(--border);
    align-items: center;
  }
  .controls button {
    flex: 1;
    padding: 11px 14px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--panel-2);
    color: var(--text);
    font-size: 14px;
    cursor: pointer;
    font-weight: 600;
  }
  .controls button .key { opacity: 0.55; font-weight: 400; margin-left: 6px; font-size: 12px; }
  .controls button.ok { border-color: var(--ok); color: var(--ok); }
  .controls button.reject { border-color: var(--reject); color: var(--reject); }
  .controls button:hover { filter: brightness(1.15); }
  .nav {
    display: flex;
    justify-content: space-between;
    padding: 10px 22px 18px;
    font-size: 12.5px;
    color: var(--muted);
  }
  .nav button {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 12.5px;
    text-decoration: underline;
  }
  .nav button:disabled { opacity: 0.3; cursor: default; text-decoration: none; }
  .verdict-flag {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 999px;
    font-weight: 600;
  }
  .verdict-flag.ok { background: color-mix(in srgb, var(--ok) 20%, transparent); color: var(--ok); }
  .verdict-flag.reject { background: color-mix(in srgb, var(--reject) 20%, transparent); color: var(--reject); }
  .verdict-flag.pending { background: color-mix(in srgb, var(--pending) 20%, transparent); color: var(--pending); }
  .done-screen { text-align: center; padding: 60px 20px; color: var(--muted); }
  .done-screen h2 { color: var(--text); }
</style>
</head>
<body>
<header>
  <h1>Проверка кандидатов алиасов</h1>
  <div class="progress-bar" id="progressBar"></div>
  <div class="stats" id="stats"></div>
  <button class="export" id="exportBtn">Экспорт JSON</button>
</header>
<main id="main"></main>

<script id="review-data" type="application/json">${data}</script>
<script>
(function () {
  const ITEMS = JSON.parse(document.getElementById('review-data').textContent);
  const STORAGE_KEY = 'minimed-alias-review-v1';

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  const state = loadState();
  for (const item of ITEMS) {
    const saved = state[item.candidate.id];
    if (saved) {
      item.verdict = saved.verdict;
      item.note = saved.note;
    }
  }

  let cursor = ITEMS.findIndex((item) => item.verdict === 'pending');
  if (cursor < 0) cursor = 0;

  const main = document.getElementById('main');
  const progressBar = document.getElementById('progressBar');
  const stats = document.getElementById('stats');

  function persist(item) {
    state[item.candidate.id] = { verdict: item.verdict, note: item.note };
    saveState(state);
  }

  function setVerdict(item, verdict) {
    item.verdict = verdict;
    persist(item);
    const nextPending = ITEMS.findIndex((candidate, index) => index > cursor && candidate.verdict === 'pending');
    if (nextPending >= 0) {
      cursor = nextPending;
    } else {
      const anyPending = ITEMS.findIndex((candidate) => candidate.verdict === 'pending');
      cursor = anyPending >= 0 ? anyPending : Math.min(cursor + 1, ITEMS.length - 1);
    }
    render();
  }

  function termDiff(before, after) {
    const beforeSet = new Set(before);
    return after.map((term) => ({ term, isNew: !beforeSet.has(term) }));
  }

  function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[ch]);
  }

  function renderFacts(facts) {
    if (facts.length === 0) return '<div class="empty">фактов не извлечено</div>';
    return facts
      .map(
        (fact) =>
          '<div class="fact"><span class="kind">' + escapeHtml(fact.kind) + '</span> — ' +
          escapeHtml(fact.value) + ' &rarr; <b>' + escapeHtml(fact.normalizedValue) + '</b></div>',
      )
      .join('');
  }

  function renderTerms(diffed) {
    if (diffed.length === 0) return '<div class="empty">пусто</div>';
    return (
      '<div class="term-list">' +
      diffed
        .map(
          (entry) =>
            '<span class="term' + (entry.isNew ? ' new' : '') + '">' + escapeHtml(entry.term) + '</span>',
        )
        .join('') +
      '</div>'
    );
  }

  function renderAliasMatches(matches) {
    if (matches.length === 0) return '<div class="empty">совпадений нет</div>';
    return matches.map((match) => '<div class="alias-match">' + escapeHtml(match) + '</div>').join('');
  }

  function updateStats() {
    const ok = ITEMS.filter((item) => item.verdict === 'ok').length;
    const reject = ITEMS.filter((item) => item.verdict === 'reject').length;
    const pending = ITEMS.length - ok - reject;
    const pct = (count) => (count / ITEMS.length) * 100;
    progressBar.innerHTML =
      '<div class="seg-ok" style="width:' + pct(ok) + '%"></div>' +
      '<div class="seg-reject" style="width:' + pct(reject) + '%"></div>';
    stats.innerHTML =
      '<span><b>' + ok + '</b> ok</span><span><b>' + reject + '</b> reject</span><span><b>' +
      pending + '</b> pending</span><span><b>' + ITEMS.length + '</b> всего</span>';
  }

  function render() {
    updateStats();
    const item = ITEMS[cursor];
    if (!item) {
      main.innerHTML = '<div class="done-screen"><h2>Готово</h2><p>Все кандидаты рассмотрены. Нажмите «Экспорт JSON».</p></div>';
      return;
    }
    const c = item.candidate;
    const termDiffed = termDiff(item.before.terms, item.after.terms);
    const flagClass = item.verdict === 'ok' ? 'ok' : item.verdict === 'reject' ? 'reject' : 'pending';
    const flagLabel = item.verdict === 'ok' ? 'OK' : item.verdict === 'reject' ? 'REJECT' : 'PENDING';

    main.innerHTML =
      '<div class="card">' +
      '<div class="card-top">' +
      '<span class="badge">' + escapeHtml(c.category) + '</span>' +
      '<span class="badge">' + escapeHtml(c.sourceDoc) + '</span>' +
      '<span class="verdict-flag ' + flagClass + '">' + flagLabel + '</span>' +
      '<div class="mapping"><span class="alias">' + escapeHtml(c.alias) + '</span>' +
      '<span class="arrow">&rarr;</span><span class="canonical">' + escapeHtml(c.canonicalTerm) + '</span></div>' +
      '<div class="source-quote"><b>' + escapeHtml(c.sourceDoc) + ':</b> &laquo;' + escapeHtml(c.sourceQuote) + '&raquo;</div>' +
      '</div>' +
      '<div class="query-row"><span class="label">Тестовый запрос:</span>' + escapeHtml(c.sampleQuery) + '</div>' +
      '<div class="compare">' +
      '<div><h3>До (без кандидата)</h3>' +
      '<div class="empty" style="margin-bottom:8px">Alias-совпадения</div>' + renderAliasMatches(item.before.aliasMatches) +
      '<div class="empty" style="margin:10px 0 4px">Извлечённые факты</div>' + renderFacts(item.before.facts) +
      '</div>' +
      '<div><h3>После (с кандидатом)</h3>' +
      '<div class="empty" style="margin-bottom:8px">Alias-совпадения</div>' + renderAliasMatches(item.after.aliasMatches) +
      '<div class="empty" style="margin:10px 0 4px">Извлечённые факты</div>' + renderFacts(item.after.facts) +
      '<div class="empty" style="margin:10px 0 4px">Термины клинической ветки (новые — зелёным)</div>' + renderTerms(termDiffed) +
      '</div>' +
      '</div>' +
      '<div class="note-row"><textarea id="noteInput" placeholder="Комментарий (опционально)">' + escapeHtml(item.note || '') + '</textarea></div>' +
      '<div class="controls">' +
      '<button class="ok" id="okBtn">✓ OK <span class="key">1</span></button>' +
      '<button class="reject" id="rejectBtn">✕ Отклонить <span class="key">2</span></button>' +
      '</div>' +
      '<div class="nav">' +
      '<button id="prevBtn"' + (cursor === 0 ? ' disabled' : '') + '>&larr; назад</button>' +
      '<span>' + (cursor + 1) + ' / ' + ITEMS.length + '</span>' +
      '<button id="nextBtn"' + (cursor === ITEMS.length - 1 ? ' disabled' : '') + '>вперёд &rarr;</button>' +
      '</div>' +
      '</div>';

    document.getElementById('okBtn').addEventListener('click', () => setVerdict(item, 'ok'));
    document.getElementById('rejectBtn').addEventListener('click', () => setVerdict(item, 'reject'));
    document.getElementById('prevBtn').addEventListener('click', () => { cursor = Math.max(0, cursor - 1); render(); });
    document.getElementById('nextBtn').addEventListener('click', () => { cursor = Math.min(ITEMS.length - 1, cursor + 1); render(); });
    const noteInput = document.getElementById('noteInput');
    noteInput.addEventListener('input', () => {
      item.note = noteInput.value;
      persist(item);
    });
  }

  document.addEventListener('keydown', (event) => {
    if (document.activeElement && document.activeElement.tagName === 'TEXTAREA') return;
    const item = ITEMS[cursor];
    if (!item) return;
    if (event.key === '1') setVerdict(item, 'ok');
    else if (event.key === '2') setVerdict(item, 'reject');
    else if (event.key === 'ArrowLeft') { cursor = Math.max(0, cursor - 1); render(); }
    else if (event.key === 'ArrowRight') { cursor = Math.min(ITEMS.length - 1, cursor + 1); render(); }
  });

  document.getElementById('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(ITEMS, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'alias-review-results.json';
    link.click();
    URL.revokeObjectURL(url);
  });

  render();
})();
</script>
</body>
</html>
`;

writeFileSync(outputPath, html);
console.log(`Wrote review UI to ${outputPath}`);
