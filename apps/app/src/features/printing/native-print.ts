import { Capacitor } from '@capacitor/core';

function removePreview(): void {
  document.querySelector<HTMLElement>('.native-print-preview')?.remove();
  document.documentElement.classList.remove('native-print-active');
  window.removeEventListener('afterprint', removePreview);
}

const SHARE_ICON_SVG = `<svg class="native-print-preview__action-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><path fill="currentColor" d="M216 112v96a16 16 0 0 1-16 16H56a16 16 0 0 1-16-16v-96a16 16 0 0 1 16-16h40a8 8 0 0 1 0 16H56v96h144v-96h-40a8 8 0 0 1 0-16h40a16 16 0 0 1 16 16Zm-93.66-2.34 24-24a8 8 0 0 1 11.32 11.32L139.31 112H168a8 8 0 0 1 0 16h-48a8 8 0 0 1-8-8V72a8 8 0 0 1 16 0v28.69l18.34-18.35a8 8 0 0 1 11.32 0Z"/></svg>`;

const PRINT_ICON_SVG = `<svg class="native-print-preview__action-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><path fill="currentColor" d="M216 72h-32V40a16 16 0 0 0-16-16H88a16 16 0 0 0-16 16v32H40a16 16 0 0 0-16 16v80a16 16 0 0 0 16 16h32v32a16 16 0 0 0 16 16h80a16 16 0 0 0 16-16v-32h32a16 16 0 0 0 16-16V88a16 16 0 0 0-16-16ZM96 48h64v24H96Zm64 160H96v-32h64Zm48-48h-16v-16a8 8 0 0 0-8-8H72a8 8 0 0 0-8 8v16H48V96h160Zm-72-60a12 12 0 1 1-12-12 12 12 0 0 1 12 12Z"/></svg>`;

function stripHtmlText(html: string): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  return parsed.body.textContent?.replace(/\s+/gu, ' ').trim() ?? '';
}

async function sharePreview(title: string, html: string): Promise<void> {
  const text = [title, stripHtmlText(html)].filter(Boolean).join('\n\n');
  if ('share' in navigator && typeof navigator.share === 'function') {
    await navigator.share({ title, text });
    return;
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  }
}

export function printHtmlInNativeShell(html: string, title: string): boolean {
  if (!Capacitor.isNativePlatform()) return false;

  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const preview = document.createElement('section');
  preview.className = 'native-print-preview';
  preview.setAttribute('aria-label', `Печать: ${title}`);

  const header = document.createElement('header');
  header.className = 'native-print-preview__header';
  const back = document.createElement('button');
  back.type = 'button';
  back.dataset['nativePrintBack'] = 'true';
  back.className = 'native-print-preview__back';
  back.textContent = 'Назад';
  back.addEventListener('click', removePreview, { once: true });

  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'native-print-preview__action';
  const isNative = Capacitor.isNativePlatform();
  if (isNative) {
    action.classList.add('native-print-preview__action--share');
    action.setAttribute('aria-label', 'Поделиться');
    action.title = 'Поделиться';
    action.innerHTML = SHARE_ICON_SVG;
    action.addEventListener('click', () => {
      void sharePreview(title, html).catch(() => {
        // Share can be cancelled by the user.
      });
    });
  } else {
    action.classList.add('native-print-preview__action--print');
    action.setAttribute('aria-label', 'Печать');
    action.title = 'Печать';
    action.innerHTML = PRINT_ICON_SVG;
    action.addEventListener('click', () => window.print());
  }

  const heading = document.createElement('strong');
  heading.className = 'native-print-preview__title';
  heading.textContent = title;
  header.append(back, action, heading);

  const content = document.createElement('article');
  content.className = 'native-print-preview__content';
  content.innerHTML = parsed.body.innerHTML;
  preview.append(header, content);

  removePreview();
  document.body.append(preview);
  document.documentElement.classList.add('native-print-active');
  window.addEventListener('afterprint', removePreview, { once: true });
  window.requestAnimationFrame(() => window.print());
  return true;
}
