import { type JSX, Show } from 'solid-js';
import { EcgStepGuide } from './EcgEditorFlow';
import { type EcgEditorLayout, ecgRegionTemplate } from './ecgEditor';
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
              classList={{
                'ecg-editor__select--required': e.draft().calibration.speed === undefined,
              }}
              value={e.draft().calibration.speed ?? ''}
              onChange={(event) => {
                const speed = Number(event.currentTarget.value);
                if (speed !== 25 && speed !== 50) return;
                e.commit({ ...e.draft(), calibration: { ...e.draft().calibration, speed } });
              }}
            >
              <option value="" disabled>
                По надписи на ленте
              </option>
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
        <EcgStepGuide step={2} />
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
                e.selectMeasuredLead(id);
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
        <EcgStepGuide step={3} />
      </Show>
      <Show when={e.step() === 4}>
        <div class="ecg-editor__control-row">
          <p class="ecg-editor__instruction ecg-editor__instruction--grow">
            Выберите на панели отведение с чёткими зубцами. Проверьте границы одного комплекса и
            минимум две соседние вершины R; отсутствующие P или T не добавляйте.
          </p>
          <button
            class="ecg-editor__button"
            type="button"
            disabled={!e.maps() || e.digitizing()}
            onClick={e.generatePoints}
          >
            Заново расставить точки
          </button>
        </div>
        <ul class="ecg-legend" aria-label="Цвета точек">
          <li class="ecg-legend__item ecg-legend__item--p">P</li>
          <li class="ecg-legend__item ecg-legend__item--qrs">QRS</li>
          <li class="ecg-legend__item ecg-legend__item--t">T</li>
          <li class="ecg-legend__item ecg-legend__item--baseline">изолиния</li>
          <li class="ecg-legend__item ecg-legend__item--auto">пунктир — авто</li>
        </ul>
        <EcgStepGuide step={4} />
      </Show>
    </div>
  );
}
