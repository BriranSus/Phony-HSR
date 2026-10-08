import { describe, expect, it } from 'vitest';
import seele from '@data/characters/seele.json';
import trailblazer from '@data/characters/trailblazer-remembrance.json';
import { CharacterSchema, MemospriteSchema, UltimateResourceSchema, validateCharacter } from '@models/character';
import { AbilitySchema, ConditionSchema, TRIGGER_EVENTS, TriggerSchema } from '@models/ability';

const clone = <T>(v: T): T => structuredClone(v);

describe('kit model: triggers, conditions, params, memosprites, Ultimate resources', () => {
  it('has the core HSR trigger hooks and rejects the old ambiguous one', () => {
    for (const hook of ['afterUseBasic', 'afterUseSkill', 'afterUseUltimate', 'onFollowUp', 'onEnterBattleField', 'onMemospriteSummoned', 'afterAllyAttack', 'afterAllyHit', 'afterAllyWeaknessBreak', 'onToughnessRecover', 'beforeAllyKnockedDown']) {
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

  it('ability param references must exist and tables must cover maxLevel', () => {
    const skill = clone(seele.abilities.skill);
    expect(AbilitySchema.safeParse(skill).success).toBe(true);
    (skill.effects[1] as { multiplier: unknown }).multiplier = { param: 'p9' };
    expect(AbilitySchema.safeParse(skill).success).toBe(false);
    const short = clone(seele.abilities.skill);
    short.params.p1 = [1.1, 1.2];
    expect(AbilitySchema.safeParse(short).success).toBe(false);
    // Cross-ability references ({ param, from }) are checked against the named slot.
    const c = clone(seele) as unknown as { abilities: { ultimate: { effects: Array<{ params?: Record<string, unknown> }> } } };
    c.abilities.ultimate.effects[0]!.params = { allDmg: { param: 'p9', from: 'talent' } };
    expect(validateCharacter(CharacterSchema.parse(c))).toContain('seele.ultimate references talent.p9, which does not exist');
  });

  it("memosprites need a Memosprite Skill and Talent; Mem has both, two of each skill", () => {
    const mem = clone(trailblazer.memosprite);
    expect(MemospriteSchema.safeParse(mem).success).toBe(true);
    expect(mem.abilities.filter((a) => a.kind === 'memospriteSkill')).toHaveLength(2);
    mem.abilities = mem.abilities.filter((a) => a.kind !== 'memospriteTalent');
    expect(MemospriteSchema.safeParse(mem).success).toBe(false);
    expect(MemospriteSchema.parse(trailblazer.memosprite).onZeroHp).toBe('leaveField');
  });

  it('Eidolons can boost memosprite abilities only on characters with a memosprite', () => {
    expect(validateCharacter(CharacterSchema.parse(trailblazer))).toEqual([]);
    const bad = clone(seele) as unknown as { eidolons: Array<{ abilityLevelBonus?: Record<string, number> }> };
    bad.eidolons[2]!.abilityLevelBonus = { skill: 2, memospriteSkill: 1 };
    expect(validateCharacter(CharacterSchema.parse(bad))).toContain('E3 boosts memospriteSkill but the character has no memosprite');
  });

  it('Ultimates can be Energy- or point-based; point effects need a point resource', () => {
    expect(UltimateResourceSchema.parse({ kind: 'energy', max: 120 })).toEqual({ kind: 'energy', max: 120 });
    expect(UltimateResourceSchema.parse({ kind: 'points', name: 'Newbud', max: 9, cost: 9 })).toMatchObject({ initial: 0 });
    expect(UltimateResourceSchema.safeParse({ kind: 'points', name: 'X', max: 3, cost: 4 }).success).toBe(false);
    const c = clone(seele) as unknown as { abilities: { talent: { triggers: unknown[] } }; ultimateResource: unknown };
    c.abilities.talent.triggers.push({ on: 'afterAllyAttack', effects: [{ kind: 'ultimatePoints', target: 'self', amount: 1 }] });
    expect(validateCharacter(CharacterSchema.parse(c))).toContain('"ultimatePoints" effects need ultimateResource.kind "points"');
    c.ultimateResource = { kind: 'points', name: 'Points', max: 9, cost: 9 };
    expect(validateCharacter(CharacterSchema.parse(c))).toEqual([]);
  });
});
