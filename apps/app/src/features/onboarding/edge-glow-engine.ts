import {
  createSimulation,
  drawSimulation,
  type GlowCanvasContext,
  type GlowPalette,
  type GlowSimulation,
  mulberry32,
  PULSE_INTENSITY,
  PULSE_MS,
  particleCount,
  pulseIntensity,
  RESTING_INTENSITY,
  stepSimulation,
} from './edge-glow-renderer';

/** The longest step the simulation takes at once, so a stalled frame does not teleport light. */
const MAX_STEP_SECONDS = 0.05;

export interface EdgeGlowTarget {
  readonly canvas: { width: number; height: number };
  readonly context: GlowCanvasContext;
}

type Schedule = (callback: () => void) => number;
type Cancel = (handle: number) => void;

/**
 * Owns the animation loop of the edge glow, on whichever thread it is built: the worker passes
 * its own frame scheduler, the page uses requestAnimationFrame. Nothing here touches the DOM.
 */
export class EdgeGlowEngine {
  private simulation: GlowSimulation | undefined;
  private frame: number | undefined;
  private lastAt = 0;
  private pulseAt: number | undefined;
  private running = true;
  private dpr = 1;

  constructor(
    private readonly target: EdgeGlowTarget,
    private readonly palette: GlowPalette,
    private readonly schedule: Schedule,
    private readonly cancel: Cancel,
    private readonly now: () => number,
    private readonly random = mulberry32(0x6d1c0de),
  ) {}

  resize(width: number, height: number, dpr: number): void {
    this.dpr = dpr;
    this.target.canvas.width = Math.max(1, Math.round(width * dpr));
    this.target.canvas.height = Math.max(1, Math.round(height * dpr));
    this.simulation = createSimulation(width, height, particleCount(width, height), this.random);
    this.start();
  }

  pulse(): void {
    this.pulseAt = this.now();
  }

  pause(): void {
    this.running = false;
    if (this.frame !== undefined) this.cancel(this.frame);
    this.frame = undefined;
  }

  resume(): void {
    this.running = true;
    this.start();
  }

  stop(): void {
    this.pause();
    this.simulation = undefined;
  }

  private start(): void {
    if (!this.running || this.frame !== undefined || !this.simulation) return;
    this.lastAt = this.now();
    this.frame = this.schedule(() => this.tick());
  }

  private tick(): void {
    this.frame = undefined;
    const simulation = this.simulation;
    if (!this.running || !simulation) return;
    const now = this.now();
    const seconds = Math.min(MAX_STEP_SECONDS, Math.max(0, (now - this.lastAt) / 1000));
    this.lastAt = now;
    const intensity =
      this.pulseAt === undefined
        ? RESTING_INTENSITY
        : pulseIntensity(RESTING_INTENSITY, PULSE_INTENSITY, now - this.pulseAt, PULSE_MS);
    stepSimulation(simulation, seconds, this.random);
    this.target.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    drawSimulation(this.target.context, simulation, this.palette, intensity, seconds);
    this.frame = this.schedule(() => this.tick());
  }
}
