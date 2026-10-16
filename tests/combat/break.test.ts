import { beforeAll, describe, expect, it } from 'vitest';
import type { Battle, BattleEvent, CombatData } from '@modules/combat';
import type { Combatant } from '@models/combat';
import type { Element } from '@models/common';
import { loadCombatData, makeBattle, party, until, withFixtures } from './helpers';

let data: CombatData;
beforeAll(async () => {
  data = withFixtures((await loadCombatData()).data);
});
const events = <T extends BattleEvent['type']>(b: Battle, type: T): Array<Extract<BattleEvent, { type: T }>> => b.log.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);

// Break level multiplier of a Lv80 attacker (rules/combat levelMultiplier) and the Lv80-vs-Lv50 DEF zone.
const LV80 = 3767.5533;
const DEF_ZONE = 100 / 170;

/** One attacker against one dummy that is weak to `element`, one hit from breaking. */
function setup(charId: string, element: Element, enemy = 'test.dummy') {
  const b = makeBattle(data, { party: party([charId]), enemies: [enemy], enemyLevel: 50, seed: 9 });
  b.start();
  const target = b.units.find((u) => u.side === 'enemy')!;
  target.weaknesses = [element];
  target.toughness = 1;
  const attacker = b.units.find((u) => u.side === 'ally')!;
  return { b, target, attacker };
}

/** Plays Basic ATKs until the target's DoT event for `statusId` happens; returns it with the stacks at that moment. */
function untilTick(b: Battle, target: Combatant, statusId: string): { amount: number; stacks: number } | null {
  let stacks = 0;
  let amount: number | null = null;
  const unsub = b.subscribe((e) => {
    if (e.type === 'dot' && e.target === target.uid && e.statusId === statusId && amount === null) {
      stacks = target.statuses.find((s) => s.statusId === statusId)?.stacks ?? 1;
      amount = e.amount;
    }
  });
  for (let i = 0; i < 200 && amount === null && b.outcome === 'ongoing'; i++) {
    const r = b.step();
    if (r.kind === 'awaiting') b.submit({ type: 'basic', actor: r.uid, target: target.uid });
  }
  unsub();
  return amount === null ? null : { amount, stacks };
}

describe('Toughness', () => {
  it('real level multiplier table: Lv80 = 3767.5533', () => {
    expect(data.rules.levelMultiplier['80']).toBeCloseTo(LV80, 4);
  });

  it('only a matching Weakness reduces toughness (Himeko is not Wind-weak; Dan Heng is)', () => {
    const fire = makeBattle(data, { party: party(['char.himeko']), enemies: ['test.dummy'] });
    fire.start();
    fire.step();
    fire.submit({ type: 'basic', actor: 'ally-1', target: 'enemy-1' });
    expect(fire.units[1]!.toughness).toBe(20);
    expect(events(fire, 'hit')[0]!.toughnessDamage).toBe(0);

    const wind = makeBattle(data, { party: party(['char.dan-heng']), enemies: ['test.dummy'] });
    wind.start();
    wind.step();
    wind.submit({ type: 'basic', actor: 'ally-1', target: 'enemy-1' });
    expect(wind.units[1]!.toughness).toBe(10);
    expect(wind.units[1]!.broken).toBe(false);
    expect(events(wind, 'hit')[0]!.toughnessDamage).toBe(10);
  });

  it('scales toughness damage with Break Efficiency and splits it across hits', () => {
    const { b, target, attacker } = setup('char.dan-heng', 'Wind');
    target.toughness = 100;
    target.maxToughness = 100;
    (attacker.bonuses as Record<string, number>).breakEfficiency = 0.5;
    b.step();
    b.submit({ type: 'basic', actor: attacker.uid, target: target.uid });
    expect(target.toughness).toBeCloseTo(100 - 10 * 1.5, 9);
  });
});

describe('Weakness Break', () => {
  it('deals Break DMG from the real formula and breaks at 0 toughness (Dan Heng, Wind, 20 toughness, Lv50 target)', () => {
    const { b, target, attacker } = setup('char.dan-heng', 'Wind');
    target.toughness = 20;
    b.step();
    b.submit({ type: 'skill', actor: attacker.uid, target: target.uid });
    expect(target.broken).toBe(true);
    expect(target.toughness).toBe(0);
    const brk = events(b, 'weaknessBreak')[0]!;
    // Break DMG = Wind 1.5 x Lv80 multiplier x (0.5 + 20 / 40 = 1) x (1 + BE 0) x DEF zone; broken enemies take x1 (not 0.9).
    expect(brk.damage).toBeCloseTo(1.5 * LV80 * 1 * 1 * DEF_ZONE, 3);
    expect(brk.damage).toBeCloseTo(3324.3, 0);
    expect(events(b, 'hit')[0]!.broke).toBe(true);
  });

  it('adds Break Effect to Break DMG as (1 + BE)', () => {
    const { b, target, attacker } = setup('char.dan-heng', 'Wind');
    (attacker.bonuses as Record<string, number>).breakEffect = 0.8;
    b.step();
    b.submit({ type: 'basic', actor: attacker.uid, target: target.uid });
    expect(events(b, 'weaknessBreak')[0]!.damage).toBeCloseTo(1.5 * LV80 * 1.8 * DEF_ZONE, 3);
  });

  it('weights Break DMG by the target\'s Max Toughness (0.5 + MaxToughness / 40)', () => {
    const { b, target, attacker } = setup('char.dan-heng', 'Wind');
    target.maxToughness = 80;
    b.step();
    b.submit({ type: 'basic', actor: attacker.uid, target: target.uid });
    expect(events(b, 'weaknessBreak')[0]!.damage).toBeCloseTo(1.5 * LV80 * (0.5 + 80 / 40) * DEF_ZONE, 3);
  });

  it('delays the broken enemy by 25% of its base AV, and Quantum / Imaginary more (20% / 30% x (1 + BE))', () => {
    const cases: Array<[string, Element, number]> = [
      ['char.dan-heng', 'Wind', 0],
      ['char.seele', 'Quantum', 0.2],
      ['char.welt', 'Imaginary', 0.3],
    ];
    for (const [charId, element, extra] of cases) {
      const { b, target, attacker } = setup(charId, element);
      (attacker.bonuses as Record<string, number>).breakEffect = 0.5;
      b.step();
      const baseAv = 10000 / b.spd(target);
      const before = target.actionValue;
      b.submit({ type: 'basic', actor: attacker.uid, target: target.uid });
      const brk = events(b, 'weaknessBreak')[0]!;
      const expectedDelay = 0.25 + (extra > 0 ? extra * 1.5 : 0);
      expect(brk.delay).toBeCloseTo(expectedDelay, 9);
      // Imprisonment also lowers SPD by 10%, which rescales the AV first; compare the delay part separately.
      const slowed = element === 'Imaginary' ? 1 / 0.9 : 1;
      const newBase = 10000 / b.spd(target);
      expect(target.actionValue).toBeCloseTo(before * slowed + expectedDelay * newBase, 4);
      void baseAv;
    }
  });

  it('recovers toughness at the start of the broken enemy\'s next turn', () => {
    const { b, target, attacker } = setup('char.dan-heng', 'Wind');
    target.toughness = 20;
    b.step();
    b.submit({ type: 'skill', actor: attacker.uid, target: target.uid });
    expect(target.broken).toBe(true);
    for (let i = 0; i < 100 && target.broken; i++) {
      const r = b.step();
      if (r.kind === 'awaiting') b.submit({ type: 'basic', actor: r.uid, target: target.uid });
    }
    expect(target.broken).toBe(false);
    expect(target.toughness).toBe(target.maxToughness);
    expect(events(b, 'toughnessRecovered')).toHaveLength(1);
  });

  it('takes full damage while broken (zone 1.0 instead of 0.9) and applies protection from bosses', () => {
    const { b, target, attacker } = setup('char.dan-heng', 'Wind');
    target.toughness = 20;
    b.step();
    b.submit({ type: 'skill', actor: attacker.uid, target: target.uid });
    // Dan Heng acts again at once (advance 100%), before the broken dummy can recover on its own turn.
    b.shiftAction(attacker, 1);
    expect(until(b, attacker.uid)).toBe(true);
    expect(target.broken).toBe(true);
    const before = events(b, 'hit').length;
    b.submit({ type: 'basic', actor: attacker.uid, target: target.uid });
    const hit = events(b, 'hit').slice(before).find((h) => h.source === attacker.uid)!;
    expect(hit.total).toBeCloseTo(645.2712 * 1.224 * (hit.crit ? 1.5 : 1) * DEF_ZONE * 1.0, 3);
    // Weakness Protection: no toughness damage while it lasts; the boss version only guards while summons are out.
    const guarded = setup('char.dan-heng', 'Wind');
    guarded.target.toughness = 20;
    guarded.b.applyStatus(guarded.target, guarded.target, 'test.protected', {});
    guarded.b.step();
    guarded.b.submit({ type: 'skill', actor: guarded.attacker.uid, target: guarded.target.uid });
    expect(guarded.target.toughness).toBe(20);
    expect(guarded.target.broken).toBe(false);
    const boss = setup('char.dan-heng', 'Wind');
    boss.target.toughness = 20;
    boss.b.applyStatus(boss.target, boss.target, 'enemy.weakness-protected', {});
    boss.b.step();
    boss.b.submit({ type: 'skill', actor: boss.attacker.uid, target: boss.target.uid });
    expect(boss.target.broken).toBe(true); // no summons are on the field in 5A, so the protection is idle
  });
});

describe('Weakness Break statuses (the element-specific effects)', () => {
  it('Burn: Fire DoT of 1 x level multiplier each turn for 2 turns', () => {
    const { b, target } = setup('char.himeko', 'Fire');
    b.step();
    b.submit({ type: 'basic', actor: 'ally-1', target: target.uid });
    expect(events(b, 'statusApplied').some((e) => e.statusId === 'break.burn')).toBe(true);
    const tick = untilTick(b, target, 'break.burn')!;
    expect(tick.amount).toBeCloseTo(LV80 * 1 * DEF_ZONE, 2);
    expect(target.statuses.find((s) => s.statusId === 'break.burn')!.turnsLeft).toBe(1);
  });

  it('Shock: Lightning DoT of 2 x level multiplier', () => {
    const { b, target, attacker } = setup('char.jing-yuan', 'Lightning');
    b.step();
    b.submit({ type: 'basic', actor: attacker.uid, target: target.uid });
    const tick = untilTick(b, target, 'break.shock')!;
    expect(tick.amount).toBeCloseTo(2 * LV80 * DEF_ZONE, 2);
  });

  it('Wind Shear: 1 stack on a normal enemy, 3 on an elite, each worth 1 x level multiplier', () => {
    const normal = setup('char.dan-heng', 'Wind');
    normal.b.step();
    normal.b.submit({ type: 'basic', actor: normal.attacker.uid, target: normal.target.uid });
    expect(normal.target.statuses.find((s) => s.statusId === 'break.wind-shear')!.stacks).toBe(1);
    const t1 = untilTick(normal.b, normal.target, 'break.wind-shear')!;
    expect(t1.amount).toBeCloseTo(LV80 * 1 * t1.stacks * DEF_ZONE, 2);

    const elite = setup('char.dan-heng', 'Wind', 'test.elite');
    elite.b.step();
    elite.b.submit({ type: 'basic', actor: elite.attacker.uid, target: elite.target.uid });
    expect(elite.target.statuses.find((s) => s.statusId === 'break.wind-shear')!.stacks).toBe(3);
    const t3 = untilTick(elite.b, elite.target, 'break.wind-shear')!;
    expect(t3.stacks).toBeGreaterThanOrEqual(3);
    expect(t3.amount).toBeCloseTo(LV80 * t3.stacks * DEF_ZONE, 2);
  });

  it('Bleed: min(16% Max HP, 2 x level multiplier x toughness multiplier); the HP branch applies to a small target', () => {
    const big = setup('char.clara', 'Physical');
    big.b.step();
    big.b.submit({ type: 'basic', actor: big.attacker.uid, target: big.target.uid });
    const capped = untilTick(big.b, big.target, 'break.bleed')!;
    expect(capped.amount).toBeCloseTo(2 * LV80 * 1 * DEF_ZONE, 2);

    const small = setup('char.clara', 'Physical');
    (small.target.baseStats as Record<string, number>).hp = 20000;
    small.target.hp = 20000;
    small.b.step();
    small.b.submit({ type: 'basic', actor: small.attacker.uid, target: small.target.uid });
    const hpBased = untilTick(small.b, small.target, 'break.bleed')!;
    expect(hpBased.amount).toBeCloseTo(0.16 * 20000 * DEF_ZONE, 2);
  });

  it('Entanglement: delays 25% + 20% x (1 + BE), each hit adds a stack, and it deals 0.6 x level x stacks as Additional DMG', () => {
    const { b, target, attacker } = setup('char.seele', 'Quantum');
    b.step();
    b.submit({ type: 'basic', actor: attacker.uid, target: target.uid });
    const status = target.statuses.find((s) => s.statusId === 'break.entanglement')!;
    expect(status.stacks).toBe(1);
    const tick = untilTick(b, target, 'break.entanglement')!;
    expect(tick.stacks).toBeGreaterThanOrEqual(1);
    expect(tick.amount).toBeCloseTo(0.6 * LV80 * 1 * tick.stacks * DEF_ZONE, 2);
  });

  it('Imprisonment: delays 25% + 30% x (1 + BE) and slows by 10% for a turn (no damage)', () => {
    const { b, target, attacker } = setup('char.welt', 'Imaginary');
    const spd = b.spd(target);
    b.step();
    b.submit({ type: 'basic', actor: attacker.uid, target: target.uid });
    expect(b.spd(target)).toBeCloseTo(spd * 0.9, 9);
    expect(events(b, 'weaknessBreak')[0]!.delay).toBeCloseTo(0.55, 9);
    for (let i = 0; i < 100 && target.statuses.some((s) => s.statusId === 'break.imprisonment'); i++) {
      const r = b.step();
      if (r.kind === 'awaiting') b.submit({ type: 'basic', actor: r.uid, target: target.uid });
    }
    expect(b.spd(target)).toBeCloseTo(spd, 9);
    expect(events(b, 'dot').some((d) => d.statusId === 'break.imprisonment')).toBe(false);
  });

  it('Freeze: the frozen turn is skipped, the thaw deals Ice Additional DMG and the next action is advanced 50%', () => {
    const { b, target, attacker } = setup('char.march-7th', 'Ice');
    b.step();
    b.submit({ type: 'basic', actor: attacker.uid, target: target.uid });
    expect(target.statuses.some((s) => s.statusId === 'break.freeze')).toBe(true);
    for (let i = 0; i < 100 && !events(b, 'turnSkipped').length; i++) {
      const r = b.step();
      if (r.kind === 'awaiting') b.submit({ type: 'basic', actor: r.uid, target: target.uid });
    }
    const skipped = events(b, 'turnSkipped')[0]!;
    expect(skipped).toMatchObject({ uid: target.uid, reason: 'freeze' });
    const thaw = events(b, 'dot').find((d) => d.statusId === 'break.freeze')!;
    expect(thaw.amount).toBeCloseTo(LV80 * 1 * DEF_ZONE, 2);
    expect(target.statuses.some((s) => s.statusId === 'break.freeze')).toBe(false);
    const shift = events(b, 'actionShift').find((e) => e.uid === target.uid && Math.abs(e.fraction - 0.5) < 1e-9)!;
    expect(shift).toBeDefined();
    // The advance is 50% of the base AV (10000 / 83 = 120.48) from a freshly reset AV: 60.24.
    expect(shift.av).toBeCloseTo(10000 / 83 - 0.5 * (10000 / 83), 6);
  });

  it('removes a DoT after its duration: Burn lasts exactly 2 of the target\'s turns', () => {
    const { b, target } = setup('char.himeko', 'Fire');
    b.step();
    b.submit({ type: 'basic', actor: 'ally-1', target: target.uid });
    for (let i = 0; i < 300 && events(b, 'dot').filter((d) => d.statusId === 'break.burn').length < 2; i++) {
      const r = b.step();
      if (r.kind === 'awaiting') b.submit({ type: 'basic', actor: r.uid, target: target.uid });
    }
    expect(events(b, 'dot').filter((d) => d.statusId === 'break.burn')).toHaveLength(2);
    expect(target.statuses.some((s) => s.statusId === 'break.burn')).toBe(false);
  });
});
