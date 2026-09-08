import { App as NativeApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { type Accessor, onCleanup, onMount } from 'solid-js';
import { nativeBackAction } from '@/app/native-back';
import type { RootView } from '@/app/root-view';
import { getSplitNavigation } from '@/state/app-preferences';
import { returnFromTool } from '@/state/tool-navigation';

export function useNativeBack(options: {
  readonly view: Accessor<RootView>;
  readonly navigate: (next: RootView) => void;
}): void {
  onMount(async () => {
    if (Capacitor.getPlatform() !== 'android') return;
    const listener = await NativeApp.addListener('backButton', ({ canGoBack }) => {
      const openDialogs = document.querySelectorAll<HTMLElement>('[aria-modal="true"]');
      const openDialog = openDialogs[openDialogs.length - 1];
      if (openDialog) {
        const closeButton = openDialog.querySelector<HTMLButtonElement>(
          '.overlay-dialog-header button',
        );
        closeButton?.click();
        if (!closeButton) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        return;
      }
      if (document.querySelector('.document-find--open')) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        return;
      }
      if (document.querySelector('.search-history-drawer-backdrop, .reader-column.open')) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        return;
      }
      const nativePrintBack = document.querySelector<HTMLButtonElement>('[data-native-print-back]');
      if (nativePrintBack) {
        nativePrintBack.click();
        return;
      }
      if (document.querySelector('.search-section-menu')) {
        document.querySelector<HTMLButtonElement>('.search-source-picker')?.click();
        return;
      }
      const route = window.location.hash.replace(/^#\/?/u, '');
      if (!/\/results\//u.test(route) && returnFromTool()) return;
      const action = nativeBackAction(route, options.view(), canGoBack, getSplitNavigation());
      if (action.type === 'parent') {
        window.location.hash = action.hash;
      } else if (action.type === 'history') {
        window.history.back();
      } else if (action.type === 'search') {
        options.navigate('search');
      } else {
        void NativeApp.minimizeApp();
      }
    });
    onCleanup(() => {
      void listener.remove();
    });
  });
}
