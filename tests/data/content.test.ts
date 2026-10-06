import { describe, expect, it } from 'vitest';
import { DataRegistry } from '@core/data/DataRegistry';
import { ALL_COLLECTIONS, Collections } from '@models/collections';
import { createBundledDataSource } from '@app/dataSource';
import { ELEMENTS, PATHS } from '@models/common';
import { CAVERN_SLOTS, PLANAR_SLOTS } from '@models/relic';
import { resolveLevelScaled } from '@models/formulas';

async function loadAll(): Promise<DataRegistry> {
  const registry = new DataRegistry().registerAll(ALL_COLLECTIONS);
  await registry.load(createBundledDataSource(), { strict: true });
  return registry;
}

describe('bundled game content', () => {
  it('loads every JSON file without schema, reference or semantic issues', async () => {
    const registry = new DataRegistry().registerAll(ALL_COLLECTIONS);
    const report = await registry.load(createBundledDataSource(), { strict: false });
    expect(report.issues).toEqual([]);
    expect(report.files).toBeGreaterThan(20);
  });

  it('defines every element and path exactly once', async () => {
    const r = await loadAll();
    expect(r.all(Collections.elements).map((e) => e.element).sort()).toEqual([...ELEMENTS].sort());
    expect(r.all(Collections.paths).map((p) => p.path).sort()).toEqual([...PATHS].sort());
  });

  it('maps every element to a weakness-break status that exists', async () => {
    const r = await loadAll();
    const rules = r.get(Collections.combatRules, 'default');
    for (const el of ELEMENTS) {
      const status = r.get(Collections.statusEffects, rules.weaknessBreak.elements[el].status);
      expect(status.kind).toBe('debuff');
    }
    expect(rules.weaknessBreak.elements.Physical.breakDmgMultiplier).toBe(2);
    expect(rules.weaknessBreak.elements.Fire.breakDmgMultiplier).toBe(2);
    expect(rules.weaknessBreak.elements.Wind.breakDmgMultiplier).toBe(1.5);
    expect(rules.weaknessBreak.elements.Ice.breakDmgMultiplier).toBe(1);
    expect(rules.weaknessBreak.elements.Lightning.breakDmgMultiplier).toBe(1);
    expect(rules.weaknessBreak.elements.Quantum.breakDmgMultiplier).toBe(0.5);
    expect(rules.weaknessBreak.elements.Imaginary.breakDmgMultiplier).toBe(0.5);
  });

  it('uses the reference Skill Point and energy rules', async () => {
    const rules = (await loadAll()).get(Collections.combatRules, 'default');
    expect(rules.skillPoints).toEqual({ max: 5, start: 3, basicGain: 1, skillCost: 1 });
    expect(rules.actionValue.numerator).toBe(10000);
    expect(rules.energy.basic).toBe(20);
    expect(rules.energy.skill).toBe(30);
    expect(rules.energy.ultimate).toBe(5);
  });

  it('gives every character a full kit, 6 eidolons and valid ability levels', async () => {
    const r = await loadAll();
    const curves = r.get(Collections.scalingCurves, 'default');
    const chars = r.all(Collections.characters);
    expect(chars.length).toBeGreaterThanOrEqual(4);
    for (const c of chars) {
      expect(c.eidolons.map((e) => e.rank)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(c.abilities.basic.spGain).toBe(1);
      expect(c.abilities.skill.spCost).toBe(1);
      expect(c.abilities.basic.energyGain).toBe(20);
      expect(c.abilities.skill.energyGain).toBe(30);
      expect(c.abilities.ultimate.energyGain).toBe(5);
      expect(c.traces.filter((t) => t.kind === 'major')).toHaveLength(3);
      // Every level-scaled value resolves at max level including eidolon bonuses.
      for (const e of c.abilities.skill.effects) {
        if (e.kind === 'damage') expect(resolveLevelScaled(e.multiplier, 12, curves)).toBeGreaterThan(0);
      }
    }
  });

  it('standard curves reproduce the reference scaling (100% at Lv1 -> 200% at Lv10 -> 250% at Lv15)', async () => {
    const curves = (await loadAll()).get(Collections.scalingCurves, 'default');
    expect(resolveLevelScaled({ curve: 'standard', ref: 2 }, 1, curves)).toBeCloseTo(1);
    expect(resolveLevelScaled({ curve: 'standard', ref: 2 }, 10, curves)).toBeCloseTo(2);
    expect(resolveLevelScaled({ curve: 'standard', ref: 2 }, 15, curves)).toBeCloseTo(2.5);
    expect(resolveLevelScaled({ curve: 'basic', ref: 1 }, 6, curves)).toBeCloseTo(1);
    expect(resolveLevelScaled({ curve: 'basic', ref: 1 }, 1, curves)).toBeCloseTo(0.5);
  });

  it('has relic slots split 4 cavern + 2 planar with correct 5-star max main stats', async () => {
    const r = await loadAll();
    expect(CAVERN_SLOTS).toHaveLength(4);
    expect(PLANAR_SLOTS).toHaveLength(2);
    const t = r.get(Collections.relicStatTables, 'default');
    const five = t.rarities['5'];
    expect(five).toBeDefined();
    const at15 = (s: keyof NonNullable<typeof five>['mainStats']) => {
      const g = five?.mainStats[s];
      return g ? g.base + g.step * 15 : NaN;
    };
    expect(at15('hp')).toBeCloseTo(705.6, 1);
    expect(at15('atk')).toBeCloseTo(352.8, 1);
    expect(at15('critRate')).toBeCloseTo(0.324, 3);
    expect(at15('critDmg')).toBeCloseTo(0.648, 3);
    expect(at15('spd')).toBeCloseTo(25.032, 2);
    expect(Object.keys(t.mainStatPools.head)).toEqual(['hp']);
    expect(Object.keys(t.mainStatPools.hands)).toEqual(['atk']);
    expect(Object.keys(t.mainStatPools.feet)).toContain('spd');
    expect(Object.keys(t.mainStatPools.linkRope)).toContain('energyRegen');
    for (const s of r.all(Collections.relicSets)) {
      expect(s.bonuses.map((b) => b.pieces)).toEqual(s.kind === 'cavern' ? [2, 4] : [2]);
    }
  });

  it('gives every light cone 5 superimposition values per modifier', async () => {
    for (const lc of (await loadAll()).all(Collections.lightCones)) {
      for (const m of lc.passive.modifiers) expect(m.value).toHaveLength(5);
    }
  });

  it('encodes every set / Light Cone bonus as data (no description-only mechanics)', async () => {
    const r = await loadAll();
    for (const s of r.all(Collections.relicSets)) {
      for (const b of s.bonuses) expect(b.modifiers.length + b.triggers.length, `${s.id} ${b.pieces}pc`).toBeGreaterThan(0);
    }
    const pilgrim = r.get(Collections.relicSets, 'relic.ember-pilgrim').bonuses[1]!;
    expect(pilgrim.triggers[0]!.on).toBe('afterUseUltimate');
    expect(pilgrim.triggers[0]!.effects[0]).toMatchObject({ kind: 'applyStatus', status: 'buff.ember-pilgrim', params: { fireDmg: 0.12 } });
    expect(r.get(Collections.statusEffects, 'buff.ember-pilgrim').modifiers[0]!.stat).toBe('fireDmg');
    const courier = r.get(Collections.relicSets, 'relic.gale-courier').bonuses[1]!;
    expect(courier.triggers[0]).toMatchObject({ on: 'afterUseUltimate', conditions: [{ type: 'abilityTargetsAlly' }] });
    for (const lc of r.all(Collections.lightCones)) {
      expect(lc.passive.modifiers.length + lc.passive.triggers.length, lc.id).toBeGreaterThan(0);
    }
    const thread = r.get(Collections.lightCones, 'lc.harmonic-thread');
    expect(thread.passive.triggers[0]).toMatchObject({ on: 'afterUseSkill', effects: [{ params: { allDmg: { param: 'skillTargetDmg' } } }] });
  });

  it('ships Light Cones on the reference Lv.1 stat tiers', async () => {
    const r = await loadAll();
    expect(r.get(Collections.lightCones, 'lc.ember-oath').baseStats).toEqual({ hp: 48, atk: 26.4, def: 21 });
    expect(r.get(Collections.lightCones, 'lc.harmonic-thread').baseStats).toEqual({ hp: 43.2, atk: 19.2, def: 18 });
    expect(r.get(Collections.lightCones, 'lc.bulwark-memory').baseStats).toEqual({ hp: 38.4, atk: 14.4, def: 12 });
  });

  it('gives the Remembrance sample a Memosprite Skill and Talent with Eidolon bonuses', async () => {
    const r = await loadAll();
    const lyra = r.get(Collections.characters, 'char.lyra');
    expect(lyra.memosprite?.abilities.map((a) => a.kind).sort()).toEqual(['memospriteSkill', 'memospriteTalent']);
    const prog = r.get(Collections.progressionRules, 'default');
    for (const a of lyra.memosprite!.abilities) expect(a.maxLevel).toBe(prog.abilityMaxLevel[a.kind as 'memospriteSkill' | 'memospriteTalent']);
    expect(lyra.traces.filter((t) => t.ability === 'memospriteSkill' || t.ability === 'memospriteTalent')).toHaveLength(2);
  });

  it('ships a Light Cone banner with the reference rates and its own pity group', async () => {
    const r = await loadAll();
    const lc = r.get(Collections.banners, 'banner.oath-of-embers-cone');
    const ch = r.get(Collections.banners, 'banner.ember-ascendant');
    expect(lc.type).toBe('lightCone');
    expect(lc.rates.fiveStar).toBe(0.008);
    expect(lc.pity).toMatchObject({ fiveStarHard: 80, fiveStarSoftStart: 66, fourStarHard: 10 });
    expect(lc.featured.fiveStarChance).toBe(0.75);
    expect(lc.pityGroup).not.toBe(ch.pityGroup);
  });
});
