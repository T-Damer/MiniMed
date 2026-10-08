import type { AtRule, Container, Plugin, Root, Rule } from 'postcss';

/**
 * Makes every `@media (prefers-color-scheme: dark|light)` block obey the in-app theme choice
 * (Settings → Внешний вид → Тема). The app writes `data-theme="light|dark"` on `<html>` only when
 * the user picked a theme; without it the system scheme decides, as before.
 *
 * For a block `@media (prefers-color-scheme: S) { rules }` the plugin
 * - keeps the block for the system scheme, its selectors limited to a root without
 *   `data-theme` set to the other scheme, and
 * - emits the same rules right after it outside any media query, limited to `data-theme="S"`.
 *
 * Both prefixes go through `:where()`, so no rule gains specificity and the cascade between the
 * theme rules and the rest of the CSS stays as authored. Authors keep writing the plain media
 * query; a new block follows the setting without anything else.
 */

const SCHEME_QUERY = /^\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)$/u;
const ROOT_SELECTOR = /^(?::root|html)(?![\w-])/u;
const UNSUPPORTED_IN_SCHEME_BLOCK = new Set(['keyframes', 'font-face', 'import', 'property']);

type Scheme = 'dark' | 'light';

function otherScheme(scheme: Scheme): Scheme {
  return scheme === 'dark' ? 'light' : 'dark';
}

/** `:root` / `html` selectors carry the condition themselves, any other selector gets it as an ancestor. */
export function scopeSelector(selector: string, condition: string): string {
  const trimmed = selector.trim();
  const root = ROOT_SELECTOR.exec(trimmed);
  if (root) return `${root[0]}:where(${condition})${trimmed.slice(root[0].length)}`;
  return `:where(:root${condition}) ${trimmed}`;
}

function scopeRules(container: Container, condition: string): void {
  container.walkRules((rule: Rule) => {
    rule.selectors = rule.selectors.map((selector) => scopeSelector(selector, condition));
  });
}

function assertSupported(block: AtRule): void {
  block.walkAtRules((inner) => {
    if (UNSUPPORTED_IN_SCHEME_BLOCK.has(inner.name.toLowerCase())) {
      throw block.error(
        `@${inner.name} inside a prefers-color-scheme block cannot follow the in-app theme; move it out of the media query.`,
      );
    }
  });
}

export function colorSchemePlugin(): Plugin {
  return {
    postcssPlugin: 'minimed-color-scheme',
    Once(root: Root) {
      root.walkAtRules('media', (block) => {
        if (!block.params.includes('prefers-color-scheme')) return;
        const scheme = SCHEME_QUERY.exec(block.params.trim())?.[1] as Scheme | undefined;
        if (scheme === undefined) {
          throw block.error(
            'Only a plain (prefers-color-scheme: dark|light) media query can follow the in-app theme; combine conditions inside the block instead.',
          );
        }
        assertSupported(block);
        const forced = block.clone();
        scopeRules(block, `:not([data-theme='${otherScheme(scheme)}'])`);
        scopeRules(forced, `[data-theme='${scheme}']`);
        block.after(forced.nodes);
      });
    },
  };
}
colorSchemePlugin.postcss = true;
