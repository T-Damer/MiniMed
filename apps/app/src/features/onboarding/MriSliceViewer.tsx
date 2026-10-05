import {
  createEffect,
  createResource,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
  Suspense,
} from 'solid-js';
import { motionMs } from '@/state/motion';
import './mri-slice-viewer.css';
import { mriAttribution, parseMriManifest } from './onboarding-downloads';

/**
 * Real sagittal head-MRI frames captured from MiniMed's own viewer on the downloadable MRI example
 * (`public/onboarding/mri-viewer`, provenance in its SOURCES.md), cycling. Shared by the onboarding
 * step and the «Просмотр исследований» card of the feature tour.
 */
const MRI_FOLDER = 'onboarding/mri-viewer/';
const SLICE_INTERVAL_MS = 900;

function mriUrl(file: string): string {
  return new URL(`${MRI_FOLDER}${file}`, new URL(import.meta.env.BASE_URL, window.location.href))
    .href;
}

async function loadMriManifest(): Promise<ReturnType<typeof parseMriManifest>> {
  try {
    const response = await fetch(mriUrl('manifest.json'));
    if (!response.ok) return undefined;
    return parseMriManifest(await response.json());
  } catch (cause) {
    console.warn('Срезы МРТ для примера недоступны.', cause);
    return undefined;
  }
}

/**
 * `compact` lays the frame beside its caption (the feature tour's short stage); `children` (an action)
 * follow the caption.
 */
export function MriSliceViewer(props: {
  readonly compact?: boolean;
  readonly children?: JSX.Element;
}): JSX.Element {
  const [manifest] = createResource(loadMriManifest);
  return (
    <Suspense>
      <Show when={manifest()}>
        {(loaded) => (
          <MriSlices manifest={loaded()} compact={props.compact === true}>
            {props.children}
          </MriSlices>
        )}
      </Show>
    </Suspense>
  );
}

function MriSlices(props: {
  readonly manifest: NonNullable<ReturnType<typeof parseMriManifest>>;
  readonly compact: boolean;
  readonly children?: JSX.Element;
}): JSX.Element {
  const [index, setIndex] = createSignal(0);
  const slices = () => props.manifest.slices;
  createEffect(() => {
    if (motionMs(1) === 0 || slices().length < 2) return;
    const timer = setInterval(
      () => setIndex((value) => (value + 1) % slices().length),
      Math.max(SLICE_INTERVAL_MS, motionMs(SLICE_INTERVAL_MS)),
    );
    onCleanup(() => clearInterval(timer));
  });
  return (
    <figure class="onboarding-mri" classList={{ 'onboarding-mri--compact': props.compact }}>
      <div
        class="onboarding-mri__screen"
        classList={{ 'onboarding-mri__screen--compact': props.compact }}
      >
        <For each={slices()}>
          {(file, position) => (
            <img
              class="onboarding-mri__slice"
              classList={{ 'onboarding-mri__slice--active': position() === index() }}
              src={mriUrl(file)}
              alt={
                position() === index()
                  ? `МРТ головы, сагиттальный срез ${position() + 1} из ${slices().length}`
                  : ''
              }
              aria-hidden={position() === index() ? undefined : 'true'}
              width="640"
              height="640"
              decoding="async"
            />
          )}
        </For>
        <span class="onboarding-mri__label" aria-hidden="true">
          Срез {index() + 1} / {slices().length}
        </span>
      </div>
      <figcaption
        class="onboarding-mri__caption"
        classList={{ 'onboarding-mri__caption--compact': props.compact }}
      >
        <Show when={!props.compact}>
          <span>Пример МРТ головы в просмотрщике MiniMed, сагиттальная плоскость.</span>
        </Show>
        <a
          class="onboarding-mri__source"
          href={props.manifest.source.url}
          target="_blank"
          rel="noreferrer noopener"
          title={`${props.manifest.source.author}. ${props.manifest.source.license}`}
        >
          {mriAttribution(props.manifest)}
        </a>
        {props.children}
      </figcaption>
    </figure>
  );
}
