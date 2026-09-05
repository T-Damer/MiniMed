import type { CalculationChartSpec } from '@/features/calculators/clinical-calculations';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function coordinate(value: number, minimum: number, maximum: number, start: number, size: number) {
  return (
    start + ((Math.min(maximum, Math.max(minimum, value)) - minimum) / (maximum - minimum)) * size
  );
}

export function assessmentChartPrintSvg(spec: CalculationChartSpec): string {
  if (spec.type !== 'scatter') return '';
  const point = spec.datasets
    .flatMap((dataset) => dataset.data)
    .find((value): value is { x: number; y: number } => typeof value === 'object');
  if (!point) return '';
  const xMinimum = spec.xAxis?.minimum ?? 0;
  const xMaximum = spec.xAxis?.maximum ?? 100;
  const yMinimum = spec.yAxis?.minimum ?? 0;
  const yMaximum = spec.yAxis?.maximum ?? 100;
  if (xMinimum === xMaximum || yMinimum === yMaximum) return '';
  const x = coordinate(point.x, xMinimum, xMaximum, 52, 416);
  const yValue = coordinate(point.y, yMinimum, yMaximum, 42, 288);
  const y = spec.yAxis?.reverse ? yValue : 372 - yValue;
  const quadrants = spec.annotations?.find((annotation) => annotation.kind === 'quadrants');
  const rings = spec.annotations?.find((annotation) => annotation.kind === 'rings');
  const chartY = (value: number): number => {
    const resolved = coordinate(value, yMinimum, yMaximum, 42, 288);
    return spec.yAxis?.reverse ? resolved : 372 - resolved;
  };
  const ringSvg =
    rings?.radiusPercent
      .map(
        (radius) =>
          `<circle class="schema-chart-print__ring" cx="${coordinate(rings.x, xMinimum, xMaximum, 52, 416)}" cy="${chartY(rings.y)}" r="${(288 * radius) / 100}" />`,
      )
      .join('') ?? '';
  const quadrantSvg = (() => {
    if (!quadrants) return '';
    const boundaryX = coordinate(quadrants.x, xMinimum, xMaximum, 52, 416);
    const boundaryY = chartY(quadrants.y);
    return `<line class="schema-chart-print__axis" x1="52" y1="${boundaryY}" x2="468" y2="${boundaryY}" />
  <line class="schema-chart-print__axis" x1="${boundaryX}" y1="42" x2="${boundaryX}" y2="330" />
  <text class="schema-chart-print__quadrant" x="${(52 + boundaryX) / 2}" y="${(42 + boundaryY) / 2}" text-anchor="middle">${escapeHtml(quadrants.labels.topLeft)}</text>
  <text class="schema-chart-print__quadrant" x="${(boundaryX + 468) / 2}" y="${(42 + boundaryY) / 2}" text-anchor="middle">${escapeHtml(quadrants.labels.topRight)}</text>
  <text class="schema-chart-print__quadrant" x="${(52 + boundaryX) / 2}" y="${(boundaryY + 330) / 2}" text-anchor="middle">${escapeHtml(quadrants.labels.bottomLeft)}</text>
  <text class="schema-chart-print__quadrant" x="${(boundaryX + 468) / 2}" y="${(boundaryY + 330) / 2}" text-anchor="middle">${escapeHtml(quadrants.labels.bottomRight)}</text>`;
  })();
  const ariaLabel = `${spec.title ?? ''}: ${point.x}%, ${point.y}%`;
  return `<figure class="schema-chart-print"><svg class="schema-chart-print__svg" viewBox="0 0 520 380" role="img" aria-label="${escapeHtml(ariaLabel)}">
  <rect class="schema-chart-print__field" x="52" y="42" width="416" height="288" rx="12" />
  ${ringSvg}
  ${quadrantSvg}
  <text class="schema-chart-print__axis-label" x="260" y="24" text-anchor="middle">${escapeHtml(spec.yAxis?.minimumLabel ?? spec.yAxis?.label ?? '')}</text>
  <text class="schema-chart-print__axis-label" x="260" y="374" text-anchor="middle">${escapeHtml(spec.yAxis?.maximumLabel ?? spec.yAxis?.label ?? '')}</text>
  <text class="schema-chart-print__axis-label" x="52" y="352">${escapeHtml(spec.xAxis?.minimumLabel ?? spec.xAxis?.label ?? '')}</text>
  <text class="schema-chart-print__axis-label" x="468" y="352" text-anchor="end">${escapeHtml(spec.xAxis?.maximumLabel ?? spec.xAxis?.label ?? '')}</text>
  <circle class="schema-chart-print__point-halo" cx="${x}" cy="${y}" r="12" />
  <circle class="schema-chart-print__point" cx="${x}" cy="${y}" r="6" />
  <text class="schema-chart-print__point-label" x="${x}" y="${Math.max(56, y - 17)}" text-anchor="middle">${point.x}% · ${point.y}%</text>
</svg>${spec.caption ? `<figcaption class="schema-chart-print__caption">${escapeHtml(spec.caption)}</figcaption>` : ''}</figure>`;
}
