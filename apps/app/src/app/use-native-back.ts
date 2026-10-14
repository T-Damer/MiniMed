import { App as NativeApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { type Accessor, onCleanup, onMount } from 'solid-js';
import { nativeBackTargets } from '@/app/native-back';
import type { RootView } from '@/app/root-view';
import { backOneLayer } from '@/state/app-back';
import { getSplitNavigation } from '@/state/app-preferences';
import { popTopHistoryLayer } from '@/state/history-layer';
import { returnFromTool } from '@/state/tool-navigation';

export function useNativeBack(options: {
  readonly view: Accessor<RootView>;
  readonly navigate: (next: RootView) => void;
}): void {
  onMount(async () => {
    if (Capacitor.getPlatform() !== 'android') return;
    const listener = await NativeApp.addListener('backButton', () => {
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
      // Previews, menus and popovers are history layers: the topmost one closes first.
      if (popTopHistoryLayer()) return;
      if (document.querySelector('.document-find--open')) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        return;
      }
      if (document.querySelector('.search-history-drawer-backdrop, .reader-column.open')) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        return;
      }
      // An open search section returns to the section list, like its back arrow.
      const searchBack = document.querySelector<HTMLButtonElement>('[data-search-back]');
      if (searchBack) {
        searchBack.click();
        return;
      }
      const nativePrintBack = document.querySelector<HTMLButtonElement>('[data-native-print-back]');
      if (nativePrintBack) {
        nativePrintBack.click();
        return;
      }
      const route = window.location.hash.replace(/^#\/?/u, '');
      if (!/\/results\//u.test(route) && returnFromTool()) return;
      // One layer per press: a layer over the page, else the history, else the parent screen, the
      // home tab, and only from the home tab the app minimises (state/app-back.ts).
      const targets = nativeBackTargets(route, getSplitNavigation());
      const outcome = backOneLayer(targets);
      if (outcome === 'home') options.navigate('search');
      else if (outcome === 'exit') void NativeApp.minimizeApp();
    });
    onCleanup(() => {
      void listener.remove();
    });
  });
}
