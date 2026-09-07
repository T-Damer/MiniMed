import { createUISFX } from 'uisfx';

const player = createUISFX({ pack: 'zen', volume: 0.3, enabled: true });
const soundToggle = document.querySelector<HTMLButtonElement>('[data-sound-toggle]');
const soundLabel = document.querySelector<HTMLElement>('[data-sound-label]');
const soundIcon = document.querySelector<HTMLImageElement>('[data-sound-icon]');

soundToggle?.addEventListener('click', () => {
  const enabled = !player.isEnabled();
  player.setEnabled(enabled);
  soundToggle.setAttribute('aria-pressed', String(enabled));
  soundToggle.classList.toggle('sound-toggle--enabled', enabled);
  if (soundLabel) soundLabel.textContent = enabled ? 'Звук вкл.' : 'Звук выкл.';
  if (soundIcon) soundIcon.src = `./icons/speaker-${enabled ? 'high' : 'slash'}.svg`;
  if (enabled) player.play('toggle-on');
});

document.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const cue = event.target.closest<HTMLElement>('[data-sound]')?.dataset.sound;
  if (cue === 'press' || cue === 'open' || cue === 'select') player.play(cue);
});
