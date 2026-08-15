import { Capacitor } from '@capacitor/core';

function removePreview(): void {
  document.querySelector<HTMLElement>('.native-print-preview')?.remove();
  document.documentElement.classList.remove('native-print-active');
  window.removeEventListener('afterprint', removePreview);
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
  const heading = document.createElement('strong');
  heading.textContent = title;
  header.append(back, heading);

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
