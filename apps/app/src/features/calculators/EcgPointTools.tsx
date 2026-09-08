import { For, type JSX, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { ECG_POINT_GROUPS, ECG_POINT_LABELS, type EcgPointKind, ecgRegionLabel } from './ecgEditor';
import type { EcgEditor } from './useEcgEditor';

export function EcgPointTools(props: {
  readonly editor: EcgEditor;
  readonly selectedPoint: string | undefined;
  readonly onSelectPoint: (id: string) => void;
  readonly onAdd: (kind: EcgPointKind) => void;
  readonly onFocus: () => void;
  readonly onDelete: () => void;
}): JSX.Element {
  const e = props.editor;
  return (
    <div class="ecg-editor__point-toolbar">
      <div class="ecg-editor__lead-tools">
        <select
          class="ecg-editor__select"
          aria-label="Отведение"
          value={e.activeRegion()}
          onChange={(event) => e.setActiveRegion(event.currentTarget.value)}
        >
          <For each={e.draft().regions}>
            {(region) => (
              <option value={region.id} selected={region.id === e.activeRegion()}>
                {ecgRegionLabel(region)}
              </option>
            )}
          </For>
        </select>
        <button
          class="ecg-editor__icon-button"
          type="button"
          aria-label="Приблизить отведение"
          title="Приблизить отведение"
          onClick={props.onFocus}
        >
          <AppGlyph class="ecg-editor__icon" name="frame-corners" />
        </button>
      </div>
      <Show when={e.step() === 4}>
        <div class="ecg-editor__point-tools" role="toolbar" aria-label="Добавить точку">
          <For each={ECG_POINT_GROUPS}>
            {(group) => (
              <Show
                when={group.kinds.length > 1}
                fallback={
                  <button
                    class="ecg-editor__wave-button"
                    type="button"
                    title="Добавить вершину R"
                    aria-label="Добавить R"
                    onClick={() => props.onAdd('rPeak')}
                  >
                    R
                  </button>
                }
              >
                <details class="ecg-editor__point-menu">
                  <summary class="ecg-editor__wave-button" aria-label={`Добавить ${group.label}`}>
                    {group.label}
                  </summary>
                  <div class="ecg-editor__point-options">
                    <For each={group.kinds}>
                      {(kind) => (
                        <button
                          class="ecg-editor__menu-button"
                          type="button"
                          onClick={(event) => {
                            props.onAdd(kind);
                            event.currentTarget.closest('details')?.removeAttribute('open');
                          }}
                        >
                          {ECG_POINT_LABELS[kind]}
                        </button>
                      )}
                    </For>
                  </div>
                </details>
              </Show>
            )}
          </For>
          <button
            class="ecg-editor__icon-button"
            type="button"
            aria-label="Добавить изолинию"
            title="Добавить изолинию"
            onClick={() => props.onAdd('baseline')}
          >
            <AppGlyph class="ecg-editor__icon" name="minus" />
          </button>
        </div>
        <div class="ecg-editor__point-selection">
          <select
            class="ecg-editor__select"
            aria-label="Выбранная точка"
            value={props.selectedPoint ?? ''}
            onChange={(event) => props.onSelectPoint(event.currentTarget.value)}
          >
            <option value="">Выберите точку</option>
            <For each={e.draft().points.filter((p) => p.regionId === e.activeRegion())}>
              {(point, index) => (
                <option value={point.id} selected={point.id === props.selectedPoint}>
                  {ECG_POINT_LABELS[point.kind]} · {index() + 1}
                </option>
              )}
            </For>
          </select>
          <button
            class="ecg-editor__icon-button"
            type="button"
            disabled={!props.selectedPoint}
            aria-label="Удалить точку"
            title="Удалить точку"
            onClick={props.onDelete}
          >
            <AppGlyph class="ecg-editor__icon" name="trash" />
          </button>
        </div>
      </Show>
    </div>
  );
}
