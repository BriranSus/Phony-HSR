import { describe, expect, it } from 'vitest';
import ignatius from '@data/characters/ignatius.json';
import lyra from '@data/characters/lyra.json';
import { CharacterSchema, MemospriteSchema, UltimateResourceSchema, validateCharacter } from '@models/character';
import { ConditionSchema, TRIGGER_EVENTS, TriggerSchema } from '@models/ability';

const clone = <T>(v: T): T => structuredClone(v);

describe('kit model: triggers, conditions, memosprites, Ultimate resources', () => {
  it('has the core HSR trigger hooks and rejects the old ambiguous one', () => {
    for (const hook of ['afterUseBasic', 'afterUseSkill', 'afterUseUltimate', 'onFollowUp', 'onEnterBattleField', 'onMemospriteSummoned', 'afterAllyAttack', 'afterAllyHit']) {
      expect(TRIGGER_EVENTS).toContain(hook);
    }
    const effects = [{ kind: 'energy', target: 'self', amount: 5 }];
    expect(TriggerSchema.safeParse({ on: 'afterAllyAttacked', effects }).success).toBe(false);
    expect(TriggerSchema.safeParse({ on: 'afterUseUltimate', effects }).success).toBe(true);
  });

  it('condition types are a closed list (typos fail at load)', () => {
    expect(ConditionSchema.safeParse({ type: 'hpBelow', params: { ratio: 0.5 } }).success).toBe(true);
    expect(ConditionSchema.safeParse({ type: 'hpBelowe' }).success).toBe(false);
  });

  it('memosprites need both a Memosprite Skill and a Memosprite Talent', () => {
    const aria = clone(lyra.memosprite);
    expect(MemospriteSchema.safeParse(aria).success).toBe(true);
    aria.abilities = aria.abilities.filter((a) => a.kind !== 'memospriteTalent');
    expect(MemospriteSchema.safeParse(aria).success).toBe(false);
    expect(MemospriteSchema.parse(lyra.memosprite).onZeroHp).toBe('leaveField');
  });

  it('Eidolons can boost memosprite abilities (Remembrance E3/E5 pattern)', () => {
    const c = CharacterSchema.parse(lyra);
    expect(c.eidolons[2]!.abilityLevelBonus).toEqual({ ultimate: 2, basic: 1, memospriteSkill: 1 });
    expect(c.eidolons[4]!.abilityLevelBonus).toEqual({ skill: 2, talent: 2, memospriteTalent: 1 });
    expect(c.eidolons[2]!.description).toContain('Memosprite Skill Lv. +1, up to a maximum of Lv. 10');
    expect(validateCharacter(c)).toEqual([]);
    // ...but only for characters that have a memosprite.
    const bad = clone(ignatius) as unknown as { eidolons: Array<{ abilityLevelBonus?: Record<string, number> }> };
    bad.eidolons[2]!.abilityLevelBonus = { skill: 2, memospriteSkill: 1 };
    expect(validateCharacter(CharacterSchema.parse(bad))).toContain('E3 boosts memospriteSkill but the character has no memosprite');
  });

  it('Ultimates can be Energy- or point-based; point effects need a point resource', () => {
    expect(UltimateResourceSchema.parse({ kind: 'energy', max: 120 })).toEqual({ kind: 'energy', max: 120 });
    expect(UltimateResourceSchema.parse({ kind: 'points', name: 'Echo Stacks', max: 9, cost: 9 })).toMatchObject({ initial: 0 });
    expect(UltimateResourceSchema.safeParse({ kind: 'points', name: 'X', max: 3, cost: 4 }).success).toBe(false);
    const c = clone(ignatius) as typeof ignatius & { abilities: { talent: { triggers: unknown[] } } };
    c.abilities.talent.triggers.push({ on: 'afterAllyAttack', effects: [{ kind: 'ultimatePoints', target: 'self', amount: 1 }] });
    expect(validateCharacter(CharacterSchema.parse(c))).toContain('"ultimatePoints" effects need ultimateResource.kind "points"');
    const points = { ...c, ultimateResource: { kind: 'points', name: 'Embers', max: 9, cost: 9 } };
    expect(validateCharacter(CharacterSchema.parse(points))).toEqual([]);
  });
});
