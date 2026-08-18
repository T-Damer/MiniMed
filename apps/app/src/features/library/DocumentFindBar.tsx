import {
  createEffect,
  createSignal,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
  untrack,
} from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { SearchField } from '@/components/SearchField';
import {
  DOCUMENT_FIND_DEBOUNCE_MS,
  DOCUMENT_FIND_DISMISS_EVENT,
  type DocumentFindMatch,
  type DocumentFindMode,
  type DocumentFindUnit,
  stepDocumentFindIndex,
} from '@/features/library/document-find';
import { DocumentFindClient } from '@/features/library/document-find-client';
import { isFindShortcut } from '@/state/search-focus-target';

export interface DocumentFindResultState {
  readonly query: string;
  readonly mode: DocumentFindMode;
  readonly matches: readonly DocumentFindMatch[];
  readonly activeIndex: number;
  readonly loading: boolean;
}

export interface DocumentFindBarProps {
  readonly units: () => readonly DocumentFindUnit[];
  readonly class?: string;
  readonly hideLabel?: boolean;
  readonly allowWorker?: boolean;
  readonly disabled?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly onResult: (state: DocumentFindResultState) => void;
}

export function DocumentFindBar(props: DocumentFindBarProps): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [inputValue, setInputValue] = createSignal('');
  const [debouncedQuery, setDebouncedQuery] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  const [matches, setMatches] = createSignal<readonly DocumentFindMatch[]>([]);
  const [activeIndex, setActiveIndex] = createSignal(0);
  let root: HTMLDivElement | undefined;
  let searchInput: HTMLInputElement | undefined;

  const client = new DocumentFindClient(
    props.allowWorker === undefined ? {} : { allowWorker: props.allowWorker },
  );
  onCleanup(() => client.dispose());

  const mode = (): DocumentFindMode => 'exact';

  const notify = (overrides?: Partial<DocumentFindResultState>): void => {
    props.onResult({
      query: debouncedQuery(),
      mode: mode(),
      matches: matches(),
      activeIndex: activeIndex(),
      loading: loading(),
      ...overrides,
    });
  };

  const openFind = (): void => {
    if (props.disabled) return;
    setOpen(true);
    props.onOpenChange?.(true);
  };

  const closeFind = (): void => {
    setOpen(false);
    props.onOpenChange?.(false);
    setInputValue('');
    setDebouncedQuery('');
    setMatches([]);
    setActiveIndex(0);
    setLoading(false);
    props.onResult({
      query: '',
      mode: mode(),
      matches: [],
      activeIndex: 0,
      loading: false,
    });
  };

  createEffect(() => {
    if (!open()) return;
    queueMicrotask(() => {
      searchInput?.focus({ preventScroll: true });
    });
  });

  createEffect(() => {
    const value = inputValue();
    const timer = window.setTimeout(() => setDebouncedQuery(value), DOCUMENT_FIND_DEBOUNCE_MS);
    onCleanup(() => window.clearTimeout(timer));
  });

  createEffect(() => {
    client.setUnits(props.units());
  });

  createEffect(
    on(debouncedQuery, (query) => {
      const currentMode = mode();
      if (props.disabled) {
        setMatches([]);
        setActiveIndex(0);
        setLoading(false);
        untrack(() =>
          props.onResult({
            query: '',
            mode: currentMode,
            matches: [],
            activeIndex: 0,
            loading: false,
          }),
        );
        return;
      }
      if (!query.trim()) {
        setMatches([]);
        setActiveIndex(0);
        setLoading(false);
        untrack(() =>
          props.onResult({
            query: '',
            mode: currentMode,
            matches: [],
            activeIndex: 0,
            loading: false,
          }),
        );
        return;
      }
      setLoading(true);
      let cancelled = false;
      void client.find(query, currentMode).then((result) => {
        if (cancelled) return;
        setMatches(result);
        setActiveIndex(0);
        setLoading(false);
        props.onResult({
          query,
          mode: currentMode,
          matches: result,
          activeIndex: 0,
          loading: false,
        });
      });
      onCleanup(() => {
        cancelled = true;
      });
    }),
  );

  const step = (delta: number): void => {
    const count = matches().length;
    if (count === 0) return;
    const next = stepDocumentFindIndex(activeIndex(), count, delta);
    setActiveIndex(next);
    notify({ activeIndex: next });
  };

  const countLabel = (): string => {
    if (loading() || !debouncedQuery().trim()) return '';
    const count = matches().length;
    if (count === 0) return '0/0';
    return `${activeIndex() + 1}/${count}`;
  };

  onMount(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && open()) {
        event.preventDefault();
        closeFind();
        return;
      }
      if (open() || event.repeat || !isFindShortcut(event) || props.disabled) return;
      event.preventDefault();
      openFind();
    };
    const handleDismiss = (): void => {
      if (open()) closeFind();
    };
    window.addEventListener('keydown', handleKeyDown);
    root?.addEventListener(DOCUMENT_FIND_DISMISS_EVENT, handleDismiss);
    onCleanup(() => {
      window.removeEventListener('keydown', handleKeyDown);
      root?.removeEventListener(DOCUMENT_FIND_DISMISS_EVENT, handleDismiss);
    });
  });

  return (
    <div
      ref={(element) => {
        root = element;
      }}
      class={`document-find${props.class ? ` ${props.class}` : ''}`}
      classList={{ 'document-find--open': open() }}
      aria-busy={loading()}
    >
      <Show when={!open()}>
        <Button
          type="button"
          variant="icon"
          class="document-find__toggle"
          aria-label="Поиск в документе"
          disabled={props.disabled}
          onClick={openFind}
          icon={<AppGlyph name="search" class="document-find__toggle-icon" />}
        />
      </Show>
      <Show when={open()}>
        <SearchField
          class="document-find__search"
          id="document-find-input"
          label="Поиск в документе"
          hideLabel={props.hideLabel ?? true}
          value={inputValue()}
          onInput={setInputValue}
          placeholder="Слово или фраза"
          inputRef={(element) => {
            searchInput = element;
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              closeFind();
              return;
            }
            if (event.key !== 'Enter') return;
            event.preventDefault();
            step(event.shiftKey ? -1 : 1);
          }}
        />
        <div class="document-find__tools">
          <Button
            type="button"
            variant="icon"
            class="document-find__step"
            aria-label="Предыдущее совпадение"
            disabled={matches().length === 0}
            onClick={() => step(-1)}
            icon={<AppGlyph name="caret-up" class="document-find__step-icon" />}
          />
          <Button
            type="button"
            variant="icon"
            class="document-find__step"
            aria-label="Следующее совпадение"
            disabled={matches().length === 0}
            onClick={() => step(1)}
            icon={<AppGlyph name="caret-down" class="document-find__step-icon" />}
          />
          <div
            class="document-find__status"
            role="status"
            aria-live="polite"
            aria-label={countLabel() === '0/0' ? 'Нет совпадений' : undefined}
          >
            <Show when={loading()}>
              <span class="document-find__spinner" aria-hidden="true" />
            </Show>
            <Show when={countLabel()}>
              <span class="document-find__count">{countLabel()}</span>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}
