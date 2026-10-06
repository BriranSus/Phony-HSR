import { describe, expect, it } from 'vitest';
import { ModuleGraphError, ModuleManager, topologicalOrder } from '@core/modules/ModuleManager';
import { defineStubModule, type GameModule } from '@core/modules/GameModule';
import { Logger } from '@core/log/Logger';
import { ServiceRegistry } from '@core/di/ServiceRegistry';
import { ALL_MODULES } from '@modules/index';

const silent = Logger.create({ level: 'silent', sinks: [] });

describe('module dependency graph', () => {
  it('orders modules so dependencies come first', () => {
    const order = topologicalOrder([
      { id: 'combat', dependsOn: ['skills', 'status'] },
      { id: 'skills', dependsOn: ['status'] },
      { id: 'status', dependsOn: [] },
    ]);
    expect(order).toEqual(['status', 'skills', 'combat']);
  });

  it('rejects cycles, unknown dependencies, self-dependencies and duplicates', () => {
    expect(() => topologicalOrder([{ id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: ['a'] }])).toThrow(/cycle/);
    expect(() => topologicalOrder([{ id: 'a', dependsOn: ['ghost'] }])).toThrow(/unknown module "ghost"/);
    expect(() => topologicalOrder([{ id: 'a', dependsOn: ['a'] }])).toThrow(/itself/);
    expect(() => topologicalOrder([{ id: 'a', dependsOn: [] }, { id: 'a', dependsOn: [] }])).toThrow(ModuleGraphError);
  });

  it('the real game module graph is complete and acyclic', () => {
    const order = topologicalOrder(ALL_MODULES);
    expect(order).toHaveLength(ALL_MODULES.length);
    const pos = new Map(order.map((id, i) => [id, i]));
    for (const m of ALL_MODULES) for (const d of m.dependsOn) expect(pos.get(d)).toBeLessThan(pos.get(m.id) as number);
  });

  it('covers every system the spec requires to be separated (section 36)', () => {
    const ids = new Set(ALL_MODULES.map((m) => m.id));
    for (const required of [
      'combat',
      'characters',
      'enemies',
      'skills',
      'status',
      'inventory',
      'relics',
      'lightcones',
      'quest',
      'dialogue',
      'world',
      'ui',
      'audio',
      'vfx',
      'save',
      'economy',
      'gacha',
      'events',
      'endgame',
    ]) {
      expect(ids.has(required), required).toBe(true);
    }
    for (const m of ALL_MODULES) expect(m.phase).toBeGreaterThanOrEqual(1);
  });

  it('initialises modules in dependency order and disposes in reverse', async () => {
    const log: string[] = [];
    const mk = (id: string, dependsOn: string[]): GameModule => ({
      ...defineStubModule({ id, name: id, phase: 1, dependsOn }),
      init: () => {
        log.push(`init:${id}`);
      },
      dispose: () => {
        log.push(`dispose:${id}`);
      },
    });
    const mm = new ModuleManager().registerAll([mk('c', ['b']), mk('a', []), mk('b', ['a'])]);
    await mm.initAll({ services: new ServiceRegistry(), logger: silent });
    mm.disposeAll();
    expect(log).toEqual(['init:a', 'init:b', 'init:c', 'dispose:c', 'dispose:b', 'dispose:a']);
    expect(() => mm.register(mk('a', []))).toThrow(/already registered/);
  });

  it('boots every real module headlessly', async () => {
    const mm = new ModuleManager().registerAll(ALL_MODULES);
    const seen: string[] = [];
    await mm.initAll({ services: new ServiceRegistry(), logger: silent }, (m) => seen.push(m.id));
    expect(seen).toHaveLength(ALL_MODULES.length);
  });
});
