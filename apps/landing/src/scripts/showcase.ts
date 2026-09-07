const controls = document.querySelectorAll<HTMLButtonElement>('[data-feature]');
const panels = document.querySelectorAll<HTMLElement>('[data-feature-panel]');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let lastInteraction = performance.now();

const select = (control: HTMLButtonElement) => {
  for (const button of controls) {
    const selected = button === control;
    button.setAttribute('aria-pressed', String(selected));
    button.classList.toggle('showcase__control--active', selected);
  }
  for (const panel of panels) panel.hidden = panel.dataset.featurePanel !== control.dataset.feature;
};
for (const control of controls) control.addEventListener('click', () => select(control));
const resetIdle = () => {
  lastInteraction = performance.now();
};
for (const eventName of [
  'pointerdown',
  'pointermove',
  'keydown',
  'input',
  'scroll',
  'focusin',
  'close',
]) {
  document.addEventListener(eventName, resetIdle, { capture: true, passive: true });
}
document.addEventListener('visibilitychange', resetIdle);
reducedMotion.addEventListener('change', resetIdle);
window.setInterval(() => {
  if (reducedMotion.matches || document.hidden || document.querySelector('dialog[open]')) {
    resetIdle();
    return;
  }
  if (performance.now() - lastInteraction < 30_000) return;
  const index = Array.from(controls).findIndex(
    (control) => control.getAttribute('aria-pressed') === 'true',
  );
  const next = controls[(index + 1) % controls.length];
  if (next) select(next);
  resetIdle();
}, 1_000);

const themeToggle = document.querySelector<HTMLButtonElement>('[data-theme-toggle]');
const updateThemeLabel = () => {
  const dark = document.documentElement.classList.contains('landing--dark');
  themeToggle?.setAttribute('aria-pressed', String(dark));
  if (themeToggle) themeToggle.textContent = dark ? 'Светлая тема' : 'Тёмная тема';
};
themeToggle?.addEventListener('click', () => {
  document.documentElement.classList.toggle('landing--dark');
  updateThemeLabel();
});
updateThemeLabel();
