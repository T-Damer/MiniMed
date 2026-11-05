import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import type { DoctorDiaries } from '@/features/diary/connected/doctor-workspace';
import { type Curator, loadCurators } from '@/features/diary/dashboard/curators';

const SHOWN = 3;

/**
 * The doctors who curate this patient, as overlapping avatars at the right of a list row. A
 * patient with one curator (the doctor) shows nothing. The members are read once the row comes
 * near the screen, one request per patient (`loadCurators` keeps them for a few minutes), so a
 * long list does not ask for every patient at once.
 */
export function CuratorStack(props: {
  readonly workspace: DoctorDiaries;
  readonly patientId: string;
}): JSX.Element {
  const [curators, setCurators] = createSignal<readonly Curator[]>([]);
  let host: HTMLSpanElement | undefined;
  onMount(() => {
    if (!host) return;
    let stopped = false;
    const read = (): void => {
      loadCurators(props.workspace, props.patientId).then(
        (found) => {
          if (!stopped) setCurators(found);
        },
        (cause: unknown) => {
          console.warn('Врачи пациента не прочитаны', cause);
        },
      );
    };
    if (typeof IntersectionObserver === 'undefined') {
      read();
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        read();
      },
      { rootMargin: '240px 0px' },
    );
    observer.observe(host);
    onCleanup(() => {
      stopped = true;
      observer.disconnect();
    });
  });
  const shared = (): boolean => curators().length > 1;
  const more = (): number => Math.max(0, curators().length - SHOWN);
  return (
    <span
      ref={(element) => {
        host = element;
      }}
      class="diary-curators"
      classList={{ 'diary-curators--shared': shared() }}
      {...(shared()
        ? {
            role: 'img',
            'aria-label': `Ведут пациента: ${curators()
              .map((curator) => curator.name)
              .join(', ')}`,
            title: curators()
              .map((curator) => curator.name)
              .join(', '),
          }
        : { 'aria-hidden': 'true' })}
    >
      <Show when={shared()}>
        <For each={curators().slice(0, SHOWN)}>
          {(curator, index) => (
            <span
              class="diary-curators__avatar"
              style={{ '--curator-hue': String(curator.hue), '--curator-index': String(index()) }}
            >
              {curator.initials}
            </span>
          )}
        </For>
        <Show when={more() > 0}>
          <span class="diary-curators__avatar diary-curators__avatar--more">+{more()}</span>
        </Show>
      </Show>
    </span>
  );
}
