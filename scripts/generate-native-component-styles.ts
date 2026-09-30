/**
 * Generates native component styles from the WebView's computed component styles.
 *
 *   bun scripts/generate-native-component-styles.ts           # write NativeComponentStyles.kt
 *   bun scripts/generate-native-component-styles.ts --check   # fail if it drifted from the JSON
 *
 * Input: web-component-reference.json from scripts/extract-web-component-reference.ts. Each BEM
 * block becomes a NativeBoxStyle per theme: padding, corner, border, background, shadow layers
 * and text. Sizes are kept only where the web block has a fixed size (icon buttons, dots) or a
 * web min-height (buttons, rows); other widths depend on content and stay with the layout.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const INPUT = 'native/shared/src/commonTest/resources/web-component-reference.json';
const OUTPUT =
  'native/shared/src/commonMain/kotlin/dev/localmed/nativespike/shared/designsystem/NativeComponentStyles.kt';

const FIXED_SIZE = new Set([
  'page-icon',
  'switch',
  'switch-track',
  'switch-track-on',
  'switch-thumb',
  'switch-thumb-on',
  'ui-feature-card-icon',
  'disclosure-chevron',
  'choice-input',
  'back-button',
  'sort-button',
  'add-button',
  'view-toggle-thumb',
  'view-toggle-button',
  'view-toggle-button-on',
  'folder-card-figure',
  'folder-card-icon',
  'folder-card-pin',
  'settings-section-icon',
  'settings-row-label-icon',
  'reader-back',
  'reader-outline-toggle',
  'reader-find-toggle',
  'reader-actions-button',
  'reader-inline-link-icon',
  'scroll-top-button',
  'choice-chip-icon',
  'download-chip-icon',
  'result-category-icon',
  'clinical-tag',
  'more-chevron',
  'bottom-nav-bubble',
  'route-icon-button',
  'history-fab',
  'clinical-toggle',
  'help-icon-link',
  'carousel-arrow',
  'carousel-dot',
  'carousel-dot-active',
  'section-icon-frame',
  'bottom-nav-button',
  'bottom-nav-button-active',
  'query-clear',
  'search-button',
]);
const FIXED_HEIGHT = new Set([
  'button-primary',
  'disclosure-header',
  'search-field',
  'breadcrumbs',
  'view-toggle',
  'button-secondary',
  'more-header',
  'source-picker',
  'quick-access-chip',
  'feature-action-primary',
  'feature-action-secondary',
  'section-row',
  'bottom-nav',
  'results-skeleton-row',
]);
const MIN_HEIGHT = new Set(['query-input']);
FIXED_SIZE.add('clinical-toggle-on');

interface Captured {
  readonly selector: string;
  readonly box: { readonly width: number; readonly height: number };
  readonly style: Readonly<Record<string, string>>;
}
interface Reference {
  readonly themes: Readonly<
    Record<'light' | 'dark', Readonly<Record<string, Readonly<Record<string, Captured | null>>>>>
  >;
}

interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/** Computed colours: rgb(), rgba() and color(srgb r g b / a) with 0–1 channels. */
function parseComputedColor(value: string): Rgba {
  const rgb = /^rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)$/u.exec(
    value.trim(),
  );
  if (rgb)
    return {
      r: Number(rgb[1]),
      g: Number(rgb[2]),
      b: Number(rgb[3]),
      a: rgb[4] === undefined ? 1 : Number(rgb[4]),
    };
  const srgb = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/u.exec(
    value.trim(),
  );
  if (srgb) {
    return {
      r: Number(srgb[1]) * 255,
      g: Number(srgb[2]) * 255,
      b: Number(srgb[3]) * 255,
      a: srgb[4] === undefined ? 1 : Number(srgb[4]),
    };
  }
  throw new Error(`Unsupported computed colour: ${value}`);
}

function kotlinColor(value: string): string {
  const color = parseComputedColor(value);
  const byte = (channel: number): string =>
    Math.max(0, Math.min(255, Math.round(channel)))
      .toString(16)
      .toUpperCase()
      .padStart(2, '0');
  return `Color(0x${byte(color.a * 255)}${byte(color.r)}${byte(color.g)}${byte(color.b)})`;
}

function px(value: string): number {
  if (value === 'normal' || value === '') return 0;
  const match = /^(-?[\d.]+)px$/u.exec(value.trim());
  if (!match) throw new Error(`Expected px, got ${value}`);
  return Number(Number(match[1]).toFixed(2));
}

function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of value) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function shadowLayers(value: string): string[] {
  if (value === 'none') return [];
  return splitTopLevel(value).map((layer) => {
    const color = /^((?:rgba?|color)\([^)]*\))/u.exec(layer)?.[1];
    if (!color) throw new Error(`Shadow layer without leading colour: ${layer}`);
    const rest = layer.slice(color.length).trim();
    const inset = /\binset\b/u.test(rest);
    const [x = 0, y = 0, blur = 0, spread = 0] = rest
      .replace(/\binset\b/u, '')
      .trim()
      .split(/\s+/u)
      .map(px);
    return (
      `NativeShadowLayer(inset = ${inset}, x = ${x}.dp, y = ${y}.dp, blur = ${blur}.dp, ` +
      `spread = ${spread}.dp, color = ${kotlinColor(color)})`
    );
  });
}

function fontRole(family: string): string {
  const first = family.split(',')[0]?.trim().replace(/^"|"$/gu, '').toLowerCase() ?? '';
  if (first.startsWith('minimed') || first.includes('mono') || first === 'monospace') return 'Mono';
  if (first === 'georgia' || (first.includes('serif') && !first.includes('sans'))) return 'Serif';
  return 'Sans';
}

/** Row and column gap of a flex/grid block (`gap: row column`); `normal` is 0. */
function gaps(value: string): readonly [number, number] {
  if (value === 'normal') return [0, 0];
  const [row = '0px', column = row] = value.split(/\s+/u);
  return [px(row === 'normal' ? '0px' : row), px(column === 'normal' ? '0px' : column)];
}

function kotlinName(block: string): string {
  return block.replace(/-([a-z])/gu, (_, letter: string) => letter.toUpperCase());
}

function boxStyle(block: string, captured: Captured): string {
  const s = captured.style;
  const radius = s['border-top-left-radius'] ?? '0px';
  const circle = radius.endsWith('%');
  const width = FIXED_SIZE.has(block) ? `${captured.box.width}.dp` : 'null';
  const height = FIXED_SIZE.has(block) ? `${captured.box.height}.dp` : 'null';
  // Buttons and rows keep the web min-height, so a second text line still grows them.
  const minHeight =
    MIN_HEIGHT.has(block) || FIXED_HEIGHT.has(block) ? `${captured.box.height}.dp` : 'null';
  const lineHeight =
    s['line-height'] === 'normal' ? 'TextUnit.Unspecified' : `${px(s['line-height'] ?? '')}.sp`;
  const layers = shadowLayers(s['box-shadow'] ?? 'none');
  return [
    'NativeBoxStyle(',
    `        width = ${width}, height = ${height}, minHeight = ${minHeight},`,
    `        padding = NativePadding(start = ${px(s['padding-left'] ?? '0px')}.dp, top = ${px(s['padding-top'] ?? '0px')}.dp, end = ${px(s['padding-right'] ?? '0px')}.dp, bottom = ${px(s['padding-bottom'] ?? '0px')}.dp),`,
    `        corner = ${circle ? '0.dp' : `${px(radius)}.dp`}, circle = ${circle},`,
    `        borderWidth = ${px(s['border-top-width'] ?? '0px')}.dp, borderColor = ${kotlinColor(s['border-top-color'] ?? 'rgba(0, 0, 0, 0)')}, borderDashed = ${s['border-top-style'] === 'dashed'},`,
    `        background = ${kotlinColor(s['background-color'] ?? 'rgba(0, 0, 0, 0)')}, opacity = ${Number(s.opacity ?? 1)}f,`,
    `        bottomBorderWidth = ${px(s['border-bottom-width'] ?? '0px')}.dp, bottomBorderColor = ${kotlinColor(s['border-bottom-color'] ?? 'rgba(0, 0, 0, 0)')},`,
    `        rowGap = ${gaps(s.gap ?? 'normal')[0]}.dp, columnGap = ${gaps(s.gap ?? 'normal')[1]}.dp,`,
    `        shadows = ${layers.length ? `listOf(\n            ${layers.join(',\n            ')},\n        )` : 'emptyList()'},`,
    `        text = NativeTextSpec(role = NativeFontRole.${fontRole(s['font-family'] ?? '')}, size = ${px(s['font-size'] ?? '16px')}.sp, weight = FontWeight(${Number(s['font-weight'] ?? 400)}), lineHeight = ${lineHeight}, letterSpacing = ${px(s['letter-spacing'] ?? 'normal')}.sp, uppercase = ${s['text-transform'] === 'uppercase'}, color = ${kotlinColor(s.color ?? 'rgb(0, 0, 0)')}),`,
    '    )',
  ].join('\n');
}

const reference = JSON.parse(readFileSync(resolve(ROOT, INPUT), 'utf8')) as Reference;
const blocks = new Map<string, Captured>();
for (const screen of Object.values(reference.themes.light)) {
  for (const [block, captured] of Object.entries(screen)) {
    if (!captured) throw new Error(`The web reference has no ${block}.`);
    if (!blocks.has(block)) blocks.set(block, captured);
  }
}

function themeBlock(theme: 'light' | 'dark'): Map<string, Captured> {
  const map = new Map<string, Captured>();
  for (const screen of Object.values(reference.themes[theme])) {
    for (const [block, captured] of Object.entries(screen)) {
      if (!captured) throw new Error(`The ${theme} web reference has no ${block}.`);
      if (!map.has(block)) map.set(block, captured);
    }
  }
  return map;
}

function themeStyles(theme: 'light' | 'dark'): string {
  const map = themeBlock(theme);
  const name = theme === 'light' ? 'Light' : 'Dark';
  return [
    `val ${name}ComponentStyles = NativeComponentStyles(`,
    ...[...blocks.keys()].map((block) => {
      const captured = map.get(block);
      if (!captured) throw new Error(`${block} is missing from the ${theme} reference.`);
      return `    ${kotlinName(block)} = ${boxStyle(block, captured)},`;
    }),
    ')',
  ].join('\n');
}

const kotlin = `// Generated by scripts/generate-native-component-styles.ts from ${INPUT}.
// Do not edit: re-capture the WebView with scripts/extract-web-component-reference.ts and run
// \`bun scripts/generate-native-component-styles.ts\`.
package dev.localmed.nativespike.shared.designsystem

import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

enum class NativeFontRole { Serif, Sans, Mono }

@Immutable
data class NativePadding(val start: Dp, val top: Dp, val end: Dp, val bottom: Dp)

@Immutable
data class NativeTextSpec(
    val role: NativeFontRole,
    val size: TextUnit,
    val weight: FontWeight,
    val lineHeight: TextUnit,
    val letterSpacing: TextUnit,
    val uppercase: Boolean,
    val color: Color,
)

/** One web BEM block's computed box and text, as the WebView renders it at 375 px. */
@Immutable
data class NativeBoxStyle(
    val width: Dp?,
    val height: Dp?,
    val minHeight: Dp?,
    val padding: NativePadding,
    val corner: Dp,
    val circle: Boolean,
    val borderWidth: Dp,
    val borderColor: Color,
    /** CSS \`border-style: dashed\`. */
    val borderDashed: Boolean,
    val background: Color,
    /** CSS \`opacity\` of the whole block (the result index is 0.1). */
    val opacity: Float,
    /** Separator drawn under the block (list items). */
    val bottomBorderWidth: Dp,
    val bottomBorderColor: Color,
    /** CSS gaps between the block's children. */
    val rowGap: Dp,
    val columnGap: Dp,
    val shadows: List<NativeShadowLayer>,
    val text: NativeTextSpec,
)

@Immutable
data class NativeComponentStyles(
${[...blocks.keys()].map((block) => `    /** Web \`${blocks.get(block)?.selector ?? block}\`. */\n    val ${kotlinName(block)}: NativeBoxStyle,`).join('\n')}
)

${themeStyles('light')}

${themeStyles('dark')}
`;

const outputPath = resolve(ROOT, OUTPUT);
if (process.argv.includes('--check')) {
  const current = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : '';
  if (current !== kotlin) {
    console.error(
      `${OUTPUT} is out of date with ${INPUT}; run bun scripts/generate-native-component-styles.ts.`,
    );
    process.exit(1);
  }
  console.log('Native component styles match the web reference.');
} else {
  writeFileSync(outputPath, kotlin);
  console.log(`Wrote ${OUTPUT}: ${blocks.size} component styles per theme.`);
}
