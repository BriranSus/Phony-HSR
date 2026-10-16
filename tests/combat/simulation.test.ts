import { beforeAll, describe, expect, it } from 'vitest';
import { Battle, SeededRng, type CombatData } from '@modules/combat';
import { Collections } from '@models/collections';
import { loadCombatData } from './helpers';

let data: CombatData;
let characterIds: string[];
let enemyIds: string[];
beforeAll(async () => {
  const loaded = await loadCombatData();
  data = loaded.data;
  characterIds = loaded.registry.all(Collections.characters).map((c) => c.id);
  enemyIds = loaded.registry.all(Collections.enemies).map((e) => e.id);
});

/** One full battle driven by a random but seeded policy, checking the engine invariants after every step. */
function simulate(seed: number): { battle: Battle; steps: number } {
  const pick = new SeededRng(seed * 7919 + 13);
  const shuffled = [...characterIds].sort(() => pick.next() - 0.5);
  const members = shuffled.slice(0, pick.int(1, 4)).map((characterId) => ({ characterId, level: pick.int(20, 80), ascension: 6, eidolon: pick.int(0, 6) }));
  for (const m of members) {
    // Levels must sit inside the ascension's range; ascension 6 only allows 80, so use the matching phase.
    const caps = data.progression.levelCaps;
    const asc = caps.findIndex((cap) => m.level <= cap);
    (m as { ascension: number }).ascension = Math.max(0, asc);
  }
  const waveCount = pick.int(1, 2);
  const waves = Array.from({ length: waveCount }, () => Array.from({ length: pick.int(1, 5) }, () => pick.pick(enemyIds)));
  const battle = new Battle({ data, party: members, waves, enemyLevel: pick.int(10, 80), seed, advantage: pick.pick(['neutral', 'playerStrike', 'ambush'] as const), techniques: members.map((m) => m.characterId).filter(() => pick.chance(0.5)) });
  battle.start();
  const policy = new SeededRng(seed);
  let steps = 0;
  const check = (): void => {
    const sp = battle.state.skillPoints;
    expect(sp.current).toBeGreaterThanOrEqual(0);
    expect(sp.current).toBeLessThanOrEqual(sp.max);
    for (const u of battle.units) {
      expect(Number.isFinite(u.hp), `${u.uid} hp`).toBe(true);
      expect(u.hp, `${u.uid} hp`).toBeGreaterThanOrEqual(0);
      expect(u.hp, `${u.uid} hp max`).toBeLessThanOrEqual(battle.maxHp(u) + 1e-6);
      expect(u.actionValue, `${u.uid} av`).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(u.actionValue), `${u.uid} av`).toBe(true);
      expect(u.toughness).toBeGreaterThanOrEqual(0);
      if (u.ultimate) {
        expect(u.ultimate.current).toBeGreaterThanOrEqual(0);
        expect(u.ultimate.current).toBeLessThanOrEqual(u.ultimate.max + 1e-9);
      }
      if (u.presence !== 'active') expect(u.hp).toBe(0);
    }
  };
  while (battle.outcome === 'ongoing') {
    steps++;
    if (steps > 4000) throw new Error(`seed ${seed}: the battle did not finish in 4000 steps (turn ${battle.turns})`);
    for (const u of battle.units) {
      if (u.side === 'ally' && battle.canUltimate(u) && policy.chance(0.4)) {
        const t = battle.selectableTargets(u.uid, 'ultimate');
        battle.queueUltimate(u.uid, (t.length ? policy.pick(t) : u).uid);
      }
    }
    const r = battle.step();
    if (r.kind === 'awaiting') {
      const slot = battle.canUse(r.uid, 'skill').ok && policy.chance(0.6) ? 'skill' : 'basic';
      const targets = battle.selectableTargets(r.uid, slot);
      battle.submit({ type: slot, actor: r.uid, target: (targets.length ? policy.pick(targets) : battle.unit(r.uid)).uid });
    }
    check();
  }
  return { battle, steps };
}

describe('Headless full-battle simulation', () => {
  it('plays 60 random battles (random parties of 1-4 from the 18 characters, random enemy groups, 1-2 waves, any advantage) without breaking an invariant', { timeout: 120000 }, () => {
    const outcomes = { victory: 0, defeat: 0 };
    let turns = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const { battle } = simulate(seed);
      expect(['victory', 'defeat']).toContain(battle.outcome);
      outcomes[battle.outcome as 'victory' | 'defeat']++;
      turns += battle.turns;
      expect(battle.turns).toBeLessThan(2000); // a finite turn count
      // Skill Points never left 0..5, HP never below 0 (checked each step); the result is consistent.
      const result = battle.result();
      expect(result.turns).toBe(battle.turns);
      if (result.outcome === 'victory') expect(battle.units.filter((u) => u.side === 'enemy' && u.presence === 'active')).toHaveLength(0);
      else expect(battle.units.filter((u) => u.side === 'ally' && u.presence === 'active')).toHaveLength(0);
    }
    expect(outcomes.victory).toBeGreaterThan(5);
    expect(outcomes.defeat).toBeGreaterThan(0);
    expect(turns).toBeGreaterThan(300);
  });

  it('is reproducible: simulating a seed twice gives the same log', () => {
    expect(JSON.stringify(simulate(17).battle.log)).toBe(JSON.stringify(simulate(17).battle.log));
  });
});
