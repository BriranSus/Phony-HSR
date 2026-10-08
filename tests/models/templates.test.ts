import { describe, expect, it } from 'vitest';
import inTheNight from '@data/light-cones/in-the-night.json';
import seele from '@data/characters/seele.json';
import sets from '@data/relics/sets/sets.json';
import { LightConeSchema, validateLightCone } from '@models/lightcone';
import { CharacterSchema, validateCharacter } from '@models/character';
import { RelicSetSchema, validateRelicSet } from '@models/relic';
import { abilityTemplateSlots, fillTemplate, lightConeTemplateSlots, passiveTemplateSlots, templateProblems, type TemplateValue } from '@models/templates';

const clone = <T>(v: T): T => structuredClone(v);
/** Formats S1 (Light Cones) or Lv.1 (abilities) values. */
const lv1 = (v: TemplateValue, pct: boolean): string => {
  const n = v.kind === 'superimposed' ? v.value[0] : typeof v.value === 'number' ? v.value : 'table' in v.value ? (v.value.table[0] ?? NaN) : NaN;
  return pct ? `${Math.round(n * 1000) / 10}%` : String(n);
};

describe('description templates', () => {
  it('Light Cone passives resolve named params ({p1} = the reference #1)', () => {
    const lc = LightConeSchema.parse(inTheNight);
    const text = fillTemplate(lc.passive.description, lightConeTemplateSlots(lc), lv1);
    expect(text).toContain("Increases the wearer's CRIT Rate by 18%");
    expect(text).toContain('for every 10 SPD that exceeds 100');
    expect(text).not.toMatch(/[{}?]/);
    expect(validateLightCone(lc)).toEqual([]);
  });

  it('ability descriptions resolve against the per-level params', () => {
    const c = CharacterSchema.parse(seele);
    const skill = c.abilities.skill;
    expect(fillTemplate(skill.description, abilityTemplateSlots(skill), lv1)).toBe(
      "Increases Seele's SPD by 25% for 2 turn(s) and deals Quantum DMG equal to 110% of Seele's ATK to one designated enemy.",
    );
  });

  it('fails validation when a placeholder does not resolve', () => {
    const lc = LightConeSchema.parse({ ...clone(inTheNight), passive: { ...clone(inTheNight.passive), description: 'CRIT Rate +{p1}%, then {p9}% and {nope}%.' } });
    expect(validateLightCone(lc)).toContain('passive: description placeholder {p9} does not resolve');
    expect(validateLightCone(lc)).toContain('passive: description placeholder {nope} does not resolve');

    const c = clone(seele);
    c.abilities.basic.description = 'Deals {p1}% and {p7}%.';
    c.eidolons[0]!.description = 'CRIT Rate +{0}% and {1}%.';
    const problems = validateCharacter(CharacterSchema.parse(c));
    expect(problems).toContain('seele.basic: description placeholder {p7} does not resolve');
    expect(problems).toContain('E1: description placeholder {1} does not resolve');

    const set = clone(sets[0]!) as (typeof sets)[number];
    set.bonuses[0]!.description = 'Outgoing Healing +{3}%';
    expect(validateRelicSet(RelicSetSchema.parse(set))).toEqual(['2-piece bonus: description placeholder {3} does not resolve']);
  });

  it('Light Cone params must be used, and references must exist', () => {
    const unused = clone(inTheNight);
    unused.passive.modifiers = [];
    unused.passive.description = 'Nothing.';
    expect(validateLightCone(LightConeSchema.parse(unused))).toContain('passive param "p1" is not used by any modifier, trigger or the description');
    const dangling = clone(inTheNight);
    (dangling.passive.modifiers[0] as { value: unknown }).value = { param: 'p9' };
    expect(validateLightCone(LightConeSchema.parse(dangling))).toContain('passive references unknown param "p9"');
  });

  it('relic set bonuses expose their modifier values', () => {
    const passerby = RelicSetSchema.parse(sets.find((s) => s.id === 'relic.passerby-of-wandering-cloud'));
    const two = passerby.bonuses.find((b) => b.pieces === 2)!;
    expect(templateProblems('{0}%', passiveTemplateSlots(two))).toEqual([]);
    expect(fillTemplate('{0}%', passiveTemplateSlots(two), lv1)).toBe('10%');
  });
});
