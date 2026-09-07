import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

let now = 0;
let tick = () => {};
let modalOpen = false;
const listeners = new Map<string, () => void>();
const controls = ['search', 'library', 'tools'].map((feature, index) => ({
  dataset: { feature },
  pressed: String(index === 0),
  setAttribute(_name: string, value: string) {
    this.pressed = value;
  },
  getAttribute() {
    return this.pressed;
  },
  classList: { toggle() {} },
  addEventListener() {},
}));
const document = {
  hidden: false,
  documentElement: { classList: { contains: () => false } },
  querySelectorAll: (selector: string) => (selector === '[data-feature]' ? controls : []),
  querySelector: (selector: string) => (selector === 'dialog[open]' && modalOpen ? {} : null),
  addEventListener: (event: string, callback: () => void) => listeners.set(event, callback),
};
const motion = { matches: false, addEventListener() {} };
runInNewContext(ts.transpile(readFileSync(new URL('./showcase.ts', import.meta.url), 'utf8')), {
  document,
  performance: { now: () => now },
  window: {
    matchMedia: () => motion,
    setInterval: (callback: () => void) => {
      tick = callback;
    },
  },
});
const advance = (milliseconds: number) => {
  now += milliseconds;
  tick();
};
const selected = () => controls.findIndex((control) => control.pressed === 'true');
advance(29_999);
assert.equal(selected(), 0);
advance(1);
assert.equal(selected(), 1);
advance(29_999);
assert.equal(selected(), 1);
advance(1);
assert.equal(selected(), 2);
for (const event of ['pointermove', 'pointerdown', 'keydown', 'input', 'scroll', 'focusin']) {
  advance(20_000);
  listeners.get(event)?.();
  advance(20_000);
  assert.equal(selected(), 2, event);
  listeners.get(event)?.();
}
modalOpen = true;
advance(60_000);
assert.equal(selected(), 2);
modalOpen = false;
listeners.get('close')?.();
advance(29_999);
assert.equal(selected(), 2);
advance(1);
assert.equal(selected(), 0);
document.hidden = true;
advance(60_000);
assert.equal(selected(), 0);
document.hidden = false;
listeners.get('visibilitychange')?.();
advance(29_999);
assert.equal(selected(), 0);
advance(1);
assert.equal(selected(), 1);
motion.matches = true;
advance(60_000);
assert.equal(selected(), 1);
