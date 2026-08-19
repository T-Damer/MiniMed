import { Capacitor } from '@capacitor/core';

import { computePrintFitScale } from '@/features/printing/native-print-fit';

function removePreview(): void {
  document.querySelector<HTMLElement>('.native-print-preview')?.remove();
  document.documentElement.classList.remove('native-print-active');
  window.removeEventListener('afterprint', removePreview);
}

const SHARE_ICON_SVG = `<svg class="native-print-preview__action-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><path fill="currentColor" d="M240.49,103.52l-80-80A12,12,0,0,0,140,32V68.74c-25.76,3.12-53.66,15.89-76.75,35.47-29.16,24.74-47.32,56.69-51.14,90A16,16,0,0,0,39.67,207h0c10.46-11.14,47-45.74,100.33-50.42V192a12,12,0,0,0,20.48,8.48l80-80A12,12,0,0,0,240.49,103.52ZM164,163V144a12,12,0,0,0-12-12c-49,0-86.57,21.56-109.79,40.11,7.13-18.16,19.63-35.22,36.57-49.59C101.3,103.41,128.67,92,152,92a12,12,0,0,0,12-12V61l51,51Z"/></svg>`;

const PRINT_ICON_SVG = `<svg class="native-print-preview__action-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><path fill="currentColor" d="M216 72h-32V40a16 16 0 0 0-16-16H88a16 16 0 0 0-16 16v32H40a16 16 0 0 0-16 16v80a16 16 0 0 0 16 16h32v32a16 16 0 0 0 16 16h80a16 16 0 0 0 16-16v-32h32a16 16 0 0 0 16-16V88a16 16 0 0 0-16-16ZM96 48h64v24H96Zm64 160H96v-32h64Zm48-48h-16v-16a8 8 0 0 0-8-8H72a8 8 0 0 0-8 8v16H48V96h160Zm-72-60a12 12 0 1 1-12-12 12 12 0 0 1 12 12Z"/></svg>`;

function stripHtmlText(html: string): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  return parsed.body.textContent?.replace(/\s+/gu, ' ').trim() ?? '';
}

function fitPreviewSheet(sheet: HTMLElement, content: HTMLElement, scaler: HTMLElement): void {
  const styles = getComputedStyle(sheet);
  const paddingX = Number.parseFloat(styles.paddingLeft) + Number.parseFloat(styles.paddingRight);
  const paddingY = Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom);
  const availableWidth = Math.max(0, sheet.clientWidth - paddingX);
  const availableHeight = Math.max(0, sheet.clientHeight - paddingY);
  const scale = computePrintFitScale(
    content.scrollWidth,
    content.scrollHeight,
    availableWidth,
    availableHeight,
  );
  scaler.style.transform = `scale(${scale})`;
  scaler.style.transformOrigin = 'top left';
  scaler.style.width = `${100 / scale}%`;
  content.style.width = `${100 / scale}%`;
}

async function shareOrPrint(title: string, html: string): Promise<void> {
  const text = [title, stripHtmlText(html)].filter(Boolean).join('\n\n');
  if ('share' in navigator && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text });
      return;
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
    }
  }
  window.print();
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
  if (Capacitor.isNativePlatform()) {
    action.classList.add('native-print-preview__action--share');
    action.setAttribute('aria-label', 'Поделиться');
    action.title = 'Поделиться';
    action.innerHTML = SHARE_ICON_SVG;
    action.addEventListener('click', () => {
      void shareOrPrint(title, html);
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

  const stage = document.createElement('div');
  stage.className = 'native-print-preview__stage';

  const sheet = document.createElement('article');
  sheet.className = 'native-print-preview__sheet';

  const scaler = document.createElement('div');
  scaler.className = 'native-print-preview__sheet-scaler';

  const content = document.createElement('div');
  content.className = 'native-print-preview__content';
  content.innerHTML = parsed.body.innerHTML;
  for (const table of Array.from(content.querySelectorAll('table'))) {
    table.classList.add('native-print-preview__table');
  }
  for (const cell of Array.from(content.querySelectorAll('th, td'))) {
    cell.classList.add('native-print-preview__cell');
  }

  scaler.append(content);
  sheet.append(scaler);
  stage.append(sheet);
  preview.append(header, stage);

  removePreview();
  window.scrollTo(0, 0);
  document.body.append(preview);
  document.documentElement.classList.add('native-print-active');
  window.addEventListener('afterprint', removePreview, { once: true });

  window.requestAnimationFrame(() => {
    fitPreviewSheet(sheet, content, scaler);
  });

  return true;
}
