import { For, type JSX } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { InstallGlyph } from '@/diary/install-glyphs';
import type { InstallGuideKind } from '@/features/diary/diary-install';

import '@/diary/install-guide.css';

/**
 * Miniatures of the real browser screens, drawn in HTML and CSS. A scene gets the current step
 * (0-based) and only toggles state classes; the transitions live in `install-guide.css`. Every
 * scene is decoration: the numbered step list beside it carries the same words for screen readers.
 */
type StepFn = () => number;

function Ripple(props: { readonly on: boolean }): JSX.Element {
  return (
    <span class="install-scene__ripple" classList={{ 'install-scene__ripple--tap': props.on }} />
  );
}

function Page(): JSX.Element {
  return (
    <div class="install-scene__page">
      <span class="install-scene__page-title">Дневник</span>
      <span class="install-scene__bar install-scene__bar--wide" />
      <span class="install-scene__bar" />
      <span class="install-scene__bar install-scene__bar--short" />
    </div>
  );
}

function AppIcon(props: { readonly small?: boolean }): JSX.Element {
  return (
    <span
      class="install-scene__app"
      classList={{ 'install-scene__app--small': props.small ?? false }}
    >
      <AppGlyph name="heartbeat" class="install-scene__app-glyph" />
    </span>
  );
}

/** The phone's home screen; the diary icon pops into the last free slot. */
function Home(props: { readonly shown: boolean }): JSX.Element {
  const dummies = [0, 1, 2, 3, 4, 5, 6];
  return (
    <div
      class="install-layer install-layer--fade install-scene__home"
      classList={{ 'install-layer--on': props.shown }}
    >
      <div class="install-scene__grid">
        <For each={dummies}>
          {() => (
            <span class="install-scene__slot">
              <span class="install-scene__tile" />
            </span>
          )}
        </For>
        <span class="install-scene__slot">
          <span
            class="install-scene__newapp"
            classList={{ 'install-scene__newapp--in': props.shown }}
          >
            <AppIcon />
            <span class="install-scene__newapp-label">Дневник</span>
          </span>
        </span>
      </div>
    </div>
  );
}

function AddressPill(props: { readonly children?: JSX.Element }): JSX.Element {
  return (
    <span class="install-scene__pill">
      <InstallGlyph name="lock" class="install-scene__pill-lock" />
      <span class="install-scene__pill-text">дневник</span>
      {props.children}
    </span>
  );
}

function AndroidScene(props: { readonly step: StepFn }): JSX.Element {
  const s = props.step;
  return (
    <div class="install-scene__phone">
      <Page />
      <div class="install-scene__topbar">
        <AddressPill />
        <span
          class="install-scene__button install-hot"
          classList={{ 'install-hot--on': s() === 0 }}
        >
          <AppGlyph name="dots-three-vertical" class="install-scene__button-glyph" />
          <Ripple on={s() === 0} />
        </span>
      </div>
      <span
        class="install-layer install-layer--fade install-scene__scrim"
        classList={{ 'install-layer--on': s() === 2 }}
      />
      <div
        class="install-layer install-layer--pop install-scene__menu"
        classList={{ 'install-layer--on': s() === 1 }}
      >
        <span class="install-scene__row">Новая вкладка</span>
        <span class="install-scene__row">Закладки</span>
        <span class="install-scene__row install-hot" classList={{ 'install-hot--on': s() === 1 }}>
          Добавить на гл. экран
          <Ripple on={s() === 1} />
        </span>
        <span class="install-scene__row">Настройки</span>
      </div>
      <div
        class="install-layer install-layer--rise install-scene__dialog"
        classList={{ 'install-layer--on': s() === 2 }}
      >
        <span class="install-scene__dialog-title">Добавить на главный экран</span>
        <span class="install-scene__field">
          <AppIcon small />
          Дневник
        </span>
        <span class="install-scene__actions">
          <span class="install-scene__action">Создать ярлык</span>
          <span
            class="install-scene__action install-scene__action--primary install-hot"
            classList={{ 'install-hot--on': s() === 2 }}
          >
            Установить
            <Ripple on={s() === 2} />
          </span>
        </span>
      </div>
      <Home shown={s() === 3} />
    </div>
  );
}

function IphoneScene(props: { readonly step: StepFn }): JSX.Element {
  const s = props.step;
  return (
    <div class="install-scene__phone">
      <Page />
      <div class="install-scene__bottombar">
        <span class="install-scene__button">
          <AppGlyph name="caret-left" class="install-scene__button-glyph" />
        </span>
        <AddressPill />
        <span
          class="install-scene__button install-hot"
          classList={{ 'install-hot--on': s() === 0 }}
        >
          <AppGlyph name="dots-three" class="install-scene__button-glyph" />
          <Ripple on={s() === 0} />
        </span>
      </div>
      <span
        class="install-layer install-layer--fade install-scene__scrim"
        classList={{ 'install-layer--on': s() >= 2 && s() <= 3 }}
      />
      <div
        class="install-layer install-layer--pop install-scene__menu install-scene__menu--bottom"
        classList={{ 'install-layer--on': s() === 1 }}
      >
        <span class="install-scene__row">Закладки</span>
        <span class="install-scene__row install-hot" classList={{ 'install-hot--on': s() === 1 }}>
          Поделиться
          <InstallGlyph name="share" class="install-scene__row-glyph" />
          <Ripple on={s() === 1} />
        </span>
      </div>
      <div
        class="install-layer install-layer--rise install-scene__share"
        classList={{ 'install-layer--on': s() >= 2 && s() <= 3 }}
      >
        <span class="install-scene__share-head">
          <AppIcon small />
          Дневник
        </span>
        <span class="install-scene__listbox">
          <span
            class="install-scene__list"
            classList={{ 'install-scene__list--scrolled': s() >= 2 }}
          >
            <span class="install-scene__row install-scene__row--spread">
              Копировать
              <AppGlyph name="copy" class="install-scene__row-glyph" />
            </span>
            <span class="install-scene__row install-scene__row--spread">
              Добавить закладку
              <InstallGlyph name="star" class="install-scene__row-glyph" />
            </span>
            <span class="install-scene__row install-scene__row--spread">
              Найти на странице
              <AppGlyph name="search" class="install-scene__row-glyph" />
            </span>
            <span
              class="install-scene__row install-scene__row--spread install-hot"
              classList={{ 'install-hot--on': s() === 2 }}
            >
              На экран «Домой»
              <InstallGlyph name="plus-square" class="install-scene__row-glyph" />
              <Ripple on={s() === 2} />
            </span>
            <span class="install-scene__row install-scene__row--spread">
              Печать
              <AppGlyph name="printer" class="install-scene__row-glyph" />
            </span>
          </span>
          <span class="install-scene__hint" classList={{ 'install-scene__hint--on': s() === 2 }}>
            <AppGlyph name="caret-down" class="install-scene__hint-glyph" />
          </span>
        </span>
      </div>
      <AddDialog on={s() === 3} />
      <Home shown={s() === 4} />
    </div>
  );
}

/** Safari's «На экран «Домой»» sheet: «Добавить» sits in the top-right corner. */
function AddDialog(props: { readonly on: boolean }): JSX.Element {
  return (
    <div
      class="install-layer install-layer--rise install-scene__add"
      classList={{ 'install-layer--on': props.on }}
    >
      <span class="install-scene__add-head">
        <AppGlyph name="close" class="install-scene__add-cancel" />
        <span
          class="install-scene__add-done install-hot"
          classList={{ 'install-hot--on': props.on }}
        >
          Добавить
          <Ripple on={props.on} />
        </span>
      </span>
      <span class="install-scene__dialog-title">На экран «Домой»</span>
      <span class="install-scene__field">
        <AppIcon small />
        Дневник
      </span>
    </div>
  );
}

function IpadScene(props: { readonly step: StepFn }): JSX.Element {
  const s = props.step;
  return (
    <div class="install-scene__phone install-scene__phone--wide">
      <Page />
      <div class="install-scene__topbar install-scene__topbar--tablet">
        <span class="install-scene__button">
          <AppGlyph name="caret-left" class="install-scene__button-glyph" />
        </span>
        <AddressPill />
        <span
          class="install-scene__button install-hot"
          classList={{ 'install-hot--on': s() === 0 }}
        >
          <InstallGlyph name="share" class="install-scene__button-glyph" />
          <Ripple on={s() === 0} />
        </span>
        <span class="install-scene__button">
          <AppGlyph name="plus" class="install-scene__button-glyph" />
        </span>
      </div>
      <span
        class="install-layer install-layer--fade install-scene__scrim"
        classList={{ 'install-layer--on': s() === 2 }}
      />
      <div
        class="install-layer install-layer--pop install-scene__menu install-scene__menu--tablet"
        classList={{ 'install-layer--on': s() === 1 }}
      >
        <span class="install-scene__row install-scene__row--spread">
          Копировать
          <AppGlyph name="copy" class="install-scene__row-glyph" />
        </span>
        <span
          class="install-scene__row install-scene__row--spread install-hot"
          classList={{ 'install-hot--on': s() === 1 }}
        >
          На экран «Домой»
          <InstallGlyph name="plus-square" class="install-scene__row-glyph" />
          <Ripple on={s() === 1} />
        </span>
      </div>
      <AddDialog on={s() === 2} />
      <Home shown={s() === 3} />
    </div>
  );
}

function MessengerScene(props: { readonly step: StepFn }): JSX.Element {
  const s = props.step;
  return (
    <div class="install-scene__phone">
      <Page />
      <div class="install-scene__topbar install-scene__topbar--messenger">
        <AppGlyph name="close" class="install-scene__button-glyph" />
        <span class="install-scene__messenger-title">Дневник</span>
        <span
          class="install-scene__button install-hot"
          classList={{ 'install-hot--on': s() === 0 }}
        >
          <AppGlyph name="dots-three" class="install-scene__button-glyph" />
          <Ripple on={s() === 0} />
        </span>
      </div>
      <div
        class="install-layer install-layer--pop install-scene__menu"
        classList={{ 'install-layer--on': s() === 1 }}
      >
        <span class="install-scene__row">Обновить</span>
        <span class="install-scene__row install-hot" classList={{ 'install-hot--on': s() === 1 }}>
          Открыть в браузере
          <Ripple on={s() === 1} />
        </span>
        <span class="install-scene__row">Копировать ссылку</span>
      </div>
      <div
        class="install-layer install-layer--fade install-scene__browser"
        classList={{ 'install-layer--on': s() === 2 }}
      >
        <div class="install-scene__topbar">
          <AddressPill />
          <span class="install-scene__button">
            <AppGlyph name="dots-three-vertical" class="install-scene__button-glyph" />
          </span>
        </div>
        <Page />
        <InstallGlyph name="check-circle" class="install-scene__done" />
      </div>
    </div>
  );
}

function DesktopScene(props: { readonly step: StepFn }): JSX.Element {
  const s = props.step;
  return (
    <div class="install-scene__phone install-scene__phone--window">
      <Page />
      <div class="install-scene__topbar install-scene__topbar--window">
        <span class="install-scene__lights" />
        <AddressPill>
          <span
            class="install-scene__install install-hot"
            classList={{ 'install-hot--on': s() === 0 }}
          >
            <InstallGlyph name="app-window" class="install-scene__install-glyph" />
            <Ripple on={s() === 0} />
          </span>
        </AddressPill>
      </div>
      <div
        class="install-layer install-layer--pop install-scene__menu install-scene__menu--window"
        classList={{ 'install-layer--on': s() === 1 }}
      >
        <span class="install-scene__dialog-title">Установить «Дневник»?</span>
        <span class="install-scene__actions">
          <span class="install-scene__action">Отмена</span>
          <span
            class="install-scene__action install-scene__action--primary install-hot"
            classList={{ 'install-hot--on': s() === 1 }}
          >
            Установить
            <Ripple on={s() === 1} />
          </span>
        </span>
      </div>
      <div
        class="install-layer install-layer--pop install-scene__appwindow"
        classList={{ 'install-layer--on': s() === 2 }}
      >
        <span class="install-scene__appwindow-bar">
          <span class="install-scene__lights" />
          Дневник
        </span>
        <Page />
      </div>
    </div>
  );
}

export function InstallScene(props: {
  readonly kind: InstallGuideKind;
  readonly step: StepFn;
}): JSX.Element {
  return (
    <div class="install-scene" aria-hidden="true">
      {props.kind === 'android' ? <AndroidScene step={props.step} /> : null}
      {props.kind === 'iphone' ? <IphoneScene step={props.step} /> : null}
      {props.kind === 'ipad' ? <IpadScene step={props.step} /> : null}
      {props.kind === 'messenger' ? <MessengerScene step={props.step} /> : null}
      {props.kind === 'desktop' ? <DesktopScene step={props.step} /> : null}
    </div>
  );
}
