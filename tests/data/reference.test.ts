import { beforeAll, describe, expect, it } from 'vitest';
import { DataRegistry } from '@core/data/DataRegistry';
import { ALL_COLLECTIONS, Collections } from '@models/collections';
import { createBundledDataSource } from '@app/dataSource';
import { enemyStatAtLevel, grownStat, maxToughnessMultiplier, resolveValue } from '@models/formulas';
import type { Ability } from '@models/ability';

/**
 * Pins shipped data to known reference-game values (Lv.80 panel stats as shown in game, Light Cone
 * Lv.80 stats, enemy toughness/weaknesses and ability multipliers). See docs/DATA_SOURCES.md.
 */
let r: DataRegistry;
beforeAll(async () => {
  r = new DataRegistry().registerAll(ALL_COLLECTIONS);
  await r.load(createBundledDataSource(), { strict: true });
});

const char = (id: string) => r.get(Collections.characters, `char.${id}`);
const lc = (id: string) => r.get(Collections.lightCones, `lc.${id}`);
const enemy = (id: string) => r.get(Collections.enemies, `enemy.${id}`);
const prog = () => r.get(Collections.progressionRules, 'default');
const at80 = (base: number, curve: 'character' | 'lightCone') => Math.floor(grownStat(base, 80, 6, prog()[curve]));
const value = (a: Ability, param: string, level: number) => resolveValue({ param }, level, a.params, r.get(Collections.scalingCurves, 'default'));

describe('characters: Lv.80 stats (in-game values, rounded down)', () => {
  const cases: Array<[string, number, number, number, number]> = [
    ['seele', 931, 640, 363, 115],
    ['clara', 1241, 737, 485, 90],
    ['blade', 1358, 543, 485, 97],
    ['bronya', 1241, 582, 533, 99],
    ['kafka', 1086, 679, 485, 100],
    ['jing-yuan', 1164, 698, 485, 99],
    ['march-7th', 1058, 511, 573, 101],
    ['natasha', 1164, 476, 507, 98],
  ];
  it.each(cases)('%s: HP %i / ATK %i / DEF %i / SPD %i', (id, hp, atk, def, spd) => {
    const c = char(id);
    expect(at80(c.baseStats.hp, 'character')).toBe(hp);
    expect(at80(c.baseStats.atk, 'character')).toBe(atk);
    expect(at80(c.baseStats.def, 'character')).toBe(def);
    expect(c.baseStats.spd).toBe(spd);
  });

  it('rarity, Path, Type and max Energy', () => {
    expect(char('seele')).toMatchObject({ rarity: 5, path: 'Hunt', element: 'Quantum', ultimateResource: { kind: 'energy', max: 120 } });
    expect(char('clara')).toMatchObject({ rarity: 5, path: 'Destruction', element: 'Physical', ultimateResource: { max: 110 } });
    expect(char('blade')).toMatchObject({ path: 'Destruction', element: 'Wind', ultimateResource: { max: 130 } });
    expect(char('dan-heng')).toMatchObject({ rarity: 4, path: 'Hunt', element: 'Wind', ultimateResource: { max: 100 } });
    expect(char('natasha')).toMatchObject({ rarity: 4, path: 'Abundance', element: 'Physical', ultimateResource: { max: 90 } });
    expect(char('trailblazer-remembrance')).toMatchObject({ path: 'Remembrance', element: 'Ice', ultimateResource: { max: 160 } });
    expect(char('gepard').baseStats.aggro).toBe(150);
    expect(char('seele').baseStats.aggro).toBe(75);
  });
});

describe('characters: ability values', () => {
  it('Seele: Skill 110% -> 220% (Lv.10), Ultimate 425% (Lv.10), Talent +80% DMG (Lv.10)', () => {
    const s = char('seele');
    expect(value(s.abilities.skill, 'p1', 1)).toBe(1.1);
    expect(value(s.abilities.skill, 'p1', 10)).toBe(2.2);
    expect(value(s.abilities.ultimate, 'p1', 10)).toBe(4.25);
    expect(value(s.abilities.talent, 'p1', 10)).toBe(0.8);
    expect(s.abilities.skill.effects.find((e) => e.kind === 'damage')).toMatchObject({ toughness: 20 });
    expect(s.abilities.ultimate.effects.find((e) => e.kind === 'damage')).toMatchObject({ toughness: 30 });
  });

  it('Kafka: Ultimate Shock DoT 290% ATK at Lv.10; follow-up after an ally Basic ATK', () => {
    const k = char('kafka');
    expect(value(k.abilities.ultimate, 'p4', 10)).toBe(2.9);
    expect(k.abilities.talent.triggers[0]).toMatchObject({ on: 'afterAllyAttack', limitPerTurn: 1 });
    expect(k.abilities.skill.effects.some((e) => e.kind === 'detonateDot')).toBe(true);
  });

  it("Jing Yuan: Lightning-Lord SPD 60, 3 base hits (max 10), 66% ATK per hit at Lv.10", () => {
    const jy = char('jing-yuan');
    const ll = jy.summons[0]!;
    expect(ll.spd).toEqual({ fixed: 60 });
    expect(ll.resources[0]).toMatchObject({ initial: 3, max: 10, resetAfterAction: 3 });
    expect(value(ll.abilities[0]!, 'p2', 10)).toBe(0.66);
  });

  it('Blade: Skill costs 1 SP, no Energy, does not end the turn; Charge follow-up at 5 stacks', () => {
    const b = char('blade');
    expect(b.abilities.skill).toMatchObject({ spCost: 1, energyGain: 0, keepsTurn: true });
    expect(b.resources[0]).toMatchObject({ max: 5, onFull: { action: 'followUp', ability: 'blade.shuhus-gift' } });
  });

  it('Silver Wolf implants a party Type Weakness; Bronya advances an ally by 100%', () => {
    expect(char('silver-wolf').abilities.skill.effects[0]).toMatchObject({ kind: 'implantWeakness', element: 'randomPartyElement' });
    expect(char('bronya').abilities.skill.effects).toContainEqual({ kind: 'actionAdvance', target: 'selectedAlly', fraction: 1 });
  });

  it("Clara counters when hit; Mem's HP comes from the Trailblazer's Talent (50% Max HP + 400 at Lv.1)", () => {
    expect(char('clara').abilities.talent.triggers[0]?.effects.find((e) => e.kind === 'insertAction')).toMatchObject({ action: 'counter', ability: 'clara.svarogs-counter', target: 'attacker' });
    const mem = char('trailblazer-remembrance').memosprite!;
    expect(mem.spd).toEqual({ fixed: 130 });
    expect(mem.hpFromOwner.ratio).toMatchObject({ table: expect.arrayContaining([0.5]) });
  });

  it('E3/E5 ability level bonuses follow the reference ranks', () => {
    expect(char('seele').eidolons[2]!.abilityLevelBonus).toEqual({ skill: 2, talent: 2 });
    expect(char('seele').eidolons[4]!.abilityLevelBonus).toEqual({ ultimate: 2, basic: 1 });
  });
});

describe('Light Cones: Lv.80 stats', () => {
  const cases: Array<[string, number, number, number]> = [
    ['in-the-night', 1058, 582, 463],
    ['something-irreplaceable', 1164, 582, 396],
    ['night-on-the-milky-way', 1164, 582, 396],
    ['moment-of-victory', 1058, 476, 595],
    ['memories-of-the-past', 952, 423, 396],
    ['arrows', 846, 317, 264],
  ];
  it.each(cases)('%s: HP %i / ATK %i / DEF %i', (id, hp, atk, def) => {
    const l = lc(id);
    expect(at80(l.baseStats.hp, 'lightCone')).toBe(hp);
    expect(at80(l.baseStats.atk, 'lightCone')).toBe(atk);
    expect(at80(l.baseStats.def, 'lightCone')).toBe(def);
  });

  it('In the Night: S1 CRIT Rate 18%, S5 30%; Hunt Path', () => {
    const l = lc('in-the-night');
    expect(l.path).toBe('Hunt');
    expect(l.passive.params.p1).toEqual([0.18, 0.21, 0.24, 0.27, 0.3]);
  });
});

describe('enemies', () => {
  it('weaknesses, toughness and RES', () => {
    expect(enemy('voidranger-reaver')).toMatchObject({ weaknesses: ['Physical', 'Lightning'], toughness: 20, rank: 'normal' });
    expect(enemy('voidranger-reaver').baseStats).toMatchObject({ hp: 139.5, spd: 100 });
    expect(enemy('automaton-grizzly')).toMatchObject({ weaknesses: ['Fire', 'Ice', 'Lightning'], toughness: 140, rank: 'elite' });
    expect(enemy('voidranger-trampler')).toMatchObject({ toughness: 100, rank: 'elite' });
    expect(enemy('frostspawn')).toMatchObject({ weaknesses: ['Fire', 'Wind'], toughness: 10, debuffRes: { freeze: 1 } });
    expect(enemy('frostspawn').resistances.Ice).toBe(0.4);
  });

  it('Cocolia: Fire/Lightning/Quantum weak, 180 -> 160 toughness, two phases, summons the Lances', () => {
    const c = enemy('cocolia-mother-of-deception');
    expect(c.weaknesses).toEqual(['Fire', 'Lightning', 'Quantum']);
    expect(c.toughness).toBe(180);
    expect(c.phases.map((p) => p.toughness ?? c.toughness)).toEqual([180, 160]);
    expect(c.resistances).toMatchObject({ Ice: 0.6, Physical: 0.4, Wind: 0.4, Imaginary: 0.2 });
    expect(c.debuffRes).toMatchObject({ freeze: 1, imprisonment: 1 });
    expect(c.abilities.find((a) => a.name === 'Soulrend Coldstream')?.effects[0]).toMatchObject({ multiplier: 6.5, element: 'Ice' });
    expect(maxToughnessMultiplier(c.toughness, r.get(Collections.combatRules, 'default'))).toBe(5);
  });

  it('level curve: Lv.1 HP x0.8, Lv.80 HP x148.01102 and SPD x1.2 (HardLevelGroup 1)', () => {
    const p = prog();
    expect(enemyStatAtLevel(139.5, 'hp', 1, p)).toBeCloseTo(111.6, 6);
    expect(enemyStatAtLevel(139.5, 'hp', 80, p)).toBeCloseTo(139.5 * 148.01102, 6);
    expect(enemyStatAtLevel(100, 'spd', 80, p)).toBeCloseTo(120, 6);
    expect(p.enemy.levels['80']!.def * 210).toBeCloseTo(1000, 3);
  });
});
