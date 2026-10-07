import { Popover } from '@kobalte/core/popover';
import { createSignal, type JSX } from 'solid-js';

import { Button } from '@/components/Button';
import {
  parseReaderPage,
  type ReaderPosition,
  readerPositionAriaLabel,
} from '@/features/library/document-reader-position';

import './reader-position.css';

/**
 * «12 / 48» in a reader: where the reader is, as a small pill. Tapping it opens a bubble with a
 * number field and «Перейти». The pill is a Kobalte popover trigger, which toggles by itself: a
 * second tap closes the bubble instead of reopening it.
 */
export function ReaderPositionCounter(props: {
  readonly position: ReaderPosition;
  readonly onGo: (page: number) => void;
  /** `chrome` in the reader's header, `outline` inside the contents list. */
  readonly variant: 'chrome' | 'outline';
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [invalid, setInvalid] = createSignal(false);
  let input: HTMLInputElement | undefined;

  const submit = (event: SubmitEvent): void => {
    event.preventDefault();
    const page = parseReaderPage(input?.value ?? '', props.position.total);
    if (page === null) {
      setInvalid(true);
      input?.select();
      return;
    }
    setOpen(false);
    props.onGo(page);
  };

  return (
    <Popover
      open={open()}
      onOpenChange={(value) => {
        setInvalid(false);
        setOpen(value);
      }}
      placement="bottom-end"
      gutter={6}
      flip
      slide
      fitViewport
      overflowPadding={8}
    >
      <Popover.Trigger
        class="reader-position"
        classList={{
          'reader-position--chrome': props.variant === 'chrome',
          'reader-position--outline': props.variant === 'outline',
        }}
        aria-label={readerPositionAriaLabel(props.position)}
        data-reader-position={props.variant}
      >
        <span class="reader-position__current">{props.position.current}</span>
        <span class="reader-position__separator" aria-hidden="true">
          /
        </span>
        <span class="reader-position__total">{props.position.total}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          class="reader-position__bubble"
          aria-label="Перейти к разделу"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            input?.focus();
            input?.select();
          }}
        >
          <form class="reader-position__form" onSubmit={submit}>
            <label class="reader-position__label">
              <span class="reader-position__label-text">Раздел</span>
              <input
                ref={(element) => {
                  input = element;
                }}
                class="reader-position__input"
                classList={{ 'reader-position__input--invalid': invalid() }}
                type="text"
                inputmode="numeric"
                autocomplete="off"
                enterkeyhint="go"
                aria-invalid={invalid()}
                value={String(props.position.current)}
                onInput={() => setInvalid(false)}
              />
            </label>
            <span class="reader-position__of">из {props.position.total}</span>
            <Button type="submit" variant="primary" class="reader-position__go">
              Перейти
            </Button>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
