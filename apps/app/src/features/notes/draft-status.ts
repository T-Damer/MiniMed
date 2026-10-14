import { createSignal } from 'solid-js';

/** What an autosaved editor shows beside its fields. */
export type DraftState = 'idle' | 'saving' | 'saved' | 'draft';

export const DRAFT_STATE_LABELS: Readonly<Record<DraftState, string>> = {
  idle: '',
  saving: 'Сохраняем…',
  saved: 'Сохранено',
  draft: 'Черновик: исправьте отмеченное',
};

/**
 * State of one autosaved editor: nothing until the first change, «saving» while a change waits for
 * its vault write, «draft» while part of what was typed cannot be applied yet (inline errors show
 * which), «saved» otherwise.
 */
export function createDraftState(): {
  readonly state: () => DraftState;
  readonly touch: () => void;
  /** Back to «nothing typed yet» (another record is shown). */
  readonly reset: () => void;
  readonly setPending: (pending: boolean) => void;
  readonly setIncomplete: (incomplete: boolean) => void;
} {
  const [touched, setTouched] = createSignal(false);
  const [pending, setPending] = createSignal(false);
  const [incomplete, setIncomplete] = createSignal(false);
  return {
    state: () => {
      if (pending()) return 'saving';
      if (incomplete()) return 'draft';
      return touched() ? 'saved' : 'idle';
    },
    touch: () => setTouched(true),
    reset: () => {
      setTouched(false);
      setIncomplete(false);
    },
    setPending,
    setIncomplete,
  };
}
