import { describe, expect, it } from 'vitest';
import harmonicThread from '@data/light-cones/harmonic-thread.json';
import emberOath from '@data/light-cones/ember-oath.json';
import lyra from '@data/characters/lyra.json';
import sets from '@data/relics/sets/sets.json';
import { LightConeSchema, validateLightCone } from '@models/lightcone';
import { CharacterSchema, validateCharacter } from '@models/character';
import { RelicSetSchema, validateRelicSet } from '@models/relic';
import { abilityTemplateSlots, fillTemplate, lightConeTemplateSlots, passiveTemplateSlots, templateProblems } from '@models/templates';

const clone = <T>(v: T): T => structuredClone(v);
const s1 = (v: Parameters<Parameters<typeof fillTemplate>[2]>[0], pct: boolean): string => {
  const n = v.kind === 'superimposed' ? v.value[0] : typeof v.value === 'number' ? v.value : NaN;
  return pct ? `${Math.round(n * 1000) / 10}%` : String(n);
};

describe('description templates', () => {
  it('Light Cones index modifiers then params, and accept named params', () => {
    const lc = LightConeSchema.parse(harmonicThread);
    const text = fillTemplate(lc.passive.description, lightConeTemplateSlots(lc), s1);
    expect(text).toContain('Energy Regeneration Rate by 8%');
    expect(text).toContain("target's DMG increases by 12%");
    expect(text).not.toMatch(/[{}?]/);
    // Indexed form: {1} is the first param after the single modifier.
    expect(fillTemplate('{0}% / {1}%', lightConeTemplateSlots(lc), s1)).toBe('8% / 12%');
    expect(validateLightCone(lc)).toEqual([]);
  });

  it('fails validation when a placeholder does not resolve', () => {
    const lc = LightConeSchema.parse({ ...clone(emberOath), passive: { ...clone(emberOath.passive), description: 'CRIT DMG +{0}%, then {7}% and {nope}%.' } });
    expect(validateLightCone(lc)).toEqual(['passive: description placeholder {7} does not resolve', 'passive: description placeholder {nope} does not resolve']);

    const c = clone(lyra);
    c.abilities.basic.description = 'Deals {0}% and {1}%.';
    c.eidolons[1]!.description = 'SPD +{0}% and {1}%.';
    const problems = validateCharacter(CharacterSchema.parse(c));
    expect(problems).toContain('lyra.basic: description placeholder {1} does not resolve');
    expect(problems).toContain('E2: description placeholder {1} does not resolve');

    const set = clone(sets[0]!) as (typeof sets)[number];
    set.bonuses[0]!.description = 'Fire DMG +{3}%';
    expect(validateRelicSet(RelicSetSchema.parse(set))).toEqual(['2-piece bonus: description placeholder {3} does not resolve']);
  });

  it('Light Cone params must be used by a trigger, and trigger refs must exist', () => {
    const unused = clone(harmonicThread);
    unused.passive.triggers = [];
    expect(validateLightCone(LightConeSchema.parse(unused))).toContain('passive param "skillTargetDmg" is not used by any trigger');
    const dangling = clone(harmonicThread);
    dangling.passive.triggers[0]!.effects[0]!.params = { allDmg: { param: 'typo' } };
    expect(validateLightCone(LightConeSchema.parse(dangling))).toContain('trigger references unknown passive param "typo"');
  });

  it('abilities expose effect values in order, plus named status params', () => {
    const c = CharacterSchema.parse(lyra);
    const ult = abilityTemplateSlots(c.abilities.ultimate);
    expect(ult.indexed).toHaveLength(2);
    expect(Object.keys(ult.named)).toEqual(['critDmg']);
    expect(templateProblems('{0}% {1}% {critDmg}%', ult)).toEqual([]);
    const talent = c.memosprite!.abilities.find((a) => a.kind === 'memospriteTalent')!;
    expect(templateProblems(talent.description, abilityTemplateSlots(talent))).toEqual([]);
    const courier = RelicSetSchema.parse(sets.find((s) => s.id === 'relic.gale-courier'));
    const four = courier.bonuses.find((b) => b.pieces === 4)!;
    expect(fillTemplate(four.description, passiveTemplateSlots(four), s1)).toContain("all allies' SPD increases by 12%");
  });
});
