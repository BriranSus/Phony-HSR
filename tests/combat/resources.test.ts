import { beforeAll, describe, expect, it } from 'vitest';
import type { Battle, BattleEvent, CombatData } from '@modules/combat';
import type { Combatant } from '@models/combat';
import { loadCombatData, makeBattle, party, until, withFixtures } from './helpers';

let data: CombatData;
beforeAll(async () => {
  data = withFixtures((await loadCombatData()).data);
});
const ally = (b: Battle, id: string): Combatant => b.units.find((u) => u.defId === id)!;
const events = <T extends BattleEvent['type']>(b: Battle, type: T): Array<Extract<BattleEvent, { type: T }>> => b.log.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);

describe('Skill Points', () => {
  it('start at 3 / 5: Basic ATK gives +1, a Skill costs 1', () => {
    const b = makeBattle(data, { party: party(['char.dan-heng', 'char.welt']), enemies: ['test.dummy'] });
    b.start();
    expect(b.state.skillPoints).toEqual({ current: 3, max: 5 });
    expect(b.step()).toEqual({ kind: 'awaiting', uid: 'ally-1' }); // Dan Heng (SPD 110)
    b.submit({ type: 'basic', actor: 'ally-1', target: 'enemy-1' });
    expect(b.state.skillPoints.current).toBe(4);
    expect(b.step()).toEqual({ kind: 'awaiting', uid: 'ally-2' }); // Welt
    b.submit({ type: 'skill', actor: 'ally-2', target: 'enemy-1' });
    expect(b.state.skillPoints.current).toBe(3);
    expect(events(b, 'skillPoints').map((e) => e.delta)).toEqual([1, -1]);
  });

  it('refuse a Skill without points and never exceed the maximum of 5', () => {
    const b = makeBattle(data, { party: party(['char.dan-heng']), enemies: ['test.dummy'] });
    b.start();
    b.state.skillPoints.current = 0;
    expect(b.step().kind).toBe('awaiting');
    expect(b.canUse('ally-1', 'skill')).toEqual({ ok: false, reason: 'Not enough Skill Points' });
    expect(() => b.submit({ type: 'skill', actor: 'ally-1', target: 'enemy-1' })).toThrow(/Skill Points/);
    b.state.skillPoints.current = 5;
    b.submit({ type: 'basic', actor: 'ally-1', target: 'enemy-1' });
    expect(b.state.skillPoints.current).toBe(5);
    expect(events(b, 'skillPoints')).toHaveLength(0);
  });
});

describe('Energy', () => {
  it('starts at 50%, Basic +20, Skill +30 (capped at max); the Ultimate needs a full bar, resets it and gives +5', () => {
    const b = makeBattle(data, { party: party(['char.dan-heng']), enemies: ['test.dummy'] });
    b.start();
    const dh = ally(b, 'char.dan-heng');
    expect(dh.ultimate).toMatchObject({ kind: 'energy', current: 50, max: 100 });
    expect(b.canUse(dh.uid, 'ultimate').ok).toBe(false);
    b.step();
    b.submit({ type: 'basic', actor: dh.uid, target: 'enemy-1' });
    expect(dh.ultimate!.current).toBe(70);
    expect(until(b, dh.uid)).toBe(true);
    b.submit({ type: 'skill', actor: dh.uid, target: 'enemy-1' });
    expect(dh.ultimate!.current).toBe(100);
    expect(b.canUse(dh.uid, 'ultimate').ok).toBe(true);
    b.queueUltimate(dh.uid, 'enemy-1');
    expect(b.step()).toEqual({ kind: 'ultimate', uid: dh.uid });
    expect(dh.ultimate!.current).toBe(5);
  });

  it('scales regeneration with Energy Regeneration Rate', () => {
    const b = makeBattle(data, { party: party(['char.welt']), enemies: ['test.dummy'] });
    b.start();
    const welt = ally(b, 'char.welt');
    (welt.bonuses as Record<string, number>).energyRegen = 0.5;
    expect(welt.ultimate!.current).toBe(60); // 50% of 120
    b.step();
    b.submit({ type: 'basic', actor: welt.uid, target: 'enemy-1' });
    expect(welt.ultimate!.current).toBeCloseTo(60 + 20 * 1.5, 9);
  });

  it('charges the ally an enemy attack hits, and gives the killer 10 Energy', () => {
    const b = makeBattle(data, { party: party(['char.dan-heng', 'char.welt']), enemies: ['test.dummy'], advantage: 'ambush' });
    b.start();
    const before = new Map(b.units.filter((u) => u.side === 'ally').map((u) => [u.uid, u.ultimate!.current]));
    b.step(); // the dummy acts first (ambush) and pokes one ally: energyToTarget 10
    const hit = events(b, 'hit')[0]!;
    expect(b.unit(hit.target).ultimate!.current).toBeCloseTo(before.get(hit.target)! + 10, 9);
    const dh = ally(b, 'char.dan-heng');
    const enemy = b.units.find((u) => u.side === 'enemy')!;
    enemy.hp = 1;
    expect(until(b, dh.uid)).toBe(true);
    const e0 = dh.ultimate!.current;
    b.submit({ type: 'basic', actor: dh.uid, target: enemy.uid });
    expect(enemy.presence).toBe('downed');
    expect(dh.ultimate!.current).toBeCloseTo(e0 + 20 + 10, 9);
  });
});
