/**
 * Class helpers of `StatCard` / `StatGrid`, kept out of the Solid files so they are unit-tested
 * without a DOM.
 */

/**
 * What the number says: `good` is the app's green («в норме», «выполнено»), `warn` amber («скоро»),
 * `danger` red («просрочено»), `accent` the blue information tone («план», «всего»).
 */
export type StatTone = 'default' | 'good' | 'warn' | 'danger' | 'accent';

export const STAT_TONES: readonly StatTone[] = ['default', 'good', 'warn', 'danger', 'accent'];

export type StatGridColumns = 2 | 3 | 4;

export interface StatCardClassState {
  readonly tone?: StatTone | undefined;
  readonly interactive: boolean;
  readonly pressed?: boolean | undefined;
  readonly class?: string | undefined;
}

export function statCardClass(state: StatCardClassState): string {
  const classes = ['ui-stat-card', `ui-stat-card--${state.tone ?? 'default'}`];
  if (state.interactive) classes.push('ui-stat-card--interactive');
  if (state.pressed) classes.push('ui-stat-card--pressed');
  if (state.class) classes.push(state.class);
  return classes.join(' ');
}

export function statGridClass(columns: StatGridColumns = 2, extra?: string): string {
  return ['ui-stat-grid', `ui-stat-grid--${columns}`, extra].filter(Boolean).join(' ');
}
