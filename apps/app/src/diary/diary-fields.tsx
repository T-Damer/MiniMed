import { type JSX, Show } from 'solid-js';

/** Label, optional hint and the error of one field, wired to the control for screen readers. */
export function Field(props: {
  readonly id: string;
  readonly label: string;
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
  /** A group of buttons has a legend instead of a label. */
  readonly group?: boolean;
  readonly children: JSX.Element;
}): JSX.Element {
  const body = (
    <>
      <Show when={props.hint}>
        <span class="diary-field__hint" id={`${props.id}-hint`}>
          {props.hint}
        </span>
      </Show>
      {props.children}
      <Show when={props.error}>
        <p class="diary-field__error" id={`${props.id}-error`} role="alert">
          {props.error}
        </p>
      </Show>
    </>
  );
  return (
    <Show
      when={props.group}
      fallback={
        <div class="diary-field" classList={{ 'diary-field--invalid': Boolean(props.error) }}>
          <label class="diary-field__label" for={props.id}>
            {props.label}
          </label>
          {body}
        </div>
      }
    >
      <fieldset class="diary-field" classList={{ 'diary-field--invalid': Boolean(props.error) }}>
        <legend class="diary-field__label">{props.label}</legend>
        {body}
      </fieldset>
    </Show>
  );
}

/** A big multi-line box for pasted links and text, with its label in readable size. */
export function TextBlock(props: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly rows?: number;
  readonly plain?: boolean;
  readonly onInput: (value: string) => void;
}): JSX.Element {
  return (
    <div class="diary-field">
      <label class="diary-field__label" for={props.id}>
        {props.label}
      </label>
      <textarea
        id={props.id}
        class="diary-field__input diary-field__input--text"
        rows={props.rows ?? 4}
        value={props.value}
        autocomplete="off"
        autocapitalize={props.plain ? 'off' : undefined}
        spellcheck={props.plain ? false : undefined}
        onInput={(event) => props.onInput(event.currentTarget.value)}
      />
    </div>
  );
}
