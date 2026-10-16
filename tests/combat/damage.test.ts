import { beforeAll, describe, expect, it } from 'vitest';
import { SeededRng, hashSeed, type Battle, type BattleEvent, type CombatData } from '@modules/combat';
import type { Combatant } from '@models/combat';
import { loadCombatData, makeBattle, party, until, withFixtures } from './helpers';

let data: CombatData;
beforeAll(async () => {
  data = withFixtures((await loadCombatData()).data);
});
const ally = (b: Battle, id: string): Combatant => b.units.find((u) => u.defId === id)!;
const events = <T extends BattleEvent['type']>(b: Battle, type: T): Array<Extract<BattleEvent, { type: T }>> => b.log.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);
const hitsBy = (b: Battle, uid: string) => events(b, 'hit').filter((h) => h.source === uid);

/*
 * Hand-derived constants (Lv80 / ascension 6 party, every Trace unlocked, no Light Cone, target Lv50):
 *   stat = base x (1 + 2.4 + 0.05 x 79) = base x 7.35, then x (1 + Trace %):
 *     Dan Heng  ATK 74.4  x 7.35 x 1.18  = 645.2712 (ATK% 4 + 6 + 8), Wind DMG 3.2 + 3.2 + 4.8 + 4.8 + 6.4 = 22.4%
 *     Himeko    ATK 102.96 x 7.35 x 1.18 = 892.97208 (same ATK%), Fire DMG +22.4%
 *     March 7th ATK 69.6  x 7.35         = 511.56   (no ATK% Traces), Ice DMG +22.4%
 *   Enemy DEF = 200 + 10 x 50 = 700; DEF zone = (80 + 20) / ((50 + 20) + (80 + 20)) = 100 / 170
 *   Unbroken enemies take 0.9; a non-weak Type is resisted by 20%.
 */
const DEF_ZONE = 100 / 170;

describe('Seeded RNG', () => {
  it('is mulberry32: a fixed seed always gives the same stream', () => {
    const r = new SeededRng(1);
    expect([r.next(), r.next(), r.next(), r.next()]).toEqual([0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741]);
    expect(new SeededRng(12345).next()).toBe(0.9797282677609473);
    expect(hashSeed('astral')).toBe(hashSeed('astral'));
    expect(hashSeed('astral')).not.toBe(hashSeed('rail'));
  });

  it('picks by weight with exactly one draw and never picks weight 0', () => {
    const r = new SeededRng(5);
    const counts = [0, 0, 0];
    for (let i = 0; i < 6000; i++) counts[r.weighted([0, 1, 2], (i2) => [0, 1, 3][i2]!) as number]!++;
    expect(counts[0]).toBe(0);
    expect(counts[2]! / 6000).toBeCloseTo(0.75, 1);
    expect(r.weighted([0, 0], (w) => w)).toBeNull();
  });
});

describe('Damage pipeline', () => {
  it('matches the hand calculation for Dan Heng\'s Basic ATK, crit and non-crit (Lv50 dummy weak to Wind)', () => {
    const seen = new Set<boolean>();
    for (let seed = 1; seed < 40 && seen.size < 2; seed++) {
      const b = makeBattle(data, { seed, enemies: ['test.dummy'] });
      b.start();
      b.step();
      b.submit({ type: 'basic', actor: 'ally-2', target: 'enemy-1' });
      const hit = hitsBy(b, 'ally-2')[0]!;
      // Basic ATK Lv6 = 100% ATK x (1 + 22.4% Wind DMG) x CRIT (+50% on a crit) x DEF x RES (weak: 1) x unbroken 0.9
      const expected = 645.2712 * 1.0 * 1.224 * (hit.crit ? 1.5 : 1) * DEF_ZONE * 1 * 0.9;
      expect(hit.total).toBeCloseTo(expected, 3);
      expect(hit.weakness).toBe(true);
      seen.add(hit.crit);
    }
    expect([...seen].sort()).toEqual([false, true]);
  });

  it('rolls the same CRITs for the same seed', () => {
    const run = (seed: number) => {
      const b = makeBattle(data, { seed, enemies: ['test.dummy', 'test.dummy', 'test.dummy'] });
      b.start();
      for (let i = 0; i < 40 && b.turns < 12; i++) {
        const r = b.step();
        if (r.kind === 'awaiting') b.submit({ type: b.canUse(r.uid, 'skill').ok ? 'skill' : 'basic', actor: r.uid, target: 'enemy-2' });
      }
      return events(b, 'hit').filter((h) => b.unit(h.source).side === 'ally').map((h) => h.crit);
    };
    expect(run(2)).toEqual(run(2));
    const rolls = run(2);
    expect(rolls.some(Boolean) && rolls.some((c) => !c)).toBe(true);
  });

  it('resists a non-weak Type by 20% (March 7th Ice vs a dummy weak to Wind)', () => {
    const b = makeBattle(data, { party: party(['char.march-7th']), enemies: ['test.dummy'], seed: 1 });
    b.start();
    b.step();
    b.submit({ type: 'basic', actor: 'ally-1', target: 'enemy-1' });
    const hit = hitsBy(b, 'ally-1')[0]!;
    expect(hit.weakness).toBe(false);
    expect(hit.toughnessDamage).toBe(0);
    expect(hit.total).toBeCloseTo(511.56 * 1.0 * 1.224 * (hit.crit ? 1.5 : 1) * DEF_ZONE * 0.8 * 0.9, 3);
  });

  it('computes enemy damage with the character DEF formula (real Silvermane Soldier, Lv50 Tireless Charge x3 ATK)', () => {
    const b = makeBattle(data, { enemies: ['enemy.silvermane-soldier'], advantage: 'ambush', seed: 3 });
    b.start();
    b.step();
    const hit = events(b, 'hit')[0]!;
    const target = b.unit(hit.target);
    const soldierAtk = 18 * 13.001774; // template ATK x the Lv50 curve
    const def = b.stat(target, 'def');
    const zone = 1 - def / (def + 200 + 10 * 50);
    expect(hit.total).toBeCloseTo(3 * soldierAtk * zone, 6);
    expect(hit.crit).toBe(false);
  });

  it('spreads blast damage to the units next to the main target (Himeko\'s Skill: 200% / 80%)', () => {
    const run = (target: string) => {
      const b = makeBattle(data, { party: party(['char.himeko']), enemies: ['test.dummy', 'test.dummy', 'test.dummy'], seed: 4 });
      b.start();
      b.step();
      b.submit({ type: 'skill', actor: 'ally-1', target });
      return hitsBy(b, 'ally-1');
    };
    const mid = run('enemy-2');
    expect(mid.map((h) => h.target).sort()).toEqual(['enemy-1', 'enemy-2', 'enemy-3']);
    const base = (h: { total: number; crit: boolean }) => h.total / (h.crit ? 1.5 : 1);
    const main = mid.find((h) => h.target === 'enemy-2')!;
    const side = mid.find((h) => h.target === 'enemy-1')!;
    // Himeko ATK (892.97208) x 2.0 x (1 + 22.4% Fire) x DEF x RES (Fire is not a Weakness: 0.8) x 0.9
    expect(base(main)).toBeCloseTo((102.96 * 7.35 * 1.18) * 2.0 * 1.224 * DEF_ZONE * 0.8 * 0.9, 3);
    expect(base(side)).toBeCloseTo((102.96 * 7.35 * 1.18) * 0.8 * 1.224 * DEF_ZONE * 0.8 * 0.9, 3);
    // An end target has a single neighbour.
    expect(run('enemy-1').map((h) => h.target).sort()).toEqual(['enemy-1', 'enemy-2']);
    expect(run('enemy-3').map((h) => h.target).sort()).toEqual(['enemy-2', 'enemy-3']);
  });

  it('hits every enemy with AoE, and a bounce skill hits 1 + bounces times (Welt: primary + 2 random)', () => {
    const b = makeBattle(data, { party: party(['char.himeko', 'char.welt']), enemies: ['test.dummy', 'test.dummy'], seed: 5 });
    b.start();
    ally(b, 'char.himeko').ultimate!.current = 120;
    b.queueUltimate('ally-1', 'enemy-1');
    b.step();
    expect(new Set(hitsBy(b, 'ally-1').map((h) => h.target))).toEqual(new Set(['enemy-1', 'enemy-2']));
    expect(until(b, 'ally-2')).toBe(true);
    const before = events(b, 'hit').length;
    b.submit({ type: 'skill', actor: 'ally-2', target: 'enemy-1' });
    const welt = events(b, 'hit').slice(before).filter((h) => h.source === 'ally-2');
    expect(welt).toHaveLength(3);
    expect(welt[0]!.target).toBe('enemy-1');
  });

  it('splits multi-hit damage with hitSplit and rolls each hit separately', () => {
    // Synthetic ability: 3 hits of 20% / 30% / 50%, to check the engine honours the data.
    const base = data.character('char.dan-heng');
    const split = {
      ...base,
      abilities: { ...base.abilities, basic: { ...base.abilities.basic, effects: [{ kind: 'damage' as const, target: 'primary' as const, stat: 'atk' as const, multiplier: { param: 'p1' }, toughness: 10, hitSplit: [0.2, 0.3, 0.5], source: 'self' as const }] } },
    };
    const d2: CombatData = { ...data, character: (id) => (id === 'char.dan-heng' ? split : data.character(id)) };
    const b = makeBattle(d2, { party: party(['char.dan-heng']), enemies: ['test.dummy'], seed: 8 });
    b.start();
    b.step();
    b.submit({ type: 'basic', actor: 'ally-1', target: 'enemy-1' });
    const hits = hitsBy(b, 'ally-1');
    expect(hits).toHaveLength(3);
    const unit = (h: (typeof hits)[number]) => h.total / (h.crit ? 1.5 : 1);
    expect(unit(hits[1]!) / unit(hits[0]!)).toBeCloseTo(1.5, 6);
    expect(unit(hits[2]!) / unit(hits[0]!)).toBeCloseTo(2.5, 6);
    expect(hits.reduce((s, h) => s + h.toughnessDamage, 0)).toBeCloseTo(10, 9);
  });
});
