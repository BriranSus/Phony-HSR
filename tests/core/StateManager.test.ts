import { describe, expect, it } from 'vitest';
import { StateManager, type GameState, type StateChange } from '@core/state/StateManager';

function makeState(id: string, log: string[], opts: { overlay?: boolean; enterDelay?: number } = {}): GameState<unknown> {
  return {
    id,
    isOverlay: opts.overlay,
    async enter(params) {
      if (opts.enterDelay) await new Promise((r) => setTimeout(r, opts.enterDelay));
      log.push(`${id}:enter${params ? `(${JSON.stringify(params)})` : ''}`);
    },
    exit() {
      log.push(`${id}:exit`);
    },
    pause() {
      log.push(`${id}:pause`);
    },
    resume() {
      log.push(`${id}:resume`);
    },
    update() {
      log.push(`${id}:update`);
    },
    render() {
      log.push(`${id}:render`);
    },
    dispose() {
      log.push(`${id}:dispose`);
    },
  };
}

function setup(): { sm: StateManager; log: string[]; changes: StateChange[] } {
  const log: string[] = [];
  const changes: StateChange[] = [];
  const sm = new StateManager({ onChange: (c) => changes.push(c) });
  sm.register('title', () => makeState('title', log));
  sm.register('menu', () => makeState('menu', log, { overlay: true }));
  sm.register('scene', () => makeState('scene', log, { enterDelay: 5 }));
  return { sm, log, changes };
}

describe('StateManager', () => {
  it('pushes and pops with pause/resume and full teardown', async () => {
    const { sm, log, changes } = setup();
    await sm.reset('title');
    await sm.push('menu', { from: 'test' });
    expect(sm.stackIds).toEqual(['title', 'menu']);
    await sm.pop();
    expect(sm.stackIds).toEqual(['title']);
    expect(log).toEqual(['title:enter', 'title:pause', 'menu:enter({"from":"test"})', 'menu:exit', 'menu:dispose', 'title:resume']);
    expect(changes.map((c) => `${c.action}:${c.stack.join('>')}`)).toEqual(['reset:title', 'push:title>menu', 'pop:title']);
  });

  it('replace swaps the top state and reset clears the whole stack', async () => {
    const { sm, log } = setup();
    await sm.reset('title');
    await sm.push('menu');
    await sm.replace('scene');
    expect(sm.stackIds).toEqual(['title', 'scene']);
    log.length = 0;
    await sm.reset('menu');
    expect(sm.stackIds).toEqual(['menu']);
    expect(log).toEqual(['scene:exit', 'scene:dispose', 'title:exit', 'title:dispose', 'menu:enter']);
  });

  it('serialises overlapping operations in call order', async () => {
    const { sm } = setup();
    const ops = [sm.reset('title'), sm.push('scene'), sm.push('menu'), sm.pop()];
    expect(sm.busy).toBe(true);
    await Promise.all(ops);
    expect(sm.busy).toBe(false);
    expect(sm.stackIds).toEqual(['title', 'scene']);
  });

  it('updates/renders the top state, plus states below overlays', async () => {
    const { sm, log } = setup();
    await sm.reset('title');
    await sm.push('menu');
    log.length = 0;
    sm.update(0.016);
    sm.render(1);
    expect(log).toEqual(['title:update', 'menu:update', 'title:render', 'menu:render']);
    await sm.push('scene');
    log.length = 0;
    sm.update(0.016);
    expect(log).toEqual(['scene:update']);
  });

  it('wraps operations with the transitioner when requested', async () => {
    const { sm } = setup();
    const events: string[] = [];
    sm.setTransitioner({
      cover: async () => {
        events.push('cover');
      },
      reveal: async () => {
        events.push('reveal');
      },
    });
    await sm.reset('title');
    await sm.replace('scene', undefined, { transition: true });
    expect(events).toEqual(['cover', 'reveal']);
  });

  it('rejects unknown states and keeps working after a failure', async () => {
    const { sm } = setup();
    await expect(sm.push('nope')).rejects.toThrow(/not registered/);
    await expect(sm.pop()).rejects.toThrow(/empty/);
    await sm.reset('title');
    expect(sm.stackIds).toEqual(['title']);
    expect(() => sm.register('title', () => makeState('title', []))).toThrow(/already registered/);
  });

  it('validates that factories produce the registered id', async () => {
    const sm = new StateManager();
    sm.register('a', () => makeState('b', []));
    await expect(sm.reset('a')).rejects.toThrow(/produced a state with id "b"/);
  });
});
