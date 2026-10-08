import { type Accessor, createSignal, onCleanup } from 'solid-js';

/** A mouse or trackpad that can hover: the only kind of device that drags a file onto a page. */
export const FINE_POINTER_QUERY = '(hover: hover) and (pointer: fine)';

/** Whether the main pointer is a mouse or trackpad now, updated when the input device changes. */
export function useFinePointer(): Accessor<boolean> {
  const query = window.matchMedia(FINE_POINTER_QUERY);
  const [fine, setFine] = createSignal(query.matches);
  const update = (): void => {
    setFine(query.matches);
  };
  query.addEventListener('change', update);
  onCleanup(() => query.removeEventListener('change', update));
  return fine;
}
