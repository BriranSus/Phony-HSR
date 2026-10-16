import { beforeAll, describe, expect, it } from 'vitest';
import type { Battle, BattleEvent, CombatData } from '@modules/combat';
import type { Combatant } from '@models/combat';
import { loadCombatData, makeBattle, party, STARTERS, withFixtures } from './helpers';

let data: CombatData;
beforeAll(async () => {
  data = withFixtures((await loadCombatData()).data);
});

const ally = (b: Battle, id: string): Combatant => b.units.find((u) => u.defId === id)!;
const dummies = (n: number): string[] => Array(n).fill('test.dummy');

/** Plays Basic ATKs on the first enemy until `turns` regular turns have started; returns [name, AV] pairs. */
function record(b: Battle, turns: number): Array<[string, number]> {
  const seen: Array<[string, number]> = [];
  b.subscribe((e) => {
    if (e.type === 'turnStarted' && e.kind === 'regular') seen.push([b.nameOf(e.uid), e.av]);
  });
  b.start();
  for (let i = 0; i < 1000 && seen.length < turns; i++) {
    const r = b.step();
    if (r.kind === 'awaiting') b.submit({ type: 'basic', actor: r.uid, target: b.selectableTargets(r.uid, 'basic')[0]?.uid ?? r.uid });
  }
  return seen;
}

describe('Action Value timeline', () => {
  it('predicts the turn order from 10000 / SPD (Dan Heng 110, Welt 102, March 7th 101, Himeko 96, dummies 83)', () => {
    const b = makeBattle(data, { enemies: dummies(2), enemyLevel: 50 });
    const order = b.turnOrder(6);
    expect(order.map((o) => b.nameOf(o.uid))).toEqual(['Dan Heng', 'Welt', 'March 7th', 'Himeko', 'Training Dummy A', 'Training Dummy B']);
    const av = (spd: number) => 10000 / spd;
    [av(110), av(102), av(101), av(96), av(83), av(83)].forEach((expected, i) => expect(order[i]!.actionValue).toBeCloseTo(expected, 6));
  });

  it('runs the real timeline: first cycle 150 AV, then 100 AV cycles, each unit acting every 10000 / SPD', () => {
    // Level 1 / ascension 0 unlocks no Major Traces, so no talent or trace changes anyone's SPD (Dan Heng's A4 does).
    const b = makeBattle(data, { party: party(STARTERS, 1, 0), enemies: dummies(2), enemyLevel: 50 });
    // Nobody in the party hits a Physical Weakness: no toughness damage, no breaks, no delays.
    for (const u of b.units) if (u.side === 'enemy') u.weaknesses = ['Physical'];
    const turns = record(b, 16);
    const expected: Array<[string, number]> = [
      ['Dan Heng', 10000 / 110],
      ['Welt', 10000 / 102],
      ['March 7th', 10000 / 101],
      ['Himeko', 10000 / 96],
      ['Training Dummy A', 10000 / 83],
      ['Training Dummy B', 10000 / 83],
      ['Dan Heng', 2 * (10000 / 110)],
      ['Welt', 2 * (10000 / 102)],
      ['March 7th', 2 * (10000 / 101)],
      ['Himeko', 2 * (10000 / 96)],
      ['Training Dummy A', 2 * (10000 / 83)],
      ['Training Dummy B', 2 * (10000 / 83)],
      ['Dan Heng', 3 * (10000 / 110)],
      ['Welt', 3 * (10000 / 102)],
      ['March 7th', 3 * (10000 / 101)],
      ['Himeko', 3 * (10000 / 96)],
    ];
    expect(turns.map(([n]) => n)).toEqual(expected.map(([n]) => n));
    turns.forEach(([, av], i) => expect(av).toBeCloseTo(expected[i]![1], 6));
    // Cycle 2 starts after 150 AV (Dan Heng's second turn at 181.8), cycle 3 after 250 AV (his third at 272.7).
    const cycleIdx = (c: number) => b.log.findIndex((e) => e.type === 'cycle' && e.cycle === c);
    const turnIdx = (n: number) => b.log.findIndex((e, i) => e.type === 'turnStarted' && Math.abs(e.av - n) < 1e-6 && i > 0);
    expect(cycleIdx(2)).toBeGreaterThan(-1);
    expect(cycleIdx(2)).toBeLessThan(turnIdx(2 * (10000 / 110)));
    expect(cycleIdx(2)).toBeGreaterThan(turnIdx(10000 / 83));
    expect(cycleIdx(3)).toBeLessThan(turnIdx(3 * (10000 / 110)));
    expect(cycleIdx(3)).toBeGreaterThan(turnIdx(2 * (10000 / 83)) - 1);
    expect(b.state.cycle).toBe(3);
  });

  it('advances and delays actions by a fraction of the base AV and floors at 0', () => {
    const b = makeBattle(data);
    const himeko = ally(b, 'char.himeko');
    const base = 10000 / 96;
    expect(himeko.actionValue).toBeCloseTo(base, 6);
    b.shiftAction(himeko, 0.5);
    expect(himeko.actionValue).toBeCloseTo(base * 0.5, 6);
    b.shiftAction(himeko, -0.3);
    expect(himeko.actionValue).toBeCloseTo(base * 0.8, 6);
    b.shiftAction(himeko, 5);
    expect(himeko.actionValue).toBe(0);
  });

  it('delays with a Crowd Control status that carries `delayOnApply` (Welt\'s Imprisonment: 20% base AV)', () => {
    const b = makeBattle(data, { enemies: dummies(1) });
    const enemy = b.units.find((u) => u.side === 'enemy')!;
    const welt = ally(b, 'char.welt');
    const before = enemy.actionValue;
    b.applyStatus(welt, enemy, 'welt.imprisonment', { duration: 1, params: { delay: 0.2, spdDown: 0.1 } });
    // SPD -10% rescales the remaining AV first (x 1 / 0.9), then the status delays by 20% of the new base AV.
    expect(enemy.actionValue).toBeCloseTo(before / 0.9 + 0.2 * (10000 / (83 * 0.9)), 6);
  });

  it('rescales the remaining AV when SPD changes (the distance to the next turn is kept)', () => {
    const b = makeBattle(data);
    const dh = ally(b, 'char.dan-heng');
    const before = dh.actionValue;
    b.applyStatus(dh, dh, 'buff.spd-up', { duration: 2, params: { spdPct: 0.2 } });
    expect(b.spd(dh)).toBeCloseTo(132, 9);
    expect(dh.actionValue).toBeCloseTo((before * 110) / 132, 6);
    b.removeStatus(dh, 'buff.spd-up');
    expect(dh.actionValue).toBeCloseTo(before, 6);
  });

  it('opens with Player Strike (allies 25% advanced), Ambush (enemies act first) or neutral', () => {
    const start = (advantage: 'neutral' | 'playerStrike' | 'ambush') => {
      const b = makeBattle(data, { advantage, enemies: dummies(1) });
      b.start();
      return b;
    };
    const neutral = start('neutral');
    const strike = start('playerStrike');
    const ambush = start('ambush');
    for (const id of STARTERS) {
      expect(ally(strike, id).actionValue).toBeCloseTo(ally(neutral, id).actionValue * 0.75, 6);
      expect(ally(ambush, id).actionValue).toBeCloseTo(ally(neutral, id).actionValue, 6);
    }
    const enemy = (b: Battle) => b.units.find((u) => u.side === 'enemy')!;
    expect(enemy(strike).actionValue).toBeCloseTo(enemy(neutral).actionValue, 6);
    expect(enemy(ambush).actionValue).toBe(0);
    const first = ambush.step();
    expect(first.kind).toBe('turn');
    expect(ambush.nameOf((first as { uid: string }).uid)).toBe('Training Dummy');
    // A strike makes Dan Heng act at 75% of the AV he normally needs; the order bar reflects it too.
    strike.step();
    const started = strike.log.find((e): e is Extract<BattleEvent, { type: 'turnStarted' }> => e.type === 'turnStarted')!;
    expect(started.av).toBeCloseTo((10000 / 110) * 0.75, 6);
    expect(strike.turnOrder(1)[0]!.actionValue).toBeGreaterThan(0);
  });
});
