import { describe, expect, it } from 'vitest';
import { GameLoop, type FrameScheduler } from '@core/loop/GameLoop';

function fakeScheduler(): FrameScheduler & { flush(time: number): void } {
  let cb: ((t: number) => void) | null = null;
  return {
    request: (fn) => {
      cb = fn;
      return 1;
    },
    cancel: () => {
      cb = null;
    },
    now: () => 0,
    flush(time) {
      const fn = cb;
      cb = null;
      fn?.(time);
    },
  };
}

function recorder() {
  const calls = { fixed: 0, update: [] as number[], render: [] as number[], end: 0 };
  return {
    calls,
    callbacks: {
      fixedUpdate: () => calls.fixed++,
      update: (dt: number) => calls.update.push(dt),
      render: (a: number) => calls.render.push(a),
      endFrame: () => calls.end++,
    },
  };
}

describe('GameLoop', () => {
  it('runs a fixed number of simulation steps for elapsed time', () => {
    const { calls, callbacks } = recorder();
    const loop = new GameLoop(callbacks, { fixedHz: 60, maxFrameTime: 1, maxStepsPerFrame: 100, scheduler: fakeScheduler() });
    expect(loop.fixedDt).toBeCloseTo(1 / 60);
    loop.tick(0);
    loop.tick(500);
    expect(calls.fixed).toBe(30);
  });

  it('clamps very long frames to maxFrameTime', () => {
    const { calls, callbacks } = recorder();
    const loop = new GameLoop(callbacks, { fixedHz: 60, maxFrameTime: 0.25, maxStepsPerFrame: 100, scheduler: fakeScheduler() });
    loop.tick(0);
    loop.tick(5000); // a 5 s hitch only simulates 0.25 s
    expect(calls.fixed).toBe(15);
  });

  it('accumulates leftover time and exposes the interpolation alpha', () => {
    const { calls, callbacks } = recorder();
    const loop = new GameLoop(callbacks, { fixedHz: 10, scheduler: fakeScheduler() });
    loop.tick(0);
    loop.tick(150); // 1.5 steps
    expect(calls.fixed).toBe(1);
    expect(calls.render.at(-1)).toBeCloseTo(0.5);
    loop.tick(200); // +0.5 -> 2 steps total
    expect(calls.fixed).toBe(2);
    expect(calls.end).toBe(3);
  });

  it('caps steps per frame to avoid the spiral of death', () => {
    const { calls, callbacks } = recorder();
    const loop = new GameLoop(callbacks, { fixedHz: 100, maxFrameTime: 1, maxStepsPerFrame: 5, scheduler: fakeScheduler() });
    loop.tick(0);
    loop.tick(1000);
    expect(calls.fixed).toBe(5);
  });

  it('pauses simulation but keeps updating/rendering, and honours timeScale', () => {
    const { calls, callbacks } = recorder();
    const loop = new GameLoop(callbacks, { fixedHz: 10, scheduler: fakeScheduler() });
    loop.tick(0);
    loop.paused = true;
    loop.tick(200);
    expect(calls.fixed).toBe(0);
    expect(calls.update.at(-1)).toBe(0);
    expect(calls.render.length).toBe(2);
    loop.paused = false;
    loop.timeScale = 2;
    loop.tick(300); // 0.1 s * 2 = 0.2 s -> 2 steps
    expect(calls.fixed).toBe(2);
  });

  it('starts and stops through the scheduler', () => {
    const sched = fakeScheduler();
    const { calls, callbacks } = recorder();
    const loop = new GameLoop(callbacks, { scheduler: sched });
    loop.start();
    expect(loop.running).toBe(true);
    sched.flush(0);
    sched.flush(16);
    expect(calls.render.length).toBe(2);
    loop.stop();
    sched.flush(32);
    expect(loop.running).toBe(false);
    expect(calls.render.length).toBe(2);
  });
});
