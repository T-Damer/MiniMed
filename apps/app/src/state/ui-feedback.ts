import type { CueName } from 'uisfx';

import { type HapticStrength, hapticFeedback } from '@/state/haptics';
import { uiSounds } from '@/state/ui-sounds';

const CARD_SELECTOR =
  'article, .paper-card, .module-card, .content-module-card, .assessment-card, .calculator-card, .document-library-card, .recommendation-section-card, .result-group';

const DELETE_SELECTOR =
  '[aria-label^="Удалить"], .danger, .search-history-panel-remove, .search-history-panel-clear, [aria-label="Очистить историю"], .module-remove-button';

const PRINT_SELECTOR = '.assessment-print-button, [aria-label^="Распечатать"]';
const SHARE_SELECTOR = '[aria-label^="Поделиться"]';
const SEARCH_SUBMIT_SELECTOR = '.search-button, [data-testid="search-submit"]';
const SCROLL_TOP_SELECTOR = '.scroll-top-button';
const PATIENT_NOTES_FAB_SELECTOR = '.patient-notes-fab';
const CLOSE_SELECTOR = '[aria-label="Закрыть историю"], [aria-label="Закрыть источник"]';
const NOTE_IMAGE_PICKER_SELECTOR = '.note-image-picker';

const radiosCheckedOnPointerDown = new WeakSet<Element>();

function isNoteImagePickerDisabled(picker: Element): boolean {
  if (picker.classList?.contains('note-image-picker--disabled')) return true;
  const input = picker.querySelector('input[type="file"]');
  return input instanceof HTMLInputElement && input.disabled;
}

function isDisabledControl(element: Element): boolean {
  if (element instanceof HTMLButtonElement && element.disabled) return true;
  if (element instanceof HTMLInputElement && element.disabled) return true;
  return element.getAttribute('aria-disabled') === 'true';
}

function isClickableCard(card: Element): boolean {
  if (card instanceof HTMLButtonElement) return true;
  if (card.hasAttribute('onclick')) return true;
  if (card.getAttribute('role') === 'button') return true;
  if (card.getAttribute('tabindex') !== null && card.getAttribute('tabindex') !== '-1') {
    return true;
  }
  const label = card.getAttribute('aria-label');
  return Boolean(label?.startsWith('Открыть'));
}

function resolveButtonHaptic(button: HTMLButtonElement): HapticStrength {
  const explicit = button.dataset['haptic'];
  if (explicit === 'heavy' || button.matches(DELETE_SELECTOR)) return 'heavy';
  if (
    explicit === 'medium' ||
    button.matches('.app-nav-button, .search-button, .content-download-pill')
  ) {
    return 'medium';
  }
  return 'light';
}

function isToggleControl(element: Element): boolean {
  return (
    element.getAttribute('role') === 'switch' ||
    element.hasAttribute('aria-pressed') ||
    element.getAttribute('aria-checked') !== null
  );
}

function toggleCue(element: Element): CueName {
  const pressed =
    element.getAttribute('aria-pressed') === 'true' ||
    element.getAttribute('aria-checked') === 'true';
  return pressed ? 'toggle-on' : 'toggle-off';
}

export interface ClickFeedback {
  readonly cue: CueName;
  readonly haptic: HapticStrength;
}

function radioControl(target: Element): Element | null {
  const radio = target.closest('input[type="radio"]');
  if (radio) return radio;
  const label = target.closest('label');
  return label?.querySelector('input[type="radio"]') ?? null;
}

export function noteControlPointerDown(target: Element): void {
  const radio = radioControl(target);
  if (radio instanceof HTMLInputElement && radio.checked) {
    radiosCheckedOnPointerDown.add(radio);
  }
}

function hoverCueForControl(control: Element): CueName {
  if (control.tagName === 'A') return 'info';
  if (control.matches(DELETE_SELECTOR)) return 'warning';
  if (isToggleControl(control)) return 'snap';
  return 'hover';
}

export function sonifiedControl(target: Element): Element | null {
  if (isDisabledControl(target)) return null;

  const link = target.closest('a[href]');
  if (link && !isDisabledControl(link)) return link;

  const slider = target.closest('input[type="range"]');
  if (slider && !isDisabledControl(slider)) return slider;

  const radio = radioControl(target);
  if (radio && !isDisabledControl(radio)) return radio.closest('label') ?? radio;

  const imagePicker = target.closest(NOTE_IMAGE_PICKER_SELECTOR);
  if (imagePicker && !isNoteImagePickerDisabled(imagePicker)) return imagePicker;

  const button = target.closest('button, [role=button], summary');
  if (button instanceof Element && !isDisabledControl(button)) return button;

  const card = target.closest(CARD_SELECTOR);
  if (card && isClickableCard(card) && !target.closest('button, a[href], [role=button], summary')) {
    return card;
  }

  return null;
}

function buttonClickFeedback(button: Element): ClickFeedback {
  if (button.matches(DELETE_SELECTOR)) return { cue: 'delete', haptic: 'heavy' };
  if (button.matches(PRINT_SELECTOR) || button.matches(SHARE_SELECTOR)) {
    return { cue: 'send', haptic: 'light' };
  }
  if (button.matches(SEARCH_SUBMIT_SELECTOR)) return { cue: 'start', haptic: 'medium' };
  if (button.matches(SCROLL_TOP_SELECTOR)) return { cue: 'back', haptic: 'light' };
  if (button.matches(PATIENT_NOTES_FAB_SELECTOR)) return { cue: 'open', haptic: 'light' };
  if (button.matches(CLOSE_SELECTOR)) return { cue: 'close', haptic: 'light' };
  if (isToggleControl(button)) return { cue: toggleCue(button), haptic: 'light' };
  const card = button.closest(CARD_SELECTOR);
  if (card && card === button && isClickableCard(card)) {
    return { cue: 'select', haptic: 'light' };
  }
  return { cue: 'press', haptic: resolveButtonHaptic(button as HTMLButtonElement) };
}

export function feedbackForClick(target: Element): ClickFeedback | null {
  const control = sonifiedControl(target);
  if (!control) return null;

  if (control.tagName === 'A') return { cue: 'forward', haptic: 'light' };
  if (control.matches(NOTE_IMAGE_PICKER_SELECTOR)) return { cue: 'open', haptic: 'light' };
  if (control instanceof HTMLInputElement && control.type === 'range') return null;

  const radio = radioControl(control);
  if (radio) {
    const reselect = radiosCheckedOnPointerDown.has(radio);
    radiosCheckedOnPointerDown.delete(radio);
    return { cue: reselect ? 'check' : 'select', haptic: 'light' };
  }

  const role = control.getAttribute('role');
  if (control.tagName === 'BUTTON' || control.tagName === 'SUMMARY' || role === 'button') {
    return buttonClickFeedback(control);
  }

  if (isClickableCard(control)) return { cue: 'select', haptic: 'light' };

  return null;
}

function isInsideControl(node: EventTarget | null, control: Element): boolean {
  return node instanceof Node && control.contains(node);
}

export function installUiFeedback(root: Document = document): () => void {
  uiSounds.ensurePreferences();

  const unlock = (): void => {
    uiSounds.unlock();
  };

  const handlePointerDown = (event: PointerEvent): void => {
    if (!(event.target instanceof Element)) return;
    noteControlPointerDown(event.target);
  };

  const handleClick = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return;
    const feedback = feedbackForClick(event.target);
    if (!feedback) return;
    uiSounds.play(feedback.cue);
    hapticFeedback(feedback.haptic);
  };

  const handleInput = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== 'range' || target.disabled) return;
    uiSounds.play('volume-change');
    hapticFeedback('selection');
  };

  const handlePointerOver = (event: PointerEvent): void => {
    if (!(event.target instanceof Element)) return;
    const control = sonifiedControl(event.target);
    if (!control) return;
    if (isInsideControl(event.relatedTarget, control)) return;
    uiSounds.hover(control, event.pointerType, hoverCueForControl(control));
  };

  const handlePointerOut = (event: PointerEvent): void => {
    if (!(event.target instanceof Element)) return;
    const control = sonifiedControl(event.target);
    if (!control) return;
    if (isInsideControl(event.relatedTarget, control)) return;
    uiSounds.clearHover(control);
  };

  root.addEventListener('pointerdown', handlePointerDown, { capture: true });
  root.addEventListener('pointerdown', unlock, { capture: true });
  root.addEventListener('keydown', unlock, { capture: true });
  root.addEventListener('click', handleClick);
  root.addEventListener('input', handleInput);
  root.addEventListener('pointerover', handlePointerOver);
  root.addEventListener('pointerout', handlePointerOut);

  return () => {
    root.removeEventListener('pointerdown', handlePointerDown, { capture: true });
    root.removeEventListener('pointerdown', unlock, { capture: true });
    root.removeEventListener('keydown', unlock, { capture: true });
    root.removeEventListener('click', handleClick);
    root.removeEventListener('input', handleInput);
    root.removeEventListener('pointerover', handlePointerOver);
    root.removeEventListener('pointerout', handlePointerOut);
  };
}
