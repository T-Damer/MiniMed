import Chart from 'chart.js/auto';
import { createEffect, onCleanup, onMount } from 'solid-js';
import type { CalculationChartSpec } from '@/features/calculators/clinical-calculations';

/**
 * Renders a serializable chart spec produced by a schema visual. The spec is data (evaluated by the
 * calculation engine), so this component never executes calculator logic — it only draws.
 */
export function CalculatorChart(props: {
  readonly title: string;
  readonly spec: CalculationChartSpec;
  readonly heightPx?: number;
}) {
  let canvas: HTMLCanvasElement | undefined;

  const buildData = () => ({
    labels: [...props.spec.labels],
    datasets: props.spec.datasets.map((dataset) => ({
      label: dataset.label,
      data: [...dataset.data],
    })),
  });

  onMount(() => {
    if (!canvas) return;
    let lastSerialized = JSON.stringify(buildData()) + props.title;
    const chart = new Chart(canvas, {
      type: props.spec.type,
      data: buildData(),
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: { display: true, text: props.title },
          legend: {
            display:
              props.spec.datasets.length > 1 ||
              props.spec.type === 'pie' ||
              props.spec.type === 'doughnut',
          },
        },
      },
    });

    createEffect(() => {
      const serialized = JSON.stringify(buildData()) + props.title;
      if (serialized === lastSerialized) return;
      lastSerialized = serialized;
      chart.data = buildData();
      chart.update();
    });

    onCleanup(() => chart.destroy());
  });

  return (
    <figure class="calculator-chart">
      <div style={{ position: 'relative', height: `${props.heightPx ?? 220}px` }}>
        <canvas ref={canvas} role="img" aria-label={props.title} />
      </div>
    </figure>
  );
}
