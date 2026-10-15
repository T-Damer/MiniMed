/** What Settings → «Поиск по смыслу» shows for the state of the query model. */
export interface SemanticSettingsState {
  /** `checking` until the platform decision and the cache state are read. */
  readonly source: 'checking' | 'bundled' | 'download';
  readonly installed: boolean;
  readonly removing: boolean;
  /** The model's task in the shared download queue, when it is active. */
  readonly task?: { readonly state: string; readonly fraction: number };
  readonly sizeLabel: string;
}

export interface SemanticSettingsView {
  readonly status: string;
  readonly tone: 'idle' | 'working' | 'ready';
  readonly actions: {
    readonly install: boolean;
    readonly cancel: boolean;
    readonly remove: boolean;
  };
}

/**
 * A bundled model (Android build) is part of the app: no download, no delete, no size offer. A
 * downloaded one (web, iOS) keeps its install / cancel / delete controls.
 */
export function semanticSettingsView(state: SemanticSettingsState): SemanticSettingsView {
  const none = { install: false, cancel: false, remove: false };
  if (state.source === 'checking') return { status: 'Проверяем…', tone: 'working', actions: none };
  if (state.source === 'bundled')
    return { status: 'Встроено в приложение', tone: 'ready', actions: none };
  if (state.removing) return { status: 'Удаляем…', tone: 'working', actions: none };
  if (state.task) {
    const status =
      state.task.state === 'verifying'
        ? 'Проверяем файлы…'
        : state.task.state === 'queued'
          ? 'В очереди'
          : `Скачивается · ${Math.floor(state.task.fraction * 100)}%`;
    return { status, tone: 'working', actions: { ...none, cancel: true } };
  }
  if (state.installed) {
    return { status: 'Готово к работе', tone: 'ready', actions: { ...none, remove: true } };
  }
  return {
    status: `Не скачано · ${state.sizeLabel}`,
    tone: 'idle',
    actions: { ...none, install: true },
  };
}
