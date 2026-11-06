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

/**
 * A scatter of one point in a quadrant field (the temperament profile and similar schema charts),
 * drawn symmetrically: the field in the middle, the axis ends on its four sides. The same figure is
 * printed and shown on the result page (`block` names its CSS: `schema-chart-print` for paper,
 * `schema-chart` on screen), so the two always match. Empty for other chart types.
 */
export function assessmentChartPrintSvg(
  spec: CalculationChartSpec,
  block: 'schema-chart-print' | 'schema-chart' = 'schema-chart-print',
): string {
  if (spec.type === 'line') return lineProfileSvg(spec, block);
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
          `<circle class="${block}__ring" cx="${coordinate(rings.x, xMinimum, xMaximum, 52, 416)}" cy="${chartY(rings.y)}" r="${(288 * radius) / 100}" />`,
      )
      .join('') ?? '';
  const quadrantSvg = (() => {
    if (!quadrants) return '';
    const boundaryX = coordinate(quadrants.x, xMinimum, xMaximum, 52, 416);
    const boundaryY = chartY(quadrants.y);
    return `<line class="${block}__axis" x1="52" y1="${boundaryY}" x2="468" y2="${boundaryY}" />
  <line class="${block}__axis" x1="${boundaryX}" y1="42" x2="${boundaryX}" y2="330" />
  <text class="${block}__quadrant" x="${(52 + boundaryX) / 2}" y="${(42 + boundaryY) / 2}" text-anchor="middle">${escapeHtml(quadrants.labels.topLeft)}</text>
  <text class="${block}__quadrant" x="${(boundaryX + 468) / 2}" y="${(42 + boundaryY) / 2}" text-anchor="middle">${escapeHtml(quadrants.labels.topRight)}</text>
  <text class="${block}__quadrant" x="${(52 + boundaryX) / 2}" y="${(boundaryY + 330) / 2}" text-anchor="middle">${escapeHtml(quadrants.labels.bottomLeft)}</text>
  <text class="${block}__quadrant" x="${(boundaryX + 468) / 2}" y="${(boundaryY + 330) / 2}" text-anchor="middle">${escapeHtml(quadrants.labels.bottomRight)}</text>`;
  })();
  const ariaLabel = `${spec.title ?? ''}: ${point.x}%, ${point.y}%`;
  return `<figure class="${block}"><svg class="${block}__svg" viewBox="0 0 520 380" role="img" aria-label="${escapeHtml(ariaLabel)}">
  <rect class="${block}__field" x="52" y="42" width="416" height="288" rx="12" />
  ${ringSvg}
  ${quadrantSvg}
  <text class="${block}__axis-label" x="260" y="24" text-anchor="middle">${escapeHtml(spec.yAxis?.minimumLabel ?? spec.yAxis?.label ?? '')}</text>
  <text class="${block}__axis-label" x="260" y="374" text-anchor="middle">${escapeHtml(spec.yAxis?.maximumLabel ?? spec.yAxis?.label ?? '')}</text>
  <text class="${block}__axis-label" x="52" y="352">${escapeHtml(spec.xAxis?.minimumLabel ?? spec.xAxis?.label ?? '')}</text>
  <text class="${block}__axis-label" x="468" y="352" text-anchor="end">${escapeHtml(spec.xAxis?.maximumLabel ?? spec.xAxis?.label ?? '')}</text>
  <circle class="${block}__point-halo" cx="${x}" cy="${y}" r="12" />
  <circle class="${block}__point" cx="${x}" cy="${y}" r="6" />
  <text class="${block}__point-label" x="${x}" y="${Math.max(56, y - 17)}" text-anchor="middle">${point.x}% · ${point.y}%</text>
</svg>${spec.caption ? `<figcaption class="${block}__caption">${escapeHtml(spec.caption)}</figcaption>` : ''}</figure>`;
}

/** Steps of the value grid: about eight lines between the ends of the axis, on round numbers. */
function gridStep(minimum: number, maximum: number): number {
  const span = maximum - minimum;
  for (const step of [1, 2, 5, 10, 20, 25, 50, 100]) if (span / step <= 12) return step;
  return span / 10;
}

/**
 * A profile over category labels (a personality inventory's scales): the series with an `accent`
 * tone (or none) as a line with its values, and the series with a `neutral`, `warning` or `danger`
 * tone as dashed reference lines (the norm and the bounds of the normal range). The same figure on screen and on paper. Empty when a series
 * holds anything but numbers.
 */
function lineProfileSvg(
  spec: CalculationChartSpec,
  block: 'schema-chart-print' | 'schema-chart',
): string {
  const count = spec.labels.length;
  if (count < 2) return '';
  const series = spec.datasets.map((dataset) => ({
    dataset,
    values: dataset.data.filter((value): value is number => typeof value === 'number'),
  }));
  if (series.some(({ dataset, values }) => values.length !== dataset.data.length)) return '';
  const all = series.flatMap(({ values }) => values);
  const minimum = spec.yAxis?.minimum ?? Math.min(...all);
  const maximum = spec.yAxis?.maximum ?? Math.max(...all);
  if (!(maximum > minimum)) return '';
  const left = 44;
  const right = 508;
  const top = 18;
  const bottom = 300;
  const x = (index: number): number => left + 14 + ((right - left - 28) * index) / (count - 1);
  const y = (value: number): number =>
    bottom - coordinate(value, minimum, maximum, 0, bottom - top);
  const step = gridStep(minimum, maximum);
  const grid: string[] = [];
  for (let value = Math.ceil(minimum / step) * step; value <= maximum; value += step) {
    grid.push(
      `<line class="${block}__grid" x1="${left}" y1="${y(value)}" x2="${right}" y2="${y(value)}" />`,
      `<text class="${block}__grid-label" x="${left - 6}" y="${y(value) + 4}" text-anchor="end">${value}</text>`,
    );
  }
  const isReference = (tone: string | undefined): boolean =>
    tone === 'danger' || tone === 'warning' || tone === 'neutral';
  const references = series
    .filter(({ dataset }) => isReference(dataset.tone))
    .map(
      ({ dataset, values }) =>
        `<polyline class="${block}__reference ${block}__reference--${dataset.tone}" points="${values
          .map(
            (value, index) =>
              `${index === 0 ? left : index === count - 1 ? right : x(index)},${y(value)}`,
          )
          .join(' ')}"><title>${escapeHtml(dataset.label)}</title></polyline>`,
    );
  const profiles = series.filter(({ dataset }) => !isReference(dataset.tone));
  const lines = profiles.map(({ dataset, values }) => {
    const points = values.map((value, index) => `${x(index)},${y(value)}`).join(' ');
    const marks = values
      .map(
        (value, index) =>
          `<circle class="${block}__profile-point" cx="${x(index)}" cy="${y(value)}" r="5" /><text class="${block}__value-label" x="${x(index)}" y="${Math.max(top + 10, y(value) - 10)}" text-anchor="middle">${Math.round(value)}</text>`,
      )
      .join('');
    return `<g><title>${escapeHtml(dataset.label)}</title><polyline class="${block}__profile-line" points="${points}" />${marks}</g>`;
  });
  const categories = spec.labels
    .map(
      (label, index) =>
        `<text class="${block}__category-label" x="${x(index)}" y="${bottom + 22}" text-anchor="middle">${escapeHtml(label)}</text>`,
    )
    .join('');
  const summary = profiles
    .map(
      ({ dataset, values }) =>
        `${dataset.label}: ${values.map((value, index) => `${spec.labels[index]} ${Math.round(value)}`).join(', ')}`,
    )
    .join('; ');
  const yLabel = spec.yAxis?.label
    ? `<text class="${block}__axis-label" x="${left}" y="${top - 4}" text-anchor="end">${escapeHtml(spec.yAxis.label)}</text>`
    : '';
  return `<figure class="${block} ${block}--profile"><svg class="${block}__svg" viewBox="0 0 520 334" role="img" aria-label="${escapeHtml(`${spec.title ?? ''}: ${summary}`)}">
  <rect class="${block}__field" x="${left}" y="${top}" width="${right - left}" height="${bottom - top}" rx="8" />
  ${grid.join('')}
  ${references.join('')}
  ${lines.join('')}
  ${categories}
  ${yLabel}
</svg>${spec.caption ? `<figcaption class="${block}__caption">${escapeHtml(spec.caption)}</figcaption>` : ''}</figure>`;
}
