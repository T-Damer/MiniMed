/**
 * Generates the native design tokens from the WebView theme, which stays the design reference.
 *
 *   bun scripts/generate-native-design-tokens.ts           # write DesignTokens.kt
 *   bun scripts/generate-native-design-tokens.ts --check   # fail if it drifted from the CSS
 *
 * Both themes follow CSS cascade rules: the dark `:root` block overrides the light one and every
 * `var()` is resolved again inside the theme, so `--paper: var(--theme-surface)` is dark in dark.
 * One rem is 16 dp and one CSS px is one dp, as in the Android WebView.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const LIGHT_CSS = 'apps/app/src/styles/theme.css';
const DARK_CSS = 'apps/app/src/styles/theme-dark.css';
const OUTPUT =
  'native/shared/src/commonMain/kotlin/dev/localmed/nativespike/shared/designsystem/DesignTokens.kt';

type Declarations = Map<string, string>;

/** Custom properties declared directly inside the first `:root { … }` block of a stylesheet. */
function rootDeclarations(css: string): Declarations {
  const start = css.search(/:root\s*\{/u);
  if (start < 0) throw new Error('No :root block.');
  let depth = 0;
  let body = '';
  for (let index = css.indexOf('{', start); index < css.length; index += 1) {
    const char = css[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) break;
    if (depth === 1 && char !== '{') body += char;
  }
  const declarations: Declarations = new Map();
  for (const match of body
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .matchAll(/(--[\w-]+)\s*:\s*([^;]+);/gu)) {
    declarations.set(match[1] as string, (match[2] as string).replace(/\s+/gu, ' ').trim());
  }
  return declarations;
}

function resolveVars(
  value: string,
  declarations: Declarations,
  seen: Set<string> = new Set(),
): string {
  return value.replace(
    /var\((--[\w-]+)(?:,\s*([^)]+))?\)/gu,
    (_, name: string, fallback?: string) => {
      if (seen.has(name)) throw new Error(`Cyclic var(${name}).`);
      const next = declarations.get(name) ?? fallback;
      if (next === undefined) throw new Error(`Unknown var(${name}).`);
      return resolveVars(next, declarations, new Set([...seen, name]));
    },
  );
}

interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

function parseColor(value: string): Rgba | null {
  const text = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/iu.exec(text)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex;
    return {
      r: Number.parseInt(full.slice(0, 2), 16),
      g: Number.parseInt(full.slice(2, 4), 16),
      b: Number.parseInt(full.slice(4, 6), 16),
      a: full.length === 8 ? Number.parseInt(full.slice(6, 8), 16) / 255 : 1,
    };
  }
  const rgb =
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[/,]\s*([\d.]+)(%?))?\s*\)$/u.exec(text);
  if (rgb) {
    const alpha = rgb[4] === undefined ? 1 : Number(rgb[4]) / (rgb[5] ? 100 : 1);
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: alpha };
  }
  const mix = /^color-mix\(\s*in srgb\s*,\s*(.+?)\s+([\d.]+)%\s*,\s*(.+)\)$/u.exec(text);
  if (mix) {
    const first = parseColor(mix[1] as string);
    const second = parseColor(mix[3] as string);
    if (!first || !second) return null;
    const weight = Number(mix[2]) / 100;
    const blend = (left: number, right: number): number => left * weight + right * (1 - weight);
    return {
      r: blend(first.r, second.r),
      g: blend(first.g, second.g),
      b: blend(first.b, second.b),
      a: blend(first.a, second.a),
    };
  }
  return null;
}

function kotlinColor(color: Rgba): string {
  const byte = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .toUpperCase()
      .padStart(2, '0');
  return `Color(0x${byte(color.a * 255)}${byte(color.r)}${byte(color.g)}${byte(color.b)})`;
}

function kotlinName(cssName: string): string {
  const parts = cssName.replace(/^--(theme-)?/u, '').split('-');
  return parts
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
}

/** rem/px to a number of dp (or sp for type sizes); null when the value is not a plain length. */
function lengthInDp(value: string): number | null {
  const match = /^(-?[\d.]+)(rem|px)$/u.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  return Number((match[2] === 'rem' ? amount * 16 : amount).toFixed(3));
}

interface ShadowLayer {
  readonly inset: boolean;
  readonly x: number;
  readonly y: number;
  readonly blur: number;
  readonly spread: number;
  readonly color: Rgba;
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

function parseShadow(value: string): ShadowLayer[] | null {
  const layers: ShadowLayer[] = [];
  for (const layer of splitTopLevel(value)) {
    const colorText = /(rgba?\([^)]*\)|#[0-9a-f]{3,8})/iu.exec(layer)?.[1];
    const color = colorText ? parseColor(colorText) : null;
    if (!color || !colorText) return null;
    const rest = layer.replace(colorText, ' ');
    const inset = /\binset\b/u.test(rest);
    const lengths = rest
      .replace(/\binset\b/u, ' ')
      .trim()
      .split(/\s+/u)
      .filter(Boolean)
      .map((part) => (part === '0' ? 0 : lengthInDp(part)));
    if (lengths.length < 2 || lengths.some((length) => length === null)) return null;
    const [x, y, blur = 0, spread = 0] = lengths as number[];
    layers.push({ inset, x: x as number, y: y as number, blur, spread, color });
  }
  return layers;
}

interface Theme {
  readonly name: 'Light' | 'Dark';
  readonly declarations: Declarations;
}

const light = rootDeclarations(readFileSync(resolve(ROOT, LIGHT_CSS), 'utf8'));
const dark = new Map([
  ...light,
  ...rootDeclarations(readFileSync(resolve(ROOT, DARK_CSS), 'utf8')),
]);
const themes: readonly Theme[] = [
  { name: 'Light', declarations: light },
  { name: 'Dark', declarations: dark },
];

const colorNames: string[] = [];
const shadowNames: string[] = [];
const dimensionLines: string[] = [];
const typeLines: string[] = [];
const weightLines: string[] = [];
const motionLines: string[] = [];
const skipped: string[] = [];

for (const [name, raw] of light) {
  const value = resolveVars(raw, light);
  if (parseColor(value)) colorNames.push(name);
  else if (parseShadow(value)) shadowNames.push(name);
  else if (/^--(type-|theme-type-)/u.test(name) && lengthInDp(value) !== null) {
    typeLines.push(`    val ${kotlinName(name)} = ${lengthInDp(value)}.sp`);
  } else if (/^--theme-weight-/u.test(name) && /^\d+$/u.test(value)) {
    weightLines.push(`    val ${kotlinName(name)} = FontWeight(${value})`);
  } else if (/^--theme-motion-/u.test(name)) {
    const motion = /^(\d+)ms\s+([\w-]+)$/u.exec(value);
    if (!motion) {
      skipped.push(name);
      continue;
    }
    motionLines.push(
      `    val ${kotlinName(name)} = NativeMotion(durationMillis = ${motion[1]}, easing = "${motion[2]}")`,
    );
  } else if (lengthInDp(value) !== null || value === '0') {
    dimensionLines.push(`    val ${kotlinName(name)} = ${lengthInDp(value) ?? 0}.dp`);
  } else skipped.push(name);
}
for (const name of dark.keys()) {
  if (!light.has(name)) throw new Error(`${name} exists only in the dark theme.`);
}

const colorClass = [
  '@Immutable',
  'data class NativeColorTokens(',
  ...colorNames.map((name) => `    val ${kotlinName(name)}: Color,`),
  ')',
].join('\n');

const shadowClass = [
  '@Immutable',
  'data class NativeShadowTokens(',
  ...shadowNames.map((name) => `    val ${kotlinName(name)}: List<NativeShadowLayer>,`),
  ')',
].join('\n');

function themeColors(theme: Theme): string {
  return [
    `val ${theme.name}ColorTokens = NativeColorTokens(`,
    ...colorNames.map((name) => {
      const value = resolveVars(theme.declarations.get(name) as string, theme.declarations);
      return `    ${kotlinName(name)} = ${kotlinColor(parseColor(value) as Rgba)},`;
    }),
    ')',
  ].join('\n');
}

function themeShadows(theme: Theme): string {
  return [
    `val ${theme.name}ShadowTokens = NativeShadowTokens(`,
    ...shadowNames.map((name) => {
      const value = resolveVars(theme.declarations.get(name) as string, theme.declarations);
      const layers = (parseShadow(value) as ShadowLayer[]).map(
        (layer) =>
          `NativeShadowLayer(inset = ${layer.inset}, x = ${layer.x}.dp, y = ${layer.y}.dp, ` +
          `blur = ${layer.blur}.dp, spread = ${layer.spread}.dp, color = ${kotlinColor(layer.color)})`,
      );
      return `    ${kotlinName(name)} = listOf(\n        ${layers.join(',\n        ')},\n    ),`;
    }),
    ')',
  ].join('\n');
}

const kotlin = `// Generated by scripts/generate-native-design-tokens.ts from ${LIGHT_CSS} and ${DARK_CSS}.
// Do not edit: change the CSS and run \`bun run native:tokens\`.
// Not generated (no native value): ${skipped.join(', ')}.
package dev.localmed.nativespike.shared.designsystem

import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Immutable
data class NativeShadowLayer(
    val inset: Boolean,
    val x: Dp,
    val y: Dp,
    val blur: Dp,
    val spread: Dp,
    val color: Color,
)

/** CSS timing: duration plus the CSS easing keyword it was declared with. */
@Immutable
data class NativeMotion(val durationMillis: Int, val easing: String)

${colorClass}

${themeColors(themes[0] as Theme)}

${themeColors(themes[1] as Theme)}

${shadowClass}

${themeShadows(themes[0] as Theme)}

${themeShadows(themes[1] as Theme)}

/** Theme-independent lengths from theme.css (1 rem = 16 dp). */
object NativeDimensions {
${dimensionLines.join('\n')}
}

object NativeTypeSizes {
${typeLines.join('\n')}
}

object NativeFontWeights {
${weightLines.join('\n')}
}

object NativeMotionTokens {
${motionLines.join('\n')}
}
`;

const outputPath = resolve(ROOT, OUTPUT);
if (process.argv.includes('--check')) {
  const current = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : '';
  if (current !== kotlin) {
    console.error(`${OUTPUT} is out of date with the WebView theme; run bun run native:tokens.`);
    process.exit(1);
  }
  console.log('Native design tokens match the WebView theme.');
} else {
  writeFileSync(outputPath, kotlin);
  console.log(
    `Wrote ${OUTPUT}: ${colorNames.length} colors, ${shadowNames.length} shadows, ` +
      `${dimensionLines.length} dimensions, ${typeLines.length} type sizes; skipped ${skipped.length}.`,
  );
}
