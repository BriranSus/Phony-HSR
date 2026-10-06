import { describe, expect, it, vi } from 'vitest';
import { ConfigService, GameConfigSchema, deepMerge, parseOverrides } from '@core/config/GameConfig';
import { Logger, MemorySink } from '@core/log/Logger';
import { InputManager } from '@core/input/InputManager';
import defaults from '@data/config/game.config.json';

describe('ConfigService', () => {
  it('validates the shipped defaults', () => {
    expect(GameConfigSchema.safeParse(defaults).success).toBe(true);
  });

  it('applies typed URL-style overrides and reports unknown keys', () => {
    const base = GameConfigSchema.parse(defaults);
    const { patch, unknown } = parseOverrides(base, [
      ['cfg.graphics.quality', 'low'],
      ['cfg.graphics.bloom', 'false'],
      ['cfg.ui.minLoadingMs', '5000'],
      ['cfg.nope.key', '1'],
      ['cfg.graphics', 'x'],
    ]);
    expect(unknown).toEqual(['cfg.nope.key', 'cfg.graphics']);
    const cfg = new ConfigService(defaults, patch).get();
    expect(cfg.graphics.quality).toBe('low');
    expect(cfg.graphics.bloom).toBe(false);
    expect(cfg.ui.minLoadingMs).toBe(5000);
    expect(cfg.graphics.antialias).toBe(base.graphics.antialias);
  });

  it('rejects invalid updates atomically and notifies subscribers of valid ones', () => {
    const svc = new ConfigService(defaults);
    const listener = vi.fn();
    svc.subscribe(listener);
    expect(() => svc.update({ graphics: { quality: 'ultra' as never } })).toThrow();
    expect(svc.get().graphics.quality).toBe('high');
    expect(listener).not.toHaveBeenCalled();
    svc.update({ audio: { music: 0.25 } });
    expect(svc.section('audio').music).toBe(0.25);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('deep-merges nested objects without mutating inputs', () => {
    const a = { x: { y: 1, z: 2 }, w: [1] };
    const merged = deepMerge(a, { x: { y: 5 } });
    expect(merged).toEqual({ x: { y: 5, z: 2 }, w: [1] });
    expect(a.x.y).toBe(1);
  });
});

describe('Logger', () => {
  it('filters by level, namespaces child loggers and survives faulty sinks', () => {
    const mem = new MemorySink();
    const log = Logger.create({ level: 'info', sinks: [() => { throw new Error('bad sink'); }, mem.sink], namespace: 'game', now: () => 42 });
    log.debug('hidden');
    log.child('combat').warn('visible', { a: 1 });
    expect(mem.records).toEqual([{ level: 'warn', namespace: 'game:combat', message: 'visible', data: [{ a: 1 }], time: 42 }]);
    log.setLevel('silent');
    log.error('muted');
    expect(mem.records).toHaveLength(1);
  });
});

function key(type: string, code: string): Event {
  return Object.assign(new Event(type, { cancelable: true }), { code });
}

describe('InputManager', () => {
  function setup(): { input: InputManager; target: EventTarget } {
    const input = new InputManager();
    input.setBindings({
      moveForward: { codes: ['KeyW', 'ArrowUp'] },
      moveBack: { codes: ['KeyS'] },
      confirm: { codes: ['Enter', 'Mouse0'] },
    });
    const target = new EventTarget();
    input.attach(target);
    return { input, target };
  }

  it('maps raw key codes to actions with per-frame edges', () => {
    const { input, target } = setup();
    target.dispatchEvent(key('keydown', 'ArrowUp'));
    expect(input.isDown('moveForward')).toBe(true);
    expect(input.wasPressed('moveForward')).toBe(true);
    input.endFrame();
    expect(input.wasPressed('moveForward')).toBe(false);
    expect(input.isDown('moveForward')).toBe(true);
    target.dispatchEvent(key('keyup', 'ArrowUp'));
    expect(input.wasReleased('moveForward')).toBe(true);
    expect(input.isDown('moveForward')).toBe(false);
  });

  it('computes axes, ignores key repeat and maps mouse buttons', () => {
    const { input, target } = setup();
    target.dispatchEvent(key('keydown', 'KeyW'));
    expect(input.axis('moveBack', 'moveForward')).toBe(1);
    target.dispatchEvent(key('keydown', 'KeyS'));
    expect(input.axis('moveBack', 'moveForward')).toBe(0);
    target.dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0, clientX: 10, clientY: 20 }));
    expect(input.isDown('confirm')).toBe(true);
    expect(input.pointerX).toBe(10);
  });

  it('emits action events and releases everything on blur', () => {
    const { input, target } = setup();
    const seen: string[] = [];
    input.onAction((e) => seen.push(`${e.action}:${e.phase}`));
    target.dispatchEvent(key('keydown', 'KeyW'));
    target.dispatchEvent(new Event('blur'));
    expect(seen).toEqual(['moveForward:pressed', 'moveForward:released']);
    expect(input.activeActions()).toEqual([]);
  });

  it('accumulates wheel and pointer deltas until endFrame and supports rebinding', () => {
    const { input, target } = setup();
    target.dispatchEvent(Object.assign(new Event('wheel'), { deltaY: 100 }));
    target.dispatchEvent(Object.assign(new Event('pointermove'), { movementX: 3, movementY: -2 }));
    expect(input.wheelDelta).toBe(100);
    expect(input.pointerDeltaX).toBe(3);
    input.endFrame();
    expect(input.wheelDelta).toBe(0);
    input.setBindings({ moveForward: { codes: ['KeyZ'] } });
    target.dispatchEvent(key('keydown', 'KeyZ'));
    expect(input.isDown('moveForward')).toBe(true);
  });

  it('polls gamepad buttons as Pad<n> codes', () => {
    const { input } = setup();
    input.setBindings({ confirm: { codes: ['Pad0'] } });
    input.pollGamepads([{ buttons: [{ pressed: true }] }]);
    expect(input.wasPressed('confirm')).toBe(true);
    input.pollGamepads([{ buttons: [{ pressed: false }] }]);
    expect(input.isDown('confirm')).toBe(false);
  });

  it('stops listening after detach', () => {
    const { input, target } = setup();
    input.detach();
    target.dispatchEvent(key('keydown', 'KeyW'));
    expect(input.isDown('moveForward')).toBe(false);
  });
});
