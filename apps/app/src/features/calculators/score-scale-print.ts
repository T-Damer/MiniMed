import {
  type ScoreScaleSpec,
  scoreScaleClassName,
  scoreScaleGeometry,
  scoreScaleSummary,
} from '@/features/calculators/score-scale';

/**
 * The score scale as a block of print HTML: the same geometry as the screen component, drawn with
 * plain boxes and fixed light colours so it survives a black-and-white printer (the active band is
 * the dark one, and the legend names every band with its first value).
 */
export const SCORE_SCALE_PRINT_CSS = `
.score-scale{margin:0 0 4mm;padding:3mm;border:1px solid #bbb;border-radius:3mm;break-inside:avoid;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.score-scale__head{display:flex;flex-wrap:wrap;align-items:baseline;gap:1mm 3mm;margin:0 0 2mm}
.score-scale__label{flex:1 1 100%;color:#555;font-size:9pt}
.score-scale__value{font-size:15pt}
.score-scale__band{font-size:10pt;font-weight:700}
.score-scale__track{position:relative;display:flex;gap:.6mm;height:6mm;margin:2mm 3mm 0}
.score-scale__segment{display:block;flex:0 0 auto;border-radius:1mm;background:color-mix(in srgb,var(--fill) 28%,#fff)}
.score-scale__segment--active{background:var(--fill)}
.score-scale__marker{position:absolute;top:50%;width:4.4mm;height:4.4mm;border:.9mm solid #fff;border-radius:50%;background:#111;box-shadow:0 0 0 .3mm #111;transform:translate(-50%,-50%)}
.score-scale__ticks{position:relative;height:4mm;margin:0 3mm;color:#444;font-size:8pt}
.score-scale__tick{position:absolute;top:0;transform:translateX(-50%);white-space:nowrap}
.score-scale__tick--start{transform:none}
.score-scale__tick--end{transform:translateX(-100%)}
.score-scale__legend{display:flex;flex-wrap:wrap;gap:1mm 4mm;margin:2mm 0 0;padding:0;font-size:8.5pt;list-style:none}
.score-scale__legend-item--active{font-weight:700}
.score-scale__swatch{display:inline-block;width:2.6mm;height:2.6mm;margin-right:1mm;border-radius:.6mm;background:var(--fill)}
.score-scale__text{margin:2mm 0 0;font-size:10pt}
`;

const PRINT_FILL: Readonly<Record<string, string>> = {
  none: '#2f7a52',
  low: '#5f7f1f',
  moderate: '#946600',
  high: '#b4501b',
  urgent: '#a52a2a',
  neutral: '#4a6f8a',
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function fill(level: string | undefined): string {
  return PRINT_FILL[level ?? 'neutral'] ?? PRINT_FILL['neutral'] ?? '#4a6f8a';
}

export function scoreScalePrintHtml(
  spec: ScoreScaleSpec,
  options: { readonly text?: boolean } = {},
): string {
  const geometry = scoreScaleGeometry(spec);
  // An ordinal class is written once, by its name; the legend below carries every cut-point.
  const value = scoreScaleClassName(spec) ?? scoreScaleSummary(spec);
  const segments = geometry.segments
    .map(
      (segment) =>
        `<span class="score-scale__segment${spec.activeBand === segment.index ? ' score-scale__segment--active' : ''}" style="flex-basis:${segment.widthPercent}%;--fill:${fill(segment.attentionLevel)}"></span>`,
    )
    .join('');
  const ticks = geometry.ticks
    .map(
      (tick) =>
        `<span class="score-scale__tick${tick.percent <= 0 ? ' score-scale__tick--start' : ''}${tick.percent >= 100 ? ' score-scale__tick--end' : ''}" style="left:${tick.percent}%">${escapeHtml(tick.text)}</span>`,
    )
    .join('');
  const legend =
    spec.bands.length > 0
      ? `<ul class="score-scale__legend">${geometry.segments
          .filter((segment) => segment.label)
          .map(
            (segment) =>
              `<li class="score-scale__legend-item${spec.activeBand === segment.index ? ' score-scale__legend-item--active' : ''}"><span class="score-scale__swatch" style="--fill:${fill(segment.attentionLevel)}"></span>${escapeHtml(segment.label ?? '')}${spec.layout === 'equal' ? '' : ` (${segment.index === 0 ? '&lt;' : '≥'} ${escapeHtml(segment.index === 0 ? (geometry.segments[1]?.fromText ?? '') : segment.fromText)})`}</li>`,
          )
          .join('')}</ul>`
      : '';
  return `<figure class="score-scale">
<div class="score-scale__head">${spec.label ? `<span class="score-scale__label">${escapeHtml(spec.label)}</span>` : ''}<strong class="score-scale__value">${escapeHtml(value)}</strong></div>
<div class="score-scale__track">${segments}<span class="score-scale__marker" style="left:${geometry.markerPercent}%"></span></div>
${spec.layout === 'equal' || spec.bands.length > 0 ? '' : `<div class="score-scale__ticks">${ticks}</div>`}
${legend}
${spec.text && options.text !== false ? `<p class="score-scale__text">${escapeHtml(spec.text)}</p>` : ''}
</figure>`;
}
