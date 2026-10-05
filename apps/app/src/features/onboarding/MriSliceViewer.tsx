import {
  createEffect,
  createResource,
  createSignal,
  createUniqueId,
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
 * How the frame and its attribution are laid out:
 * - `default`: the frame, then a caption with the source under it;
 * - `compact`: the frame beside its caption (the feature tour's short stage);
 * - `badge`: the frame alone; the caption and the source sit behind a small «?» on the image
 *   and open in a popover on click, so the picture does not take more of the screen than it needs.
 */
export type MriViewerVariant = 'default' | 'compact' | 'badge';

/** `children` (an action) follow the caption. `compact` is the older spelling of that variant. */
export function MriSliceViewer(props: {
  readonly variant?: MriViewerVariant;
  readonly compact?: boolean;
  readonly children?: JSX.Element;
}): JSX.Element {
  const [manifest] = createResource(loadMriManifest);
  const variant = (): MriViewerVariant => props.variant ?? (props.compact ? 'compact' : 'default');
  return (
    <Suspense>
      <Show when={manifest()}>
        {(loaded) => (
          <MriSlices manifest={loaded()} variant={variant()}>
            {props.children}
          </MriSlices>
        )}
      </Show>
    </Suspense>
  );
}

/** The «?» on the image and the popover it toggles: what the frames are and where they come from. */
function MriSourceHint(props: {
  readonly manifest: NonNullable<ReturnType<typeof parseMriManifest>>;
}): JSX.Element {
  const popoverId = createUniqueId();
  const [open, setOpen] = createSignal(false);
  let help: HTMLButtonElement | undefined;
  let popover: HTMLDivElement | undefined;
  // While the popover is open Escape and an outside tap close it, and only that: Escape must not
  // also skip the onboarding that hosts the picture.
  createEffect(() => {
    if (!open()) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      help?.focus({ preventScroll: true });
    };
    const onPointer = (event: PointerEvent): void => {
      const inside =
        event.target instanceof Node &&
        (popover?.contains(event.target) || help?.contains(event.target));
      if (!inside) setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    onCleanup(() => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
    });
  });
  return (
    <>
      <button
        ref={help}
        class="onboarding-mri__help"
        classList={{ 'onboarding-mri__help--open': open() }}
        type="button"
        aria-label="Об изображении и источнике"
        aria-expanded={open()}
        aria-controls={popoverId}
        onClick={() => setOpen((value) => !value)}
      >
        ?
      </button>
      <div
        ref={popover}
        id={popoverId}
        class="onboarding-mri__popover"
        classList={{ 'onboarding-mri__popover--open': open() }}
        role="note"
        aria-hidden={open() ? undefined : 'true'}
      >
        <span class="onboarding-mri__popover-text">
          Пример МРТ головы в просмотрщике MiniMed, сагиттальная плоскость.
        </span>
        <a
          class="onboarding-mri__source"
          href={props.manifest.source.url}
          target="_blank"
          rel="noreferrer noopener"
          title={`${props.manifest.source.author}. ${props.manifest.source.license}`}
        >
          {mriAttribution(props.manifest)}
        </a>
      </div>
    </>
  );
}

function MriSlices(props: {
  readonly manifest: NonNullable<ReturnType<typeof parseMriManifest>>;
  readonly variant: MriViewerVariant;
  readonly children?: JSX.Element;
}): JSX.Element {
  const compact = (): boolean => props.variant === 'compact';
  const badge = (): boolean => props.variant === 'badge';
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
    <figure
      class="onboarding-mri"
      classList={{ 'onboarding-mri--compact': compact(), 'onboarding-mri--badge': badge() }}
    >
      <div
        class="onboarding-mri__screen"
        classList={{ 'onboarding-mri__screen--compact': compact() }}
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
        <Show when={badge()}>
          <MriSourceHint manifest={props.manifest} />
        </Show>
      </div>
      <Show
        when={!badge()}
        fallback={
          <Show when={props.children}>
            <figcaption class="onboarding-mri__caption">{props.children}</figcaption>
          </Show>
        }
      >
        <figcaption
          class="onboarding-mri__caption"
          classList={{ 'onboarding-mri__caption--compact': compact() }}
        >
          <Show when={!compact()}>
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
      </Show>
    </figure>
  );
}
