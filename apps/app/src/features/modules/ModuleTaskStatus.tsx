import { type JSX, Show } from 'solid-js';

interface ModuleTaskStatusProps {
  readonly label: string;
  readonly progress: number | null;
  readonly errorMessage?: string | null;
  readonly onOpenError: () => void;
}

export function ModuleTaskStatus(props: ModuleTaskStatusProps): JSX.Element {
  return (
    <Show
      when={props.errorMessage}
      fallback={
        <div class="module-task-status">
          <strong class="module-task-status__label">{props.label}</strong>
          <Show when={props.progress !== null}>
            <div class="module-task-progress">
              <span
                class="module-task-progress__fill"
                style={{ width: `${Math.round((props.progress ?? 0) * 100)}%` }}
              />
            </div>
          </Show>
        </div>
      }
    >
      <button
        type="button"
        class="module-task-status module-task-status--failed"
        onClick={props.onOpenError}
      >
        <strong class="module-task-status__label">Ошибка при загрузке</strong>
        <span class="module-task-progress">
          <span
            class="module-task-progress__fill module-task-progress__fill--failed"
            style={{ width: '100%' }}
          />
        </span>
      </button>
    </Show>
  );
}
