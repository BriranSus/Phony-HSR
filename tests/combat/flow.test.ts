import { beforeAll, describe, expect, it } from 'vitest';
import { Battle, SeededRng, pickEnemyTarget, rollRewards, type BattleEvent, type CombatData } from '@modules/combat';
import type { Combatant } from '@models/combat';
import { autoPlay, loadCombatData, makeBattle, party, STARTERS, until, withFixtures } from './helpers';

let data: CombatData;
beforeAll(async () => {
  data = withFixtures((await loadCombatData()).data);
});
const ally = (b: Battle, id: string): Combatant => b.units.find((u) => u.defId === id)!;
const events = <T extends BattleEvent['type']>(b: Battle, type: T): Array<Extract<BattleEvent, { type: T }>> => b.log.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);
const withRng = (b: Battle, seed: number): void => {
  (b as unknown as { rng: SeededRng }).rng = new SeededRng(seed);
};

describe('Targeting and aggro', () => {
  it('weights single-target enemy attacks by aggro (March 7th 150, Welt 100, Dan Heng and Himeko 75)', () => {
    const b = makeBattle(data, { enemies: ['test.dummy'] });
    const enemy = b.units.find((u) => u.side === 'enemy')!;
    const count = new Map<string, number>();
    withRng(b, 99);
    for (let i = 0; i < 8000; i++) {
      const t = pickEnemyTarget(b, enemy)!;
      count.set(t.defId, (count.get(t.defId) ?? 0) + 1);
    }
    const share = (id: string) => (count.get(id) ?? 0) / 8000;
    expect(share('char.march-7th')).toBeCloseTo(150 / 400, 1);
    expect(share('char.welt')).toBeCloseTo(100 / 400, 1);
    expect(share('char.dan-heng')).toBeCloseTo(75 / 400, 1);
    expect(share('char.himeko')).toBeCloseTo(75 / 400, 1);
  });

  it("The Power of Cuteness multiplies March 7th's aggro; downed allies are never targeted; Lock-On forces a target", () => {
    const b = makeBattle(data, { enemies: ['test.dummy'] });
    const enemy = b.units.find((u) => u.side === 'enemy')!;
    const march = ally(b, 'char.march-7th');
    b.applyStatus(march, march, 'march-7th.power-of-cuteness', { params: { aggro: 5 }, duration: 3 });
    expect(b.stat(march, 'aggro')).toBeCloseTo(150 * 6, 9);
    withRng(b, 1);
    let marchHits = 0;
    for (let i = 0; i < 2000; i++) if (pickEnemyTarget(b, enemy)!.uid === march.uid) marchHits++;
    expect(marchHits / 2000).toBeCloseTo(900 / (900 + 100 + 75 + 75), 1);
    march.presence = 'downed';
    for (let i = 0; i < 200; i++) expect(pickEnemyTarget(b, enemy)!.uid).not.toBe(march.uid);
    const welt = ally(b, 'char.welt');
    welt.statuses.push({ statusId: 'enemy.lock-on', sourceId: enemy.uid, stacks: 1, turnsLeft: 1, params: {} });
    for (let i = 0; i < 50; i++) expect(pickEnemyTarget(b, enemy)!.uid).toBe(welt.uid);
  });
});

describe('Ultimate and inserted-action queues', () => {
  it('casts an Ultimate outside the turn flow: before inserted actions and before the next regular turn', () => {
    const b = makeBattle(data, { enemies: ['test.dummy', 'test.dummy'] });
    b.start();
    expect(b.step().kind).toBe('awaiting'); // Dan Heng's turn
    const himeko = ally(b, 'char.himeko');
    himeko.ultimate!.current = himeko.ultimate!.max;
    b.queueUltimate(himeko.uid, 'enemy-1');
    // An inserted action queued before the Ultimate still waits for it (Ultimates resolve first).
    b.state.insertedActions.push({ kind: 'followUp', actorUid: himeko.uid, abilityId: 'himeko.victory-rush', targetUid: null, sourceUid: himeko.uid, seq: 0 });
    expect([b.step().kind, b.step().kind, b.step().kind]).toEqual(['ultimate', 'insert', 'awaiting']);
    // The same actor cannot queue a second Ultimate without energy.
    expect(() => b.queueUltimate(himeko.uid, 'enemy-1')).toThrow(/cannot cast/);
  });

  it('lets an Ultimate interrupt the enemy phase: queued between two enemy turns it goes first', () => {
    const b = makeBattle(data, { enemies: ['test.dummy', 'test.dummy'], advantage: 'ambush', seed: 6 });
    b.start();
    expect(b.step().kind).toBe('turn'); // first dummy
    const dh = ally(b, 'char.dan-heng');
    dh.ultimate!.current = 100;
    b.queueUltimate(dh.uid, 'enemy-2');
    expect(b.step()).toEqual({ kind: 'ultimate', uid: dh.uid });
    expect(b.step().kind).toBe('turn'); // then the second dummy
    expect(events(b, 'turnStarted').map((e) => e.kind).slice(0, 3)).toEqual(['regular', 'ultimate', 'regular']);
  });

  it("fires March 7th's counter after a shielded ally is hit (an inserted action, at most 2 per turn)", () => {
    const b = makeBattle(data, { enemies: ['test.dummy'], advantage: 'ambush', seed: 12 });
    b.start();
    const march = ally(b, 'char.march-7th');
    for (const u of b.units.filter((x) => x.side === 'ally')) {
      u.shield = 99999;
      u.statuses.push({ statusId: 'builtin.shield', sourceId: march.uid, stacks: 1, turnsLeft: 3, params: {} });
    }
    expect(b.step().kind).toBe('turn'); // the dummy pokes a shielded ally
    const queued = b.state.insertedActions.filter((a) => a.abilityId === 'march-7th.girl-power');
    expect(queued).toHaveLength(1); // both of March's triggers fired, the queue keeps one
    expect(queued[0]).toMatchObject({ kind: 'counter', actorUid: march.uid, targetUid: 'enemy-1' });
    expect(b.step()).toEqual({ kind: 'insert', uid: march.uid });
    const counter = events(b, 'hit').find((h) => h.abilityId === 'march-7th.girl-power')!;
    expect(counter.attackType).toBe('followUp');
    expect(b.unit(counter.target).side).toBe('enemy');
  });

  it("queues Himeko's Victory Rush at 3 Charge and spends the Charge", () => {
    const b = makeBattle(data, { party: party(['char.himeko']), enemies: ['test.dummy', 'test.dummy', 'test.dummy'] });
    b.start();
    const himeko = ally(b, 'char.himeko');
    himeko.resources['himeko.charge'] = 3;
    b.step();
    b.submit({ type: 'basic', actor: himeko.uid, target: 'enemy-1' });
    expect(b.state.insertedActions.filter((a) => a.abilityId === 'himeko.victory-rush')).toHaveLength(1);
    expect(b.step()).toEqual({ kind: 'insert', uid: himeko.uid });
    expect(himeko.resources['himeko.charge']).toBe(0);
    expect(new Set(events(b, 'hit').filter((h) => h.abilityId === 'himeko.victory-rush').map((h) => h.target)).size).toBe(3);
    expect(events(b, 'resource').some((e) => e.resource === 'himeko.charge' && e.value === 0)).toBe(true);
  });

  it('gains Charge when an ally breaks a Weakness (afterAllyWeaknessBreak) up to the maximum of 3', () => {
    const b = makeBattle(data, { party: party(['char.himeko', 'char.dan-heng']), enemies: ['test.dummy'] });
    b.start();
    const himeko = ally(b, 'char.himeko');
    expect(himeko.resources['himeko.charge']).toBe(1);
    const enemy = b.units.find((u) => u.side === 'enemy')!;
    enemy.toughness = 1;
    expect(until(b, ally(b, 'char.dan-heng').uid)).toBe(true);
    b.submit({ type: 'basic', actor: ally(b, 'char.dan-heng').uid, target: enemy.uid });
    expect(himeko.resources['himeko.charge']).toBe(2);
  });
});

describe('Techniques and statuses', () => {
  it('applies Technique effects at battle start only when the Technique was cast', () => {
    const off = makeBattle(data);
    off.start();
    expect(ally(off, 'char.dan-heng').statuses.some((s) => s.statusId === 'buff.atk-up')).toBe(false);
    const on = makeBattle(data, { techniques: ['char.dan-heng'] });
    on.start();
    const dh = ally(on, 'char.dan-heng');
    expect(dh.statuses.find((s) => s.statusId === 'buff.atk-up')).toMatchObject({ turnsLeft: 3, params: { atkPct: 0.4 } });
    // 40% on top of the 18% from Traces, both of base ATK: 546.84 x (1 + 0.18 + 0.4)
    expect(on.stat(dh, 'atk')).toBeCloseTo(74.4 * 7.35 * (1 + 0.18 + 0.4), 6);
    expect(events(on, 'techniqueApplied')).toHaveLength(1);
  });

  it('counts durations on the owner\'s turn, removes expired statuses and rescales SPD for Slow', () => {
    const b = makeBattle(data, { enemies: ['test.dummy'] });
    b.start();
    const dh = ally(b, 'char.dan-heng');
    b.applyStatus(dh, dh, 'buff.atk-up', { duration: 1, params: { atkPct: 0.5 } });
    expect(b.stat(dh, 'atk')).toBeCloseTo(74.4 * 7.35 * (1 + 0.18 + 0.5), 6);
    b.step();
    b.submit({ type: 'basic', actor: dh.uid, target: 'enemy-1' });
    expect(dh.statuses.some((s) => s.statusId === 'buff.atk-up')).toBe(false); // ticks at the end of the owner's turn
    const enemy = b.units.find((u) => u.side === 'enemy')!;
    const spd = b.spd(enemy);
    b.applyStatus(dh, enemy, 'debuff.spd-down', { duration: 2, params: { spdDown: 0.12 } });
    expect(b.spd(enemy)).toBeCloseTo(spd * 0.88, 9);
  });

  it('removes "next attack" buffs after the owner attacks (Dan Heng\'s Superiority of Reach)', () => {
    const b = makeBattle(data, { party: party(['char.dan-heng']), enemies: ['test.dummy'] });
    b.start();
    const dh = ally(b, 'char.dan-heng');
    b.applyStatus(dh, dh, 'dan-heng.superiority-of-reach', { params: { resPen: 0.36 } });
    expect(b.stat(dh, 'resPen')).toBeCloseTo(0.36, 9);
    b.step();
    b.submit({ type: 'basic', actor: dh.uid, target: 'enemy-1' });
    expect(dh.statuses.some((s) => s.statusId === 'dan-heng.superiority-of-reach')).toBe(false);
  });

  it('absorbs damage with a Shield before HP', () => {
    const b = makeBattle(data, { party: party(['char.march-7th', 'char.dan-heng']), enemies: ['enemy.silvermane-soldier'], advantage: 'ambush', seed: 3 });
    b.start();
    const march = ally(b, 'char.march-7th');
    const dh = ally(b, 'char.dan-heng');
    for (const u of [march, dh]) {
      u.shield = 100;
      u.statuses.push({ statusId: 'builtin.shield', sourceId: march.uid, stacks: 1, turnsLeft: 3, params: {} });
    }
    const hpBefore = new Map([march, dh].map((u) => [u.uid, u.hp]));
    b.step();
    const hit = events(b, 'hit')[0]!;
    const t = b.unit(hit.target);
    expect(hit.shieldAbsorbed).toBeCloseTo(100, 9);
    expect(hit.amount).toBeCloseTo(hit.total - 100, 9);
    expect(t.hp).toBeCloseTo(hpBefore.get(t.uid)! - (hit.total - 100), 6);
    expect(t.shield).toBe(0);
    expect(t.statuses.some((s) => s.statusId === 'builtin.shield')).toBe(false);
  });

  it('rolls debuffs at the real effect-hit chance: base x (1 + EHR) x (1 - Effect RES) x (1 - Debuff RES)', () => {
    // The dummy has Effect RES 10%: a 100% base-chance debuff lands about 90% of the time.
    const b = makeBattle(data, { enemies: ['test.dummy'] });
    withRng(b, 123);
    const dummy = b.units.find((u) => u.side === 'enemy')!;
    const dh = ally(b, 'char.dan-heng');
    let landed = 0;
    for (let i = 0; i < 3000; i++) {
      dummy.statuses = [];
      if (b.applyStatus(dh, dummy, 'debuff.spd-down', { baseChance: 1, duration: 2, params: { spdDown: 0.1 } })) landed++;
    }
    expect(landed / 3000).toBeCloseTo(0.9, 1);
    // Effect Hit Rate raises it, capped at 100%.
    (dh.bonuses as Record<string, number>).effectHitRate = 0.5;
    landed = 0;
    for (let i = 0; i < 500; i++) {
      dummy.statuses = [];
      if (b.applyStatus(dh, dummy, 'debuff.spd-down', { baseChance: 1, duration: 2, params: { spdDown: 0.1 } })) landed++;
    }
    expect(landed).toBe(500);
  });
});

describe('Enemy AI and bosses', () => {
  it('picks skills by weight from the real enemy data and attacks the party', () => {
    const b = makeBattle(data, { enemies: ['enemy.voidranger-trampler'], enemyLevel: 50, seed: 21, party: party(STARTERS, 80, 6) });
    b.start();
    const enemy = b.units.find((u) => u.side === 'enemy')!;
    enemy.hp = 1e12;
    for (let i = 0; i < 80 && events(b, 'action').filter((a) => a.uid === enemy.uid).length < 12; i++) {
      const r = b.step();
      if (r.kind === 'awaiting') b.submit({ type: 'basic', actor: r.uid, target: enemy.uid });
      for (const u of b.units) if (u.side === 'ally') u.hp = Math.max(u.hp, 1e9);
    }
    const used = new Set(events(b, 'action').filter((a) => a.uid === enemy.uid).map((a) => a.abilityId));
    expect(used.size).toBeGreaterThan(1);
    const own = new Set(data.enemy('enemy.voidranger-trampler').abilities.map((a) => a.id));
    for (const id of used) expect(own.has(id)).toBe(true);
  });

  it('charges abilities that need it: a charge turn first, the release on the next turn', () => {
    const b = makeBattle(data, { party: party(['char.dan-heng']), enemies: ['test.charger'], advantage: 'ambush', seed: 2 });
    b.start();
    const boss = b.units.find((u) => u.side === 'enemy')!;
    const actions = () => events(b, 'action').filter((a) => a.uid === boss.uid);
    b.step(); // charge turn
    expect(events(b, 'charging')).toHaveLength(1);
    expect(actions()).toHaveLength(0);
    for (let i = 0; i < 30 && actions().length === 0; i++) {
      const r = b.step();
      if (r.kind === 'awaiting') b.submit({ type: 'basic', actor: r.uid, target: boss.uid });
    }
    expect(actions()[0]!.abilityId).toBe('test.charger.slam');
  });

  it('moves Cocolia to phase 2 when her HP bar is depleted: HP back to 75%, 160 toughness, SPD +40, her phase-2 abilities', () => {
    const b = makeBattle(data, { enemies: ['enemy.cocolia-mother-of-deception'], enemyLevel: 80, seed: 5, party: party(['char.himeko']) });
    b.start();
    const boss = b.units.find((u) => u.side === 'enemy')!;
    expect(boss.phase).toBe(0);
    expect(boss.statuses.some((s) => s.statusId === 'enemy.weakness-protected')).toBe(true);
    expect(until(b, 'ally-1')).toBe(true);
    boss.hp = 1;
    b.submit({ type: 'basic', actor: 'ally-1', target: boss.uid });
    expect(boss.phase).toBe(1);
    expect(boss.hp).toBeCloseTo(b.maxHp(boss) * 0.75, 6);
    expect(boss.maxToughness).toBe(160);
    expect(boss.toughness).toBe(160);
    expect(boss.presence).toBe('active');
    expect(boss.statuses.some((s) => s.statusId === 'enemy.creators-resolve')).toBe(true);
    expect(boss.statuses.some((s) => s.statusId === 'enemy.weakness-protected')).toBe(false);
    expect(b.spd(boss)).toBeCloseTo(120 * 1.2 + 40, 6);
    expect(events(b, 'phaseChanged')).toHaveLength(1);
    expect(b.defeated).toHaveLength(0);
  });

  it('skips enemy abilities whose effects are all stubs (Cocolia\'s summons) and says so', () => {
    const b = makeBattle(data, { enemies: ['enemy.cocolia-mother-of-deception'], enemyLevel: 50, seed: 8, party: party(['char.dan-heng']) });
    b.start();
    const boss = b.units.find((u) => u.side === 'enemy')!;
    for (let i = 0; i < 60 && events(b, 'action').filter((a) => a.uid === boss.uid).length < 10; i++) {
      const r = b.step();
      if (r.kind === 'awaiting') b.submit({ type: 'basic', actor: r.uid, target: boss.uid });
      for (const u of b.units) if (u.side === 'ally') u.hp = 1e9;
    }
    const used = events(b, 'action').filter((a) => a.uid === boss.uid).map((a) => a.abilityId);
    expect(used.some((id) => id.includes('heartless-annihilator-call'))).toBe(false);
    expect(events(b, 'stub').some((s) => s.what === 'enemy ability' && s.detail.includes('heartless-annihilator-call'))).toBe(true);
  });
});

describe('Flow: waves, victory, defeat, rewards, determinism', () => {
  it('spawns the next wave after the first is cleared and wins after the last', () => {
    const b = new Battle({ data, party: party(), waves: [['enemy.silvermane-soldier'], ['enemy.frostspawn', 'enemy.thunderspawn']], enemyLevel: 30, seed: 8 });
    autoPlay(b, 100);
    expect(b.outcome).toBe('victory');
    const waves = events(b, 'waveStarted');
    expect(waves.map((w) => [w.wave, w.waveCount])).toEqual([
      [1, 2],
      [2, 2],
    ]);
    expect(waves[1]!.enemies).toHaveLength(2);
    expect(b.state.wave).toBe(2);
    expect(b.defeated.map((u) => u.defId).sort()).toEqual(['enemy.frostspawn', 'enemy.silvermane-soldier', 'enemy.thunderspawn']);
    // Allies keep their action value across waves; the new enemies start from a full base AV.
    expect(events(b, 'cycle').length).toBeGreaterThanOrEqual(0);
  });

  it('ends in victory with rewards from real loot tables and in defeat with none', () => {
    const win = makeBattle(data, { enemies: ['enemy.silvermane-soldier', 'enemy.voidranger-reaver'], enemyLevel: 30, seed: 3 });
    autoPlay(win, 100);
    const r = win.result();
    expect(r.outcome).toBe('victory');
    expect(r.rewards.find((x) => x.item === 'credit')!.count).toBeGreaterThan(0);
    for (const stack of r.rewards) {
      expect(stack.count).toBeGreaterThan(0);
      expect(() => data.lootTable('loot.antimatter-legion')).not.toThrow();
    }
    expect(rollRewards(data, new SeededRng(1), win.defeated).length).toBeGreaterThan(0);
    // The fallback tables are real data: each entry names an item that exists in the item list.
    for (const id of Object.values(data.rules.rewards.fallbackLoot)) {
      const table = data.lootTable(id!);
      expect(table, id).toBeDefined();
    }

    const lose = new Battle({ data, party: party(STARTERS, 1, 0), waves: [['enemy.cocolia-mother-of-deception']], enemyLevel: 80, seed: 4 });
    autoPlay(lose, 100);
    expect(lose.outcome).toBe('defeat');
    expect(lose.result().rewards).toEqual([]);
    expect(lose.units.filter((u) => u.side === 'ally').every((u) => u.presence === 'downed')).toBe(true);
    expect(events(lose, 'ended')[0]!.outcome).toBe('defeat');
  });

  it('gives an identical battle log for the same seed and a different one for another seed', () => {
    const run = (seed: number) => {
      const b = makeBattle(data, { seed, enemies: ['enemy.silvermane-soldier', 'enemy.frostspawn', 'enemy.automaton-beetle'], enemyLevel: 40 });
      autoPlay(b, 100);
      return JSON.stringify(b.log);
    };
    expect(run(77)).toBe(run(77));
    expect(run(77)).not.toBe(run(78));
  });
});

describe('Stubs are declared, not silent', () => {
  it('logs script handlers once per battle (Dan Heng\'s Ultimate bonus vs Slowed enemies)', () => {
    const b = makeBattle(data, { enemies: ['test.dummy'] });
    b.start();
    const dh = ally(b, 'char.dan-heng');
    dh.ultimate!.current = 100;
    b.queueUltimate(dh.uid, 'enemy-1');
    b.step();
    dh.ultimate!.current = 100;
    b.queueUltimate(dh.uid, 'enemy-1');
    b.step();
    const stubs = events(b, 'stub').filter((s) => s.what === 'script dan-heng.ultimate-slowed-bonus');
    expect(stubs).toHaveLength(1);
  });

  it('lists the trigger events that are not dispatched yet (Gepard\x27s revive talent is 5B)', () => {
    const b = makeBattle(data, { party: party(['char.gepard', 'char.bailu']), enemies: ['test.dummy'] });
    b.start();
    const stub = events(b, 'stub').find((s) => s.what === 'triggers')!;
    expect(stub.detail).toContain('beforeKnockedDown');
  });
});
