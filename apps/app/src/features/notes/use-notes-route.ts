import { createSignal, onCleanup, onMount } from 'solid-js';

import { type NotesRoute, readNotesRoute } from '@/features/notes/notes-routing';

export interface UseNotesRouteOptions {
  readonly onHashChange?: () => void;
}

export function useNotesRoute(options: UseNotesRouteOptions = {}): {
  readonly route: () => NotesRoute;
  readonly navigate: (path: string) => void;
} {
  const [route, setRoute] = createSignal<NotesRoute>(readNotesRoute());
  const handleHashChange = (): void => {
    options.onHashChange?.();
    setRoute(readNotesRoute());
  };

  onMount(() => {
    window.addEventListener('hashchange', handleHashChange);
  });
  onCleanup(() => window.removeEventListener('hashchange', handleHashChange));

  return {
    route,
    navigate: (path) => {
      window.location.hash = path;
    },
  };
}
