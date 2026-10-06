/**
 * Fixed-timestep game loop with interpolated rendering ("Fix Your Timestep" pattern).
 *
 * - `fixedUpdate(dt)` runs at a constant rate (simulation: physics, AI, combat timers).
 * - `update(dt)` runs once per rendered frame (input edges, UI, camera smoothing).
 * - `render(alpha)` runs once per frame; `alpha` is the interpolation factor between fixed steps.
 *
 * The frame scheduler is injectable so the loop is deterministic under test.
 */
export interface FrameScheduler {
  request(cb: (timeMs: number) => void): number;
  cancel(handle: number): void;
  now(): number;
}

export const browserScheduler: FrameScheduler = {
  request: (cb) => requestAnimationFrame(cb),
  cancel: (h) => cancelAnimationFrame(h),
  now: () => performance.now(),
};

export interface LoopCallbacks {
  fixedUpdate(dt: number): void;
  update(dt: number): void;
  render(alpha: number): void;
  /** Called after render; used by input to clear per-frame edges. */
  endFrame?(): void;
}

export interface GameLoopOptions {
  /** Simulation rate in Hz. */
  fixedHz?: number;
  /** Clamp for very long frames (tab switches, breakpoints), in seconds. */
  maxFrameTime?: number;
  /** Upper bound of fixed steps per frame to avoid the spiral of death. */
  maxStepsPerFrame?: number;
  scheduler?: FrameScheduler;
}

export interface LoopStats {
  readonly frame: number;
  readonly fixedSteps: number;
  readonly elapsed: number;
  readonly fps: number;
  readonly frameMs: number;
}

export class GameLoop {
  readonly fixedDt: number;
  private readonly maxFrameTime: number;
  private readonly maxSteps: number;
  private readonly scheduler: FrameScheduler;

  private handle: number | null = null;
  private lastTime: number | null = null;
  private accumulator = 0;
  private _timeScale = 1;
  private _paused = false;

  private frame = 0;
  private fixedSteps = 0;
  private elapsed = 0;
  private fps = 0;
  private frameMs = 0;
  private fpsWindowStart = 0;
  private fpsWindowFrames = 0;

  constructor(
    private readonly callbacks: LoopCallbacks,
    options: GameLoopOptions = {},
  ) {
    this.fixedDt = 1 / (options.fixedHz ?? 60);
    this.maxFrameTime = options.maxFrameTime ?? 0.25;
    this.maxSteps = options.maxStepsPerFrame ?? 8;
    this.scheduler = options.scheduler ?? browserScheduler;
  }

  get running(): boolean {
    return this.handle !== null;
  }

  get timeScale(): number {
    return this._timeScale;
  }

  /** Global time scale (e.g. combat speed x1/x2, slow-motion ultimates). */
  set timeScale(v: number) {
    this._timeScale = Math.max(0, v);
  }

  get paused(): boolean {
    return this._paused;
  }

  /** Paused: simulation stops, rendering continues (pause menus remain animated through `update`). */
  set paused(v: boolean) {
    this._paused = v;
  }

  get stats(): LoopStats {
    return { frame: this.frame, fixedSteps: this.fixedSteps, elapsed: this.elapsed, fps: this.fps, frameMs: this.frameMs };
  }

  start(): void {
    if (this.running) return;
    this.lastTime = null;
    this.accumulator = 0;
    this.fpsWindowStart = this.scheduler.now();
    this.handle = this.scheduler.request(this.onFrame);
  }

  stop(): void {
    if (this.handle !== null) this.scheduler.cancel(this.handle);
    this.handle = null;
  }

  /** Advance exactly one frame at `timeMs`. Public for deterministic tests and tooling. */
  tick(timeMs: number): void {
    const rawDt = this.lastTime === null ? 0 : Math.min((timeMs - this.lastTime) / 1000, this.maxFrameTime);
    this.lastTime = timeMs;
    const dt = Math.max(0, rawDt) * this._timeScale;
    this.frame++;
    this.elapsed += dt;
    this.frameMs = rawDt * 1000;

    if (!this._paused) {
      this.accumulator += dt;
      let steps = 0;
      // Epsilon guards against float drift (e.g. 0.15 - 0.1 + 0.05 < 0.1) silently dropping a step.
      while (this.accumulator + 1e-9 >= this.fixedDt && steps < this.maxSteps) {
        this.callbacks.fixedUpdate(this.fixedDt);
        this.accumulator -= this.fixedDt;
        this.fixedSteps++;
        steps++;
      }
      if (steps === this.maxSteps) this.accumulator = Math.min(this.accumulator, this.fixedDt);
    }

    this.callbacks.update(this._paused ? 0 : dt);
    this.callbacks.render(this.accumulator / this.fixedDt);
    this.callbacks.endFrame?.();

    this.fpsWindowFrames++;
    const windowMs = timeMs - this.fpsWindowStart;
    if (windowMs >= 500) {
      this.fps = (this.fpsWindowFrames * 1000) / windowMs;
      this.fpsWindowFrames = 0;
      this.fpsWindowStart = timeMs;
    }
  }

  private readonly onFrame = (timeMs: number): void => {
    if (this.handle === null) return;
    this.tick(timeMs);
    if (this.handle !== null) this.handle = this.scheduler.request(this.onFrame);
  };
}
