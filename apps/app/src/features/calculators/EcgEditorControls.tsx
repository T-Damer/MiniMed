import { For, type JSX, Show } from 'solid-js';
import {
  type EcgEditorLayout,
  ecgCalibrationScale,
  ecgRegionLabel,
  ecgRegionTemplate,
} from './ecgEditor';
import type { EcgEditor } from './useEcgEditor';

export function EcgEditorControls(props: {
  readonly editor: EcgEditor;
  readonly calibrationTool: 'horizontal' | 'vertical' | 'pan';
  readonly onCalibrationTool: (tool: 'horizontal' | 'vertical' | 'pan') => void;
}): JSX.Element {
  const e = props.editor;
  return (
    <div class="ecg-editor__step-controls">
      <Show when={e.step() === 2}>
        <div class="ecg-editor__control-row">
          <label class="ecg-editor__field">
            Скорость
            <select
              class="ecg-editor__select"
              value={e.draft().calibration.speed}
              onChange={(event) => {
                const speed = Number(event.currentTarget.value);
                if (speed !== 25 && speed !== 50) return;
                e.commit({ ...e.draft(), calibration: { ...e.draft().calibration, speed } });
              }}
            >
              <option value="25">25 мм/с</option>
              <option value="50">50 мм/с</option>
            </select>
          </label>
          <label class="ecg-editor__field">
            Усиление
            <select
              class="ecg-editor__select"
              value={e.draft().calibration.gain}
              onChange={(event) => {
                const gain = Number(event.currentTarget.value);
                if (gain !== 5 && gain !== 10 && gain !== 20) return;
                e.commit({ ...e.draft(), calibration: { ...e.draft().calibration, gain } });
              }}
            >
              <option value="5">5 мм/мВ</option>
              <option value="10">10 мм/мВ</option>
              <option value="20">20 мм/мВ</option>
            </select>
          </label>
          <label class="ecg-editor__field">
            Возраст
            <select
              class="ecg-editor__select"
              value={e.patientRoute()}
              onChange={(event) => {
                const value = event.currentTarget.value;
                e.setPatientRoute(
                  value === 'adult' ? 'adult' : value === 'pediatric' ? 'pediatric' : 'unknown',
                );
              }}
            >
              <option value="unknown">Не указан</option>
              <option value="adult">18 лет и старше</option>
              <option value="pediatric">Младше 18 лет</option>
            </select>
          </label>
          <label class="ecg-editor__field">
            Пол для QTc
            <select
              class="ecg-editor__select"
              value={e.sex() ?? 'unknown'}
              onChange={(event) => {
                const value = event.currentTarget.value;
                e.setSex(value === 'male' || value === 'female' ? value : 'unknown');
              }}
            >
              <option value="unknown">Не указан</option>
              <option value="male">Мужской</option>
              <option value="female">Женский</option>
            </select>
          </label>
        </div>
        <div class="ecg-editor__control-row">
          <button
            class="ecg-editor__button"
            classList={{ 'ecg-editor__button--active': props.calibrationTool === 'horizontal' }}
            type="button"
            onClick={() => props.onCalibrationTool('horizontal')}
          >
            Отметить 25 мм ↔
          </button>
          <button
            class="ecg-editor__button"
            classList={{ 'ecg-editor__button--active': props.calibrationTool === 'vertical' }}
            type="button"
            onClick={() => props.onCalibrationTool('vertical')}
          >
            Отметить 10 мм ↕
          </button>
          <button
            class="ecg-editor__button"
            type="button"
            onClick={() => props.onCalibrationTool('pan')}
          >
            Двигать снимок
          </button>
        </div>
        <p class="ecg-editor__instruction">
          {props.calibrationTool === 'horizontal'
            ? 'Протяните линию на 5 больших клеток по горизонтали.'
            : props.calibrationTool === 'vertical'
              ? 'Протяните линию на 2 большие клетки по вертикали.'
              : 'Проверьте сетку: 5 больших клеток по горизонтали и 2 по вертикали. Границы можно двигать.'}
        </p>
      </Show>
      <Show when={e.step() === 3}>
        <div class="ecg-editor__control-row">
          <label class="ecg-editor__field">
            Расположение отведений
            <select
              class="ecg-editor__select"
              value={e.draft().regions.length === 12 ? '12x1' : '3x4+1R'}
              onChange={(event) => {
                const layout: EcgEditorLayout =
                  event.currentTarget.value === '12x1' ? '12x1' : '3x4+1R';
                e.commit({ ...e.draft(), regions: ecgRegionTemplate(layout), points: [] });
                const id = layout === '12x1' ? 'II' : 'rhythm-II';
                e.setActiveRegion(id);
                e.setMeasurementRegion(id);
              }}
            >
              <option value="3x4+1R">3 × 4 + ритм II</option>
              <option value="12x1">12 отдельных строк</option>
            </select>
          </label>
          <p class="ecg-editor__instruction">
            {e.maps()
              ? 'Проверьте предложенные области.'
              : 'Показан шаблон, а не результат распознавания.'}{' '}
            Перемещайте рамки и их углы, оставляя внутри только нужное отведение.
          </p>
        </div>
      </Show>
      <Show when={e.step() === 4}>
        <div class="ecg-editor__control-row">
          <label class="ecg-editor__field">
            Отведение для расчёта
            <select
              class="ecg-editor__select"
              value={e.measurementRegion()}
              onChange={(event) => e.setMeasurementRegion(event.currentTarget.value)}
            >
              <For each={e.draft().regions}>
                {(region) => (
                  <option value={region.id} selected={region.id === e.measurementRegion()}>
                    {ecgRegionLabel(region)}
                  </option>
                )}
              </For>
            </select>
          </label>
          <button
            class="ecg-editor__button"
            type="button"
            disabled={!e.maps() || e.digitizing()}
            onClick={e.generatePoints}
          >
            Заново расставить точки
          </button>
        </div>
        <p class="ecg-editor__instruction">
          Проверьте границы одного комплекса и минимум две последовательные вершины R. Кнопки PQRST
          добавляют точки; перетаскивайте их на кривую. Отсутствующие P или T не добавляйте.
        </p>
      </Show>
    </div>
  );
}

export function EcgEditorConfirmation(props: { readonly editor: EcgEditor }): JSX.Element {
  const e = props.editor;
  return (
    <div class="ecg-editor__confirmation">
      <Show when={e.step() === 2}>
        <label class="ecg-editor__check-label">
          <input
            class="ecg-editor__checkbox"
            type="checkbox"
            checked={e.calibrationConfirmed()}
            disabled={!ecgCalibrationScale(e.draft().calibration)}
            onChange={(event) => e.confirmCalibration(event.currentTarget.checked)}
          />
          Скорость, усиление и обе шкалы проверены
        </label>
      </Show>
      <Show when={e.step() === 3}>
        <label class="ecg-editor__check-label">
          <input
            class="ecg-editor__checkbox"
            type="checkbox"
            checked={e.regionsConfirmed()}
            onChange={(event) => e.confirmRegions(event.currentTarget.checked)}
          />
          Области всех отведений проверены
        </label>
      </Show>
      <Show when={e.step() === 4}>
        <label class="ecg-editor__check-label">
          <input
            class="ecg-editor__checkbox"
            type="checkbox"
            checked={e.pointsConfirmed()}
            disabled={!e.canReviewPoints()}
            onChange={(event) => e.confirmPoints(event.currentTarget.checked)}
          />
          Точки в отведении для расчёта проверены по ЭКГ
        </label>
        <Show when={!e.canReviewPoints()}>
          <span class="ecg-editor__hint">
            {e.measurement().errors[0] ??
              'Для продолжения нужны минимум две точки R, начало и конец QRS.'}
          </span>
        </Show>
      </Show>
    </div>
  );
}
