import { describe, expect, it } from 'vitest';
import ignatius from '@data/characters/ignatius.json';
import sovereign from '@data/enemies/ash-sovereign.json';
import sets from '@data/relics/sets/sets.json';
import emberOath from '@data/light-cones/ember-oath.json';
import { CharacterSchema, validateCharacter } from '@models/character';
import { EnemySchema, validateEnemy } from '@models/enemy';
import { RelicSetSchema } from '@models/relic';
import { LightConeSchema } from '@models/lightcone';
import { AbilitySchema, EffectSchema } from '@models/ability';
import { StatusEffectSchema } from '@models/status';
import { ScalingCurvesSchema } from '@models/scaling';
import { BannerSchema } from '@models/gacha';
import { DialogueSchema } from '@models/quest';
import { ELEMENTS, PATHS } from '@models/common';

const clone = <T>(v: T): T => structuredClone(v);

describe('schema validation of sample data', () => {
  it('accepts the sample character and fills defaults', () => {
    const c = CharacterSchema.parse(ignatius);
    expect(c.baseStats.critRate).toBe(0.05);
    expect(c.baseStats.critDmg).toBe(0.5);
    expect(validateCharacter(c)).toEqual([]);
  });

  it('rejects unknown elements, paths and rarities', () => {
    expect(CharacterSchema.safeParse({ ...clone(ignatius), element: 'Water' }).success).toBe(false);
    expect(CharacterSchema.safeParse({ ...clone(ignatius), path: 'Gluttony' }).success).toBe(false);
    expect(CharacterSchema.safeParse({ ...clone(ignatius), rarity: 3 }).success).toBe(false);
    expect(ELEMENTS).toHaveLength(7);
    expect(PATHS).toEqual(['Destruction', 'Hunt', 'Erudition', 'Harmony', 'Nihility', 'Preservation', 'Abundance', 'Remembrance']);
  });

  it('requires exactly six eidolons in order', () => {
    const bad = clone(ignatius);
    bad.eidolons = bad.eidolons.slice(0, 5);
    expect(CharacterSchema.safeParse(bad).success).toBe(false);
    const swapped = clone(ignatius);
    [swapped.eidolons[0], swapped.eidolons[1]] = [swapped.eidolons[1]!, swapped.eidolons[0]!];
    expect(validateCharacter(CharacterSchema.parse(swapped))).toContain('eidolons must be ranks 1..6 in order (got 2,1,3,4,5,6)');
  });

  it('rejects unknown properties (typos) thanks to strict objects', () => {
    const typo = clone(ignatius) as Record<string, unknown>;
    typo.maxEnergyy = 120;
    expect(CharacterSchema.safeParse(typo).success).toBe(false);
  });

  it('enforces Remembrance characters to have memosprites', () => {
    const c = CharacterSchema.parse({ ...clone(ignatius), path: 'Remembrance' });
    expect(validateCharacter(c)).toContain('Remembrance characters must define a memosprite');
  });

  it('validates the effect union by kind', () => {
    expect(EffectSchema.safeParse({ kind: 'damage', target: 'primary', stat: 'atk', multiplier: { curve: 'standard', ref: 2 } }).success).toBe(true);
    expect(EffectSchema.safeParse({ kind: 'damage', target: 'primary', stat: 'spd', multiplier: 1 }).success).toBe(false);
    expect(EffectSchema.safeParse({ kind: 'actionAdvance', target: 'self', fraction: 1.5 }).success).toBe(false);
    expect(EffectSchema.safeParse({ kind: 'teleport' }).success).toBe(false);
    expect(AbilitySchema.safeParse({ ...clone(ignatius.abilities.basic), spCost: -1 }).success).toBe(false);
  });

  it('enemy rules: bosses need phases, weaknesses cannot have positive RES', () => {
    const boss = EnemySchema.parse(sovereign);
    expect(validateEnemy(boss)).toEqual([]);
    expect(validateEnemy({ ...boss, phases: [] })).toContain('bosses must define at least one phase');
    expect(validateEnemy({ ...boss, resistances: { Ice: 0.2 } })).toContain('enemy is weak to Ice but has positive Ice RES');
    expect(validateEnemy({ ...boss, ai: { pattern: 'sequence', sequence: ['missing'] } })).toContain('ai.sequence references unknown ability "missing"');
  });

  it('relic sets: cavern = 4 slots with 2/4-piece bonuses, planar = 2 slots with a 2-piece bonus', () => {
    for (const s of sets) expect(RelicSetSchema.safeParse(s).success).toBe(true);
    const cavern = clone(sets[0]!) as unknown as { pieces: Record<string, string>; bonuses: unknown[] };
    delete cavern.pieces.feet;
    expect(RelicSetSchema.safeParse(cavern).success).toBe(false);
    const planar = clone(sets.find((s) => s.kind === 'planar')!) as unknown as { bonuses: Array<{ pieces: number; description: string }> };
    planar.bonuses.push({ pieces: 4, description: 'not allowed' });
    expect(RelicSetSchema.safeParse(planar).success).toBe(false);
  });

  it('light cones need 5 superimposition values per passive modifier', () => {
    expect(LightConeSchema.safeParse(emberOath).success).toBe(true);
    const bad = clone(emberOath);
    bad.passive.modifiers[0]!.value = [0.2, 0.25, 0.3, 0.35];
    expect(LightConeSchema.safeParse(bad).success).toBe(false);
  });

  it('status effects require the block matching their category', () => {
    expect(StatusEffectSchema.safeParse({ id: 'x', name: 'X', description: 'x', kind: 'debuff', category: 'dot', dispellable: true, duration: { turns: 2, tickOn: 'ownerTurnStart' } }).success).toBe(false);
    expect(
      StatusEffectSchema.safeParse({
        id: 'x',
        name: 'X',
        description: 'x',
        kind: 'debuff',
        category: 'dot',
        dispellable: true,
        duration: { turns: 2, tickOn: 'ownerTurnStart' },
        dot: { element: 'Fire', formula: 'breakDot' },
      }).success,
    ).toBe(false);
  });

  it('scaling curves must equal 1.0 at their reference level', () => {
    expect(ScalingCurvesSchema.safeParse({ id: 'c', curves: { bad: { refLevel: 2, ratios: [0.5, 0.9] } } }).success).toBe(false);
  });

  it('banners: soft pity must start before hard pity', () => {
    const banner = {
      id: 'b',
      name: 'B',
      type: 'character',
      cost: { item: 'pass', count: 1 },
      pityGroup: 'g',
      rates: { fiveStar: 0.006, fourStar: 0.051 },
      pity: { fiveStarHard: 90, fiveStarSoftStart: 95, fiveStarSoftIncrement: 0.06, fourStarHard: 10 },
      featured: { fiveStar: ['a'], fourStar: [], fiveStarChance: 0.5, fourStarChance: 0.5, guaranteeAfterLoss: true },
      pools: { fiveStar: ['a'], fourStar: ['b'], threeStar: ['c'] },
    };
    expect(BannerSchema.safeParse(banner).success).toBe(false);
    expect(BannerSchema.safeParse({ ...banner, pity: { ...banner.pity, fiveStarSoftStart: 74 } }).success).toBe(true);
  });

  it('dialogues must not point to missing lines', () => {
    expect(DialogueSchema.safeParse({ id: 'd', start: 'a', lines: [{ id: 'a', speaker: 's', text: 't', next: 'zz' }] }).success).toBe(false);
  });
});
