import { type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { HorizontalScroller } from '@/components/HorizontalScroller';
import { MedicalImageTitle } from '@/features/library/MedicalImageTitle';

export function hasPhysicalKeyboard(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (navigator.maxTouchPoints === 0) return true;
  return (
    typeof globalThis.matchMedia === 'function' &&
    globalThis.matchMedia('(any-hover: hover) and (any-pointer: fine)').matches
  );
}

export function MedicalImageSliceIndicator(props: {
  readonly index: number;
  readonly count: number;
  readonly disabled: boolean;
  readonly onPointerDown: (event: PointerEvent) => void;
  readonly onPointerMove: (event: PointerEvent) => void;
  readonly onPointerUp: (event: PointerEvent) => void;
  readonly onPointerCancel: (event: PointerEvent) => void;
  readonly onKeyDown: (event: KeyboardEvent) => void;
}): JSX.Element {
  return (
    <span
      class="medical-image-viewer__slice"
      role="slider"
      tabIndex={props.disabled ? -1 : 0}
      aria-label="Номер среза"
      aria-disabled={props.disabled}
      aria-orientation="vertical"
      aria-valuemin={1}
      aria-valuemax={Math.max(1, props.count)}
      aria-valuenow={Math.max(1, props.index)}
      aria-valuetext={`${String(props.index)} из ${String(props.count)}`}
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onPointerCancel={props.onPointerCancel}
      onKeyDown={props.onKeyDown}
    >
      <span class="medical-image-viewer__slice-value">
        {props.count > 0 ? String(props.index) : '—'}
      </span>
      <span class="medical-image-viewer__slice-divider" aria-hidden="true" />
      <span class="medical-image-viewer__slice-value">
        {props.count > 0 ? String(props.count) : '—'}
      </span>
    </span>
  );
}

export function MedicalImageSliceNavigation(props: {
  readonly indicator: JSX.Element;
  readonly previousDisabled: boolean;
  readonly nextDisabled: boolean;
  readonly onPreviousStart: () => void;
  readonly onPreviousStop: () => void;
  readonly onPrevious: () => void;
  readonly onNextStart: () => void;
  readonly onNextStop: () => void;
  readonly onNext: () => void;
}): JSX.Element {
  return (
    <fieldset
      class="medical-image-viewer__slice-navigation"
      onContextMenu={(event) => event.preventDefault()}
    >
      <legend class="medical-image-viewer__tool-group-label">Навигация по срезам</legend>
      <Button
        class="medical-image-viewer__tool medical-image-viewer__tool--icon"
        variant="icon"
        aria-label="Предыдущий срез"
        title="Предыдущий срез"
        disabled={props.previousDisabled}
        onPointerDown={props.onPreviousStart}
        onPointerUp={props.onPreviousStop}
        onPointerCancel={props.onPreviousStop}
        onPointerLeave={props.onPreviousStop}
        onClick={props.onPrevious}
        icon={<AppGlyph name="caret-left" class="medical-image-viewer__tool-icon" />}
      />
      {props.indicator}
      <Button
        class="medical-image-viewer__tool medical-image-viewer__tool--icon"
        variant="icon"
        aria-label="Следующий срез"
        title="Следующий срез"
        disabled={props.nextDisabled}
        onPointerDown={props.onNextStart}
        onPointerUp={props.onNextStop}
        onPointerCancel={props.onNextStop}
        onPointerLeave={props.onNextStop}
        onClick={props.onNext}
        icon={<AppGlyph name="caret-right" class="medical-image-viewer__tool-icon" />}
      />
    </fieldset>
  );
}

export function MedicalImageViewerToolbar(props: {
  readonly title: string;
  readonly ariaLabel: string;
  readonly loading: boolean;
  readonly hasError: boolean;
  readonly detailsOpen: boolean;
  readonly showShortcuts: boolean;
  readonly onBack: () => void;
  readonly onPrint: () => void;
  readonly onReset: () => void;
  readonly onDetailsToggle: () => void;
  readonly sliceNavigation?: JSX.Element;
  readonly children: JSX.Element;
}): JSX.Element {
  return (
    <nav class="medical-image-viewer__toolbar" aria-label={props.ariaLabel}>
      <div class="medical-image-viewer__toolbar-top">
        <div class="medical-image-viewer__toolbar-top-leading">
          <Button
            class="medical-image-viewer__tool medical-image-viewer__tool--icon"
            variant="icon"
            aria-label="Вернуться к навигации (Backspace)"
            title="Вернуться к навигации (Backspace)"
            onClick={props.onBack}
            icon={
              <>
                <AppGlyph name="arrow-left" class="medical-image-viewer__tool-icon" />
                <Show when={props.showShortcuts}>
                  <span class="medical-image-viewer__tool-shortcut" aria-hidden="true">
                    (⌫)
                  </span>
                </Show>
              </>
            }
          />
          <MedicalImageTitle title={props.title} />
        </div>
        <div class="medical-image-viewer__toolbar-top-slice">
          <Show when={props.sliceNavigation}>{props.sliceNavigation}</Show>
        </div>
      </div>
      <div class="medical-image-viewer__toolbar-bottom">
        <HorizontalScroller
          class="medical-image-viewer__toolbar-scroll"
          controls
          hideScrollbar
          controlLabel="инструменты"
        >
          <div class="medical-image-viewer__toolbar-scroll-content">
            {props.children}
            <div class="medical-image-viewer__toolbar-bottom-actions">
              <Button
                class="medical-image-viewer__tool medical-image-viewer__tool--icon"
                variant={props.detailsOpen ? 'primary' : 'icon'}
                aria-label="Показать данные снимка (I)"
                title="Показать данные снимка (I)"
                aria-pressed={props.detailsOpen}
                aria-expanded={props.detailsOpen}
                onClick={props.onDetailsToggle}
                icon={
                  <>
                    <AppGlyph name="info" class="medical-image-viewer__tool-icon" />
                    <Show when={props.showShortcuts}>
                      <span class="medical-image-viewer__tool-shortcut" aria-hidden="true">
                        (i)
                      </span>
                    </Show>
                  </>
                }
              />
              <Button
                class="medical-image-viewer__tool medical-image-viewer__tool--icon"
                variant="icon"
                aria-label="Распечатать текущий кадр"
                title="Распечатать текущий кадр на листе A4"
                disabled={props.loading || props.hasError}
                onClick={props.onPrint}
                icon={<AppGlyph name="printer" class="medical-image-viewer__tool-icon" />}
              />
              <Button
                class="medical-image-viewer__tool medical-image-viewer__tool--icon"
                variant="icon"
                aria-label="Сбросить вид (R)"
                title="Сбросить вид (R)"
                disabled={props.loading}
                onClick={props.onReset}
                icon={
                  <>
                    <AppGlyph
                      name="arrow-counter-clockwise"
                      class="medical-image-viewer__tool-icon"
                    />
                    <Show when={props.showShortcuts}>
                      <span class="medical-image-viewer__tool-shortcut" aria-hidden="true">
                        (r)
                      </span>
                    </Show>
                  </>
                }
              />
            </div>
          </div>
        </HorizontalScroller>
      </div>
    </nav>
  );
}
