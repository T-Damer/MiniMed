import { createEffect, type JSX } from 'solid-js';

/** An absent value is indeterminate; assigning undefined to the DOM property throws. */
export function DownloadProgress(props: {
  readonly value: number | undefined;
  readonly label: string;
}): JSX.Element {
  let progress: HTMLProgressElement | undefined;
  createEffect(() => {
    const value = props.value;
    if (!progress) return;
    if (value === undefined || !Number.isFinite(value)) progress.removeAttribute('value');
    else progress.value = Math.min(100, Math.max(0, value));
  });
  return (
    <progress
      ref={(element) => { progress = element; }}
      class="package-row__progress"
      max={100}
      aria-label={props.label}
    />
  );
}
