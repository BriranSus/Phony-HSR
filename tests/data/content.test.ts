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
    expect(report.files).toBeGreaterThan(50);
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
    expect(rules.weaknessBreak.elements.Wind.breakDmgMultiplier).toBe(1.5);
    expect(rules.weaknessBreak.elements.Quantum.breakDmgMultiplier).toBe(0.5);
  });

  it('uses the reference Skill Point and energy rules', async () => {
    const rules = (await loadAll()).get(Collections.combatRules, 'default');
    expect(rules.skillPoints).toEqual({ max: 5, start: 3, basicGain: 1, skillCost: 1 });
    expect(rules.actionValue.numerator).toBe(10000);
    expect(rules.energy).toMatchObject({ basic: 20, skill: 30, ultimate: 5 });
  });

  it('covers all 7 elements and all 8 Paths with the shipped roster', async () => {
    const chars = (await loadAll()).all(Collections.characters);
    expect(chars.length).toBeGreaterThanOrEqual(16);
    expect(new Set(chars.map((c) => c.element)).size).toBe(7);
    expect(new Set(chars.map((c) => c.path)).size).toBe(8);
    expect(chars.some((c) => c.memosprite)).toBe(true);
    expect(chars.some((c) => c.summons.length > 0)).toBe(true);
  });

  it('gives every character a full kit with standard Basic ATK / Ultimate economy and valid levels', async () => {
    const r = await loadAll();
    const prog = r.get(Collections.progressionRules, 'default');
    for (const c of r.all(Collections.characters)) {
      expect(c.eidolons.map((e) => e.rank), c.id).toEqual([1, 2, 3, 4, 5, 6]);
      expect(c.abilities.basic.spGain, c.id).toBe(1);
      expect(c.abilities.basic.energyGain, c.id).toBe(20);
      expect(c.abilities.ultimate.energyGain, c.id).toBe(5);
      expect(c.abilities.skill.spCost, c.id).toBe(1);
      expect(c.abilities.basic.maxLevel, c.id).toBe(prog.abilityMaxLevel.basic);
      expect(c.abilities.skill.maxLevel, c.id).toBe(prog.abilityMaxLevel.skill);
      expect(c.traces.filter((t) => t.kind === 'major').length, c.id).toBeGreaterThanOrEqual(3);
      expect(c.traces.filter((t) => t.kind === 'stat').length, c.id).toBeGreaterThanOrEqual(10);
      expect(c.sources.length, c.id).toBeGreaterThan(0);
    }
  });

  it('standard curves reproduce the reference scaling (100% at Lv1 -> 200% at Lv10 -> 250% at Lv15)', async () => {
    const curves = (await loadAll()).get(Collections.scalingCurves, 'default');
    expect(resolveLevelScaled({ curve: 'standard', ref: 2 }, 1, curves)).toBeCloseTo(1);
    expect(resolveLevelScaled({ curve: 'standard', ref: 2 }, 10, curves)).toBeCloseTo(2);
    expect(resolveLevelScaled({ curve: 'standard', ref: 2 }, 15, curves)).toBeCloseTo(2.5);
  });

  it('has relic slots split 4 cavern + 2 planar with correct 5-star max main stats', async () => {
    const r = await loadAll();
    const t = r.get(Collections.relicStatTables, 'default');
    expect([...CAVERN_SLOTS, ...PLANAR_SLOTS]).toHaveLength(6);
    const five = t.rarities['5']!;
    const at15 = (stat: keyof typeof five.mainStats): number => five.mainStats[stat]!.base + five.mainStats[stat]!.step * 15;
    expect(at15('hp')).toBeCloseTo(705.6, 1);
    expect(at15('atk')).toBeCloseTo(352.8, 1);
    expect(Object.keys(t.mainStatPools.feet)).toContain('spd');
    for (const s of r.all(Collections.relicSets)) expect(s.bonuses.map((b) => b.pieces)).toEqual(s.kind === 'cavern' ? [2, 4] : [2]);
  });

  it('encodes every set and Light Cone bonus as data (no description-only mechanics)', async () => {
    const r = await loadAll();
    for (const s of r.all(Collections.relicSets)) {
      for (const b of s.bonuses) expect(b.modifiers.length + b.triggers.length, `${s.id} ${b.pieces}pc`).toBeGreaterThan(0);
    }
    for (const lc of r.all(Collections.lightCones)) {
      expect(lc.passive.modifiers.length + lc.passive.triggers.length, lc.id).toBeGreaterThan(0);
      for (const v of Object.values(lc.passive.params)) expect(v).toHaveLength(5);
    }
  });

  it('documents every script handler that data references', async () => {
    const r = await loadAll();
    const handlers = r.all(Collections.scriptHandlers);
    expect(handlers.length).toBeGreaterThan(0);
    for (const h of handlers) expect(h.description.length, h.id).toBeGreaterThan(20);
  });

  it('ships character and Light Cone banners with the reference rates and separate pity groups', async () => {
    const r = await loadAll();
    const ch = r.get(Collections.banners, 'banner.butterfly-on-swordtip');
    const lc = r.get(Collections.banners, 'banner.brilliant-fixation-in-the-night');
    expect(ch.featured.fiveStar).toEqual(['char.seele']);
    expect(ch.rates.fiveStar).toBe(0.006);
    expect(ch.pity).toMatchObject({ fiveStarHard: 90, fourStarHard: 10 });
    expect(lc.featured.fiveStar).toEqual(['lc.in-the-night']);
    expect(lc.rates.fiveStar).toBe(0.008);
    expect(lc.pity).toMatchObject({ fiveStarHard: 80, fiveStarSoftStart: 66 });
    expect(lc.featured.fiveStarChance).toBe(0.75);
    expect(lc.pityGroup).not.toBe(ch.pityGroup);
  });
});
