import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { Portal } from 'solid-js/web';

import { ROOT_VIEWS, type RootView } from '@/app/root-view';
import { AppGlyph } from '@/components/AppGlyph';
import type { createFloatingWindows, FloatingWindowState } from '@/state/floating-windows';

type FloatingWindowsManager = ReturnType<typeof createFloatingWindows>;

function viewLabel(view: RootView): string {
  return ROOT_VIEWS.find((item) => item.id === view)?.label ?? view;
}

function frameUrl(route: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set('minimed-floating', '1');
  url.searchParams.set('minimed-floating-scale', '1');
  url.hash = route;
  return url.href;
}

export function FloatingWindowLayer(props: {
  readonly manager: FloatingWindowsManager;
  readonly onClose: (id: string) => void;
}): JSX.Element {
  return (
    <Portal>
      <section
        class="floating-windows-layer"
        classList={{
          'floating-windows-layer--fullscreen': Boolean(props.manager.fullscreenWindowId()),
        }}
        aria-label="Мини-окна"
      >
        <For each={props.manager.windows().map((windowState) => windowState.id)}>
          {(id) => (
            <Show when={props.manager.windowFor(id)}>
              {(windowState) => (
                <FloatingWindowSlot
                  manager={props.manager}
                  windowState={windowState}
                  onClose={props.onClose}
                />
              )}
            </Show>
          )}
        </For>
      </section>
    </Portal>
  );
}

function FloatingWindowSlot(props: {
  readonly manager: FloatingWindowsManager;
  readonly windowState: () => FloatingWindowState;
  readonly onClose: (id: string) => void;
}): JSX.Element {
  const id = () => props.windowState().id;
  const view = () => props.windowState().view;
  const isActive = () => props.manager.activeWindowId() === id();
  const isFullscreen = () => props.manager.fullscreenWindowId() === id();
  const collapsed = () => props.windowState().collapsed;
  const isCollapsed = () => collapsed() && !isFullscreen();
  const [titleOverflows, setTitleOverflows] = createSignal(false);
  let title: HTMLElement | undefined;
  let titleText: HTMLSpanElement | undefined;

  const windowState = () => props.windowState();
  const displayWindowState = () => props.manager.displayWindowFor(id()) ?? windowState();
  const style = () => {
    const current = displayWindowState();
    if (isFullscreen()) {
      return {
        left: '0px',
        top: '0px',
        width: '100vw',
        height: '100dvh',
        'z-index': current.zIndex,
        transform: 'none',
      };
    }
    const offset = props.manager.cascadeOffsetFor(id());
    return {
      left: `${current.x}px`,
      top: `${current.y + offset.y}px`,
      width: `${current.width}px`,
      height: isCollapsed()
        ? 'calc(var(--floating-window-toolbar-height) + 2px)'
        : `${current.height}px`,
      'z-index': current.zIndex,
      transform: `translateX(${offset.x}px)`,
    };
  };

  onMount(() => {
    if (!title || !titleText) return;
    const measure = (): void => {
      setTitleOverflows(titleText.scrollWidth > title.clientWidth + 1);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(title);
    const frame = requestAnimationFrame(measure);
    onCleanup(() => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    });
  });

  return (
    <section
      class="floating-window"
      classList={{
        'floating-window--active': isActive(),
        'floating-window--inactive': !isActive(),
        'floating-window--stacked': props.manager.stacked(),
        'floating-window--resizing': props.manager.resizingWindowId() === id(),
        'floating-window--collapsed': isCollapsed(),
        'floating-window--fullscreen': isFullscreen(),
      }}
      style={style()}
    >
      <header
        class="floating-window__toolbar"
        classList={{ 'floating-window__toolbar--fullscreen': isFullscreen() }}
        onPointerDown={(event) => props.manager.beginDrag(id(), event)}
      >
        <button
          class="floating-window__button"
          type="button"
          disabled={!isActive()}
          aria-label="Закрыть маленькое окно"
          title="Закрыть маленькое окно"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => props.onClose(id())}
        >
          <AppGlyph name="close" class="floating-window__icon" />
        </button>
        <strong class="floating-window__title" ref={title}>
          <span
            class="floating-window__title-text"
            classList={{
              'floating-window__title-text--marquee': isCollapsed() && titleOverflows(),
            }}
            ref={titleText}
          >
            {viewLabel(view())}
          </span>
        </strong>
        <div class="floating-window__actions">
          <button
            class="floating-window__button floating-window__button--fullscreen"
            type="button"
            disabled={!isActive()}
            aria-label={isFullscreen() ? 'Свернуть в маленькое окно' : 'Открыть на весь экран'}
            title={isFullscreen() ? 'Свернуть в маленькое окно' : 'На весь экран'}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => props.manager.toggleFullscreen(id())}
          >
            <AppGlyph
              name={isFullscreen() ? 'arrows-in' : 'arrows-out'}
              class="floating-window__icon"
            />
          </button>
          <button
            class="floating-window__button"
            type="button"
            disabled={!isActive()}
            aria-label={
              isFullscreen()
                ? 'Свернуть в маленькое окно'
                : isCollapsed()
                  ? 'Развернуть маленькое окно'
                  : 'Свернуть маленькое окно'
            }
            title={
              isFullscreen()
                ? 'Свернуть в маленькое окно'
                : isCollapsed()
                  ? 'Развернуть'
                  : 'Свернуть'
            }
            aria-expanded={isFullscreen() || !isCollapsed()}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() =>
              isFullscreen()
                ? props.manager.toggleFullscreen(id())
                : props.manager.toggleCollapsed(id())
            }
          >
            <AppGlyph
              name={isCollapsed() ? 'caret-down' : 'caret-up'}
              class="floating-window__icon"
            />
          </button>
        </div>
      </header>
      <div
        class="floating-window__content"
        classList={{
          'floating-window__content--resizing': props.manager.resizingWindowId() === id(),
          'floating-window__content--collapsed': isCollapsed(),
        }}
      >
        <Show when={isActive()}>
          <FloatingWindowFrame
            manager={props.manager}
            id={id()}
            view={view()}
            route={windowState().route}
            resizing={props.manager.resizingWindowId() === id()}
            resizeWidth={windowState().width}
            resizeHeight={windowState().height}
          />
        </Show>
        <Show when={props.manager.isFrameLoading(id())}>
          <div class="floating-window__loading" role="status" aria-live="polite">
            <span class="floating-window__spinner" aria-hidden="true" />
            <span class="sr-only">Загрузка страницы</span>
          </div>
        </Show>
      </div>
      <span
        class="floating-window__resize-corner floating-window__resize-corner--nw"
        aria-hidden="true"
        onPointerDown={(event) => {
          event.stopPropagation();
          props.manager.beginResize(id(), event, 'nw');
        }}
      />
      <span
        class="floating-window__resize-corner floating-window__resize-corner--ne"
        aria-hidden="true"
        onPointerDown={(event) => {
          event.stopPropagation();
          props.manager.beginResize(id(), event, 'ne');
        }}
      />
      <span
        class="floating-window__resize-corner floating-window__resize-corner--sw"
        aria-hidden="true"
        onPointerDown={(event) => {
          event.stopPropagation();
          props.manager.beginResize(id(), event, 'sw');
        }}
      >
        <AppGlyph name="notches" class="floating-window__resize-icon" />
      </span>
      <span
        class="floating-window__resize-corner floating-window__resize-corner--se"
        aria-hidden="true"
        onPointerDown={(event) => {
          event.stopPropagation();
          props.manager.beginResize(id(), event, 'se');
        }}
      />
    </section>
  );
}

function FloatingWindowFrame(props: {
  readonly manager: FloatingWindowsManager;
  readonly id: string;
  readonly view: RootView;
  readonly route: string;
  readonly resizing: boolean;
  readonly resizeWidth: number;
  readonly resizeHeight: number;
}): JSX.Element {
  const source = frameUrl(props.route);
  let frame: HTMLIFrameElement | undefined;
  onCleanup(() => {
    if (frame) props.manager.unbindFrame(props.id, frame);
  });
  return (
    <iframe
      class="floating-window__frame"
      classList={{ 'floating-window__frame--resizing': props.resizing }}
      style={
        props.resizing
          ? { width: `${props.resizeWidth}px`, height: `${props.resizeHeight}px` }
          : undefined
      }
      ref={(element) => {
        frame = element;
        props.manager.bindFrame(props.id, element);
      }}
      src={source}
      title={viewLabel(props.view)}
      loading={props.manager.activeWindowId() === props.id ? 'eager' : 'lazy'}
    />
  );
}
