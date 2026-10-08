/**
 * Character kits: which effect uses which reference parameter. `pN` is the reference game's `#N`
 * ability parameter (per level). Anything a generic effect cannot express is a named script handler,
 * listed with its behaviour in docs/DATA_SOURCES.md.
 */
import { P, advance, cond, dmg, energy, heal, insert, mod, on, script, shield, status } from './builders.mjs';

const T = (n, from) => ({ param: `p${n}`, from });

// ------------------------------------------------------------------ status helpers
const base = (kind, category, id, name, description, extra) => ({
  id,
  name,
  description,
  kind,
  category,
  dispellable: kind !== 'neutral',
  duration: { turns: 1, tickOn: 'ownerTurnEnd' },
  ...extra,
});
export const buff = (id, name, description, modifiers, extra = {}) => base('buff', 'stat', id, name, description, { modifiers, ...extra });
export const debuff = (id, name, description, modifiers, extra = {}) => base('debuff', 'stat', id, name, description, { modifiers, ...extra });
const fromParam = (stat, key, extra = {}) => mod(stat, { param: key }, extra);
const minus = (stat, key, extra = {}) => mod(stat, { param: key }, { negate: true, ...extra });
const dotStatus = (id, name, description, element, extra = {}) =>
  base('debuff', 'dot', id, name, description, {
    duration: { turns: 2, tickOn: 'ownerTurnStart' },
    dot: { element, formula: 'attackerScaled', stat: 'atk', multiplier: { param: 'multiplier' } },
    ...extra,
  });
const freezeStatus = (id, name, description) =>
  base('debuff', 'cc', id, name, description, {
    duration: { turns: 1, tickOn: 'ownerTurnStart' },
    cc: { type: 'freeze', skipsTurn: true, advanceOnExpire: 0.5 },
    dot: { element: 'Ice', formula: 'attackerScaled', stat: 'atk', multiplier: { param: 'multiplier' }, damageType: 'additional', tickOn: 'ownerTurnStart' },
  });

/** Shared kit statuses (generic buffs used by several kits and Light Cones). */
export const SHARED_STATUSES = [
  buff('buff.atk-up', 'ATK Boost', 'ATK increased.', [fromParam('atkPct', 'atkPct')]),
  buff('buff.def-up', 'DEF Boost', 'DEF increased.', [fromParam('defPct', 'defPct')]),
  buff('buff.spd-up', 'SPD Boost', 'SPD increased.', [fromParam('spdPct', 'spdPct')]),
  buff('buff.dmg-up', 'DMG Boost', 'DMG dealt increased.', [fromParam('allDmg', 'allDmg')]),
  buff('buff.crit-rate-up', 'CRIT Rate Boost', 'CRIT Rate increased.', [fromParam('critRate', 'critRate')]),
  buff('buff.crit-dmg-up', 'CRIT DMG Boost', 'CRIT DMG increased.', [fromParam('critDmg', 'critDmg')]),
  buff('buff.break-effect-up', 'Break Effect Boost', 'Break Effect increased.', [fromParam('breakEffect', 'breakEffect')]),
  buff('buff.healing-up', 'Outgoing Healing Boost', 'Outgoing Healing increased.', [fromParam('outgoingHealing', 'outgoingHealing')]),
  buff('buff.ehr-up', 'Effect Hit Rate Boost', 'Effect Hit Rate increased.', [fromParam('effectHitRate', 'effectHitRate')]),
  buff('buff.dmg-reduction', 'DMG Reduction', 'DMG taken reduced.', [fromParam('dmgMitigation', 'dmgMitigation')]),
  debuff('debuff.def-down', 'DEF Reduction', 'DEF decreased.', [fromParam('defReduction', 'defDown')]),
  debuff('debuff.spd-down', 'Slow', 'SPD decreased.', [minus('spdPct', 'spdDown')]),
  debuff('debuff.atk-down', 'ATK Reduction', 'ATK decreased.', [minus('atkPct', 'atkDown')]),
  debuff('debuff.vulnerability', 'Vulnerability', 'DMG taken increased.', [fromParam('vulnerability', 'vuln')]),
  debuff('debuff.all-res-down', 'All-Type RES Reduction', 'All-Type RES decreased.', [minus('allRes', 'resDown')]),
  debuff('debuff.ice-res-down', 'Ice RES Reduction', 'Ice RES decreased.', [minus('iceRes', 'resDown')]),
  base('debuff', 'cc', 'cc.reference-taunt', 'Taunt', 'Can only attack the unit that applied Taunt.', { cc: { type: 'taunt', skipsTurn: false } }),
];

/**
 * Each kit receives `a(skillId, opts)` (ability builder bound to the character) and returns the
 * mechanical spec. Major Traces are keyed by the reference node suffix (101/102/103).
 */
export const KITS = [
  // ============================================================== DESTRUCTION
  {
    srrId: '1107',
    slug: 'clara',
    kit: (a, s) => ({
      statuses: [
        debuff(`${s}.mark-of-counter`, 'Mark of Counter', "Marked by Svarog. Clara's Skill deals additional DMG to marked enemies.", [], { duration: { turns: 0, tickOn: 'ownerTurnEnd' } }),
        buff(`${s}.promise-not-command`, 'Promise, Not Command', "DMG taken reduced, much more likely to be attacked, and Svarog's Counters are enhanced.", [fromParam('dmgMitigation', 'dmgMitigation'), fromParam('aggro', 'aggro')], {
          maxStacks: 1,
          script: 'clara.enhanced-counter',
        }),
        buff(`${s}.technique-taunt`, 'A Small Price for Victory', 'More likely to be attacked.', [fromParam('aggro', 'aggro')]),
      ],
      abilities: {
        basic: a('110701', { id: 'basic', kind: 'basic', targeting: 'enemySingle', tags: ['singleTarget'], effects: [dmg('primary', P(1))] }),
        skill: a('110702', {
          id: 'skill',
          kind: 'skill',
          targeting: 'enemyAll',
          tags: ['aoe'],
          effects: [
            dmg('allEnemies', P(1)),
            dmg('allEnemies', P(2), { toughness: 0, targetConditions: [cond('targetHasStatus', { status: `${s}.mark-of-counter` })] }),
            { kind: 'removeStatus', target: 'allEnemies', status: `${s}.mark-of-counter` },
          ],
        }),
        ultimate: a('110703', {
          id: 'ultimate',
          kind: 'ultimate',
          targeting: 'self',
          tags: ['enhance'],
          effects: [status('self', `${s}.promise-not-command`, { duration: P(3), stacks: 1, params: { dmgMitigation: P(4), aggro: P(1), counterBonus: P(2), counters: P(5) } })],
        }),
        talent: a('110704', {
          id: 'talent',
          kind: 'talent',
          targeting: 'none',
          tags: ['singleTarget'],
          energyGain: 0,
          modifiers: [mod('dmgMitigation', P(3))],
          triggers: [
            on('afterBeingHit', [status('attacker', `${s}.mark-of-counter`), insert('counter', { ability: `${s}.svarogs-counter`, target: 'attacker' })]),
          ],
        }),
        technique: a('110707', { id: 'technique', kind: 'technique', targeting: 'none', triggers: [on('battleStart', [status('self', `${s}.technique-taunt`, { duration: P(1), params: { aggro: P(2) } })])] }),
        extra: [
          a('110704', {
            id: 'svarogs-counter',
            kind: 'followUp',
            name: "Svarog's Counter",
            description: "Svarog Counters the attacker, dealing Physical DMG equal to {p2}% of Clara's ATK and marking them with a Mark of Counter.",
            targeting: 'enemySingle',
            tags: ['singleTarget'],
            effects: [dmg('primary', P(2), { attackType: 'followUp' })],
          }),
        ],
      },
      majors: {
        101: { triggers: [on('afterBeingHit', [{ kind: 'dispel', target: 'self', statusKind: 'debuff', count: 1 }], { conditions: [cond('fixedChance', { chance: 0.35 })] })] },
        102: { modifiers: [mod('debuffRes', 0.35)] },
        103: { modifiers: [mod('followUpDmg', 0.3)] },
      },
      eidolons: {
        1: { script: 'clara.e1' },
        2: { triggers: [on('afterUseUltimate', [status('self', 'buff.atk-up', { duration: 2, params: { atkPct: 0.3 } })])] },
        4: { triggers: [on('afterBeingHit', [status('self', 'buff.dmg-reduction', { duration: 1, params: { dmgMitigation: 0.3 } })])] },
        6: { script: 'clara.e6' },
      },
    }),
  },
  {
    srrId: '1205',
    slug: 'blade',
    kit: (a, s) => ({
      resources: [{ id: `${s}.charge`, name: 'Charge', max: 5, onFull: { action: 'followUp', ability: `${s}.shuhus-gift`, resetTo: 0 } }],
      statuses: [
        buff(`${s}.hellscape`, 'Hellscape', 'DMG dealt increased; Basic ATK becomes Forest of Swords and the Skill cannot be used.', [fromParam('allDmg', 'allDmg')], {
          dispellable: false,
          duration: { turns: 3, tickOn: 'ownerTurnEnd' },
          replacesAbility: { slot: 'basic', ability: `${s}.forest-of-swords` },
          blocksAbilities: ['skill'],
        }),
      ],
      abilities: {
        basic: a('120501', { id: 'basic', kind: 'basic', targeting: 'enemySingle', tags: ['singleTarget'], effects: [dmg('primary', P(1))] }),
        skill: a('120502', {
          id: 'skill',
          kind: 'skill',
          targeting: 'self',
          tags: ['enhance'],
          keepsTurn: true,
          effects: [{ kind: 'hpChange', target: 'self', mode: 'consume', ratio: P(1) }, status('self', `${s}.hellscape`, { duration: P(2), params: { allDmg: P(4) } })],
        }),
        ultimate: a('120503', {
          id: 'ultimate',
          kind: 'ultimate',
          targeting: 'enemyBlast',
          tags: ['blast'],
          effects: [
            { kind: 'hpChange', target: 'self', mode: 'setTo', ratio: 0.5 },
            dmg('primary', P(1), { extraScaling: [{ stat: 'hp', multiplier: P(2) }] }),
            dmg('adjacent', P(3), { extraScaling: [{ stat: 'hp', multiplier: P(4) }] }),
            script('blade.hp-loss-tally', { primary: P(5), adjacent: P(6), cap: P(7) }),
          ],
        }),
        talent: a('120504', {
          id: 'talent',
          kind: 'talent',
          targeting: 'none',
          tags: ['aoe'],
          energyGain: 0,
          triggers: [
            on('afterBeingHit', [{ kind: 'gainResource', target: 'self', resource: `${s}.charge`, amount: 1 }]),
            on('onHpChanged', [{ kind: 'gainResource', target: 'self', resource: `${s}.charge`, amount: 1 }]),
          ],
        }),
        technique: a('120507', {
          id: 'technique',
          kind: 'technique',
          targeting: 'none',
          triggers: [on('battleStart', [{ kind: 'hpChange', target: 'self', mode: 'consume', ratio: P(2) }, dmg('allEnemies', P(1), { stat: 'hp' })])],
        }),
        extra: [
          a('120508', {
            id: 'forest-of-swords',
            kind: 'enhancedBasic',
            targeting: 'enemyBlast',
            tags: ['blast'],
            effects: [
              { kind: 'hpChange', target: 'self', mode: 'consume', ratio: P(1) },
              dmg('primary', P(2), { attackType: 'basic', extraScaling: [{ stat: 'hp', multiplier: P(4) }] }),
              dmg('adjacent', P(3), { attackType: 'basic', extraScaling: [{ stat: 'hp', multiplier: P(5) }] }),
            ],
          }),
          a('120504', {
            id: 'shuhus-gift',
            kind: 'followUp',
            name: "Shuhu's Gift",
            description: "Follow-Up ATK on all enemies, dealing Wind DMG equal to {p2}% of Blade's ATK plus {p4}% of his Max HP, and restores HP equal to {p3}% of his Max HP.",
            targeting: 'enemyAll',
            tags: ['aoe'],
            effects: [dmg('allEnemies', P(2), { attackType: 'followUp', extraScaling: [{ stat: 'hp', multiplier: P(4) }] }), heal('self', 'hp', P(3))],
          }),
        ],
      },
      majors: {
        101: { modifiers: [mod('incomingHealing', 0.2, { conditions: [cond('hpBelow', { ratio: 0.5 })] })] },
        102: { triggers: [on('afterAttack', [heal('self', 'hp', 0.05, 100)], { conditions: [cond('attackType', { is: 'basic' }), cond('targetIsWeaknessBroken')] })] },
        103: { modifiers: [mod('followUpDmg', 0.2)] },
      },
      eidolons: {
        1: { script: 'blade.e1' },
        2: { modifiers: [mod('critRate', 0.15, { conditions: [cond('hasStatus', { status: `${s}.hellscape` })] })] },
        4: { script: 'blade.e4' },
        6: { script: 'blade.e6' },
      },
    }),
  },
  // ============================================================== HUNT
  {
    srrId: '1102',
    slug: 'seele',
    kit: (a, s) => ({
      statuses: [
        buff(`${s}.sheathed-blade`, 'SPD Boost', 'SPD increased.', [fromParam('spdPct', 'spdPct')], { duration: { turns: 2, tickOn: 'ownerTurnEnd' } }),
        buff(`${s}.amplification`, 'Amplification', 'DMG dealt increased.', [fromParam('allDmg', 'allDmg')], { dispellable: false }),
      ],
      abilities: {
        basic: a('110201', { id: 'basic', kind: 'basic', targeting: 'enemySingle', tags: ['singleTarget'], effects: [dmg('primary', P(1))] }),
        skill: a('110202', {
          id: 'skill',
          kind: 'skill',
          targeting: 'enemySingle',
          tags: ['singleTarget'],
          effects: [status('self', `${s}.sheathed-blade`, { duration: P(3), params: { spdPct: P(2) } }), dmg('primary', P(1))],
        }),
        ultimate: a('110203', {
          id: 'ultimate',
          kind: 'ultimate',
          targeting: 'enemySingle',
          tags: ['singleTarget'],
          effects: [status('self', `${s}.amplification`, { duration: T(2, 'talent'), params: { allDmg: T(1, 'talent') } }), dmg('primary', P(1))],
        }),
        talent: a('110204', {
          id: 'talent',
          kind: 'talent',
          targeting: 'none',
          tags: ['enhance'],
          triggers: [
            on('onKill', [status('self', `${s}.amplification`, { duration: P(2), params: { allDmg: P(1) } }), insert('extraTurn'), script('seele.resurgence-no-chain')], {
              conditions: [cond('attackType', { is: ['basic', 'skill', 'ultimate'] })],
            }),
          ],
        }),
        technique: a('110207', {
          id: 'technique',
          kind: 'technique',
          targeting: 'none',
          triggers: [on('battleStart', [status('self', `${s}.amplification`, { duration: T(2, 'talent'), params: { allDmg: T(1, 'talent') } })])],
        }),
      },
      majors: {
        101: { modifiers: [mod('aggro', 0.5, { negate: true, conditions: [cond('hpBelow', { ratio: 0.5 })] })] },
        102: { modifiers: [mod('resPen', 0.2, { conditions: [cond('hasStatus', { status: `${s}.amplification` })] })] },
        103: { triggers: [on('afterUseBasic', [advance('self', 0.2)])] },
      },
      eidolons: {
        1: { modifiers: [mod('critRate', 0.15, { conditions: [cond('targetHpBelow', { ratio: 0.8 })] })] },
        2: { script: 'seele.e2' },
        4: { triggers: [on('onKill', [energy('self', 15)])] },
        6: { script: 'seele.e6' },
      },
    }),
  },
  {
    srrId: '1002',
    slug: 'dan-heng',
    kit: (a, s) => ({
      statuses: [buff(`${s}.superiority-of-reach`, 'Superiority of Reach', "The next attack's Wind RES PEN is increased.", [fromParam('resPen', 'resPen')], { duration: { turns: 0, tickOn: 'ownerTurnEnd' }, dispellable: false })],
      abilities: {
        basic: a('100201', { id: 'basic', kind: 'basic', targeting: 'enemySingle', tags: ['singleTarget'], effects: [dmg('primary', P(1))] }),
        skill: a('100202', {
          id: 'skill',
          kind: 'skill',
          targeting: 'enemySingle',
          tags: ['singleTarget'],
          effects: [dmg('primary', P(1)), status('primary', 'debuff.spd-down', { baseChance: P(4), duration: P(3), params: { spdDown: P(2) }, targetConditions: [cond('isCrit')] })],
        }),
        ultimate: a('100203', {
          id: 'ultimate',
          kind: 'ultimate',
          targeting: 'enemySingle',
          tags: ['singleTarget'],
          effects: [dmg('primary', P(1)), script('dan-heng.ultimate-slowed-bonus', { bonus: P(2) })],
        }),
        talent: a('100204', {
          id: 'talent',
          kind: 'talent',
          targeting: 'none',
          tags: ['enhance'],
          triggers: [on('onTargetedByAlly', [status('self', `${s}.superiority-of-reach`, { params: { resPen: P(1) } })], { cooldown: 2 })],
        }),
        technique: a('100207', { id: 'technique', kind: 'technique', targeting: 'none', triggers: [on('battleStart', [status('self', 'buff.atk-up', { duration: P(2), params: { atkPct: P(1) } })])] }),
      },
      majors: {
        101: { modifiers: [mod('aggro', 0.5, { negate: true, conditions: [cond('hpBelow', { ratio: 0.5 })] })] },
        102: { triggers: [on('afterAttack', [status('self', 'buff.spd-up', { duration: 2, params: { spdPct: 0.2 } })], { conditions: [cond('fixedChance', { chance: 0.5 })] })] },
        103: { modifiers: [mod('basicDmg', 0.4, { conditions: [cond('targetIsSlowed')] })] },
      },
      eidolons: {
        1: { modifiers: [mod('critRate', 0.12, { conditions: [cond('targetHpAtLeast', { ratio: 0.5 })] })] },
        2: { script: 'dan-heng.e2' },
        4: { triggers: [on('onKill', [insert('extraTurn')], { conditions: [cond('attackType', { is: 'ultimate' })] })] },
        6: { script: 'dan-heng.e6' },
      },
    }),
  },
  // ============================================================== ERUDITION
  {
    srrId: '1003',
    slug: 'himeko',
    kit: (a, s) => ({
      resources: [{ id: `${s}.charge`, name: 'Charge', max: 3, initial: 1 }],
      statuses: [
        dotStatus(`${s}.burn`, 'Burn', 'Takes Fire DoT at the start of each turn.', 'Fire'),
        debuff(`${s}.fire-vulnerability`, 'Fire Vulnerability', 'Fire DMG taken increased.', [fromParam('vulnerability', 'vuln', { conditions: [cond('damageElement', { is: 'Fire' })] })]),
      ],
      abilities: {
        basic: a('100301', { id: 'basic', kind: 'basic', targeting: 'enemySingle', tags: ['singleTarget'], effects: [dmg('primary', P(1))] }),
        skill: a('100302', { id: 'skill', kind: 'skill', targeting: 'enemyBlast', tags: ['blast'], effects: [dmg('primary', P(1)), dmg('adjacent', P(2))] }),
        ultimate: a('100303', {
          id: 'ultimate',
          kind: 'ultimate',
          targeting: 'enemyAll',
          tags: ['aoe'],
          effects: [dmg('allEnemies', P(1))],
          triggers: [on('onKill', [energy('self', P(2))], { conditions: [cond('attackType', { is: 'ultimate' })] })],
        }),
        talent: a('100304', {
          id: 'talent',
          kind: 'talent',
          targeting: 'none',
          tags: ['aoe'],
          energyGain: 0,
          triggers: [
            on('afterAllyWeaknessBreak', [{ kind: 'gainResource', target: 'self', resource: `${s}.charge`, amount: 1 }]),
            on('afterAllyAttack', [insert('followUp', { ability: `${s}.victory-rush` })], { conditions: [cond('resourceAtLeast', { resource: `${s}.charge`, value: 3 })] }),
            on('afterAttack', [insert('followUp', { ability: `${s}.victory-rush` })], { conditions: [cond('resourceAtLeast', { resource: `${s}.charge`, value: 3 })] }),
          ],
        }),
        technique: a('100307', {
          id: 'technique',
          kind: 'technique',
          targeting: 'none',
          triggers: [on('battleStart', [status('allEnemies', `${s}.fire-vulnerability`, { baseChance: P(1), duration: P(3), params: { vuln: P(2) } })])],
        }),
        extra: [
          a('100304', {
            id: 'victory-rush',
            kind: 'followUp',
            name: 'Victory Rush',
            description: "Follow-Up ATK dealing Fire DMG equal to {p1}% of Himeko's ATK to all enemies, consuming all Charge.",
            targeting: 'enemyAll',
            tags: ['aoe'],
            effects: [dmg('allEnemies', P(1), { attackType: 'followUp' }), { kind: 'gainResource', target: 'self', resource: `${s}.charge`, amount: -3 }],
          }),
        ],
      },
      majors: {
        101: { triggers: [on('afterAttack', [status('primary', `${s}.burn`, { baseChance: 0.5, duration: 2, params: { multiplier: 0.3 } })])] },
        102: { modifiers: [mod('skillDmg', 0.2, { conditions: [cond('targetHasStatus', { status: `${s}.burn` })] })] },
        103: { modifiers: [mod('critRate', 0.15, { conditions: [cond('hpAtLeast', { ratio: 0.8 })] })] },
      },
      eidolons: {
        1: { triggers: [on('onFollowUp', [status('self', 'buff.spd-up', { duration: 2, params: { spdPct: 0.2 } })])] },
        2: { modifiers: [mod('allDmg', 0.15, { conditions: [cond('targetHpBelow', { ratio: 0.5 })] })] },
        4: { script: 'himeko.e4' },
        6: { script: 'himeko.e6' },
      },
    }),
  },
  {
    srrId: '1204',
    slug: 'jing-yuan',
    kit: (a, s) => ({
      statuses: [],
      summons: [
        {
          id: `${s}.lightning-lord`,
          name: 'Lightning-Lord',
          spd: { fixed: 60 },
          levelFrom: 'talent',
          resources: [{ id: `${s}.hits-per-action`, name: 'Hits Per Action', max: 10, initial: 3, resetAfterAction: 3 }],
          modifiers: [mod('spd', 10, { scaling: { per: 'resource', id: `${s}.hits-per-action`, offset: 3 } })],
          abilities: [
            a('120404', {
              id: 'lightning-lord.strike',
              kind: 'followUp',
              name: 'Prana Extirpated',
              description:
                "Each hit deals Lightning DMG equal to {p2}% of Jing Yuan's ATK to a random enemy (Follow-Up DMG), and adjacent enemies take {p5}% of that DMG. Hits Per Action: base {p4}, max {p6}; each extra hit adds {p3} SPD.",
              targeting: 'enemyBounce',
              tags: ['bounce'],
              effects: [
                dmg('randomEnemy', P(2), { source: 'owner', attackType: 'followUp', repeat: { resource: `${s}.hits-per-action` } }),
                script('jing-yuan.lightning-lord-splash', { adjacentRatio: P(5) }),
              ],
            }),
          ],
        },
      ],
      abilities: {
        basic: a('120401', { id: 'basic', kind: 'basic', targeting: 'enemySingle', tags: ['singleTarget'], effects: [dmg('primary', P(1))] }),
        skill: a('120402', {
          id: 'skill',
          kind: 'skill',
          targeting: 'enemyAll',
          tags: ['aoe'],
          effects: [dmg('allEnemies', P(1)), { kind: 'gainResource', target: 'summon', resource: `${s}.hits-per-action`, amount: P(2), duration: 'untilNextAction' }],
        }),
        ultimate: a('120403', {
          id: 'ultimate',
          kind: 'ultimate',
          targeting: 'enemyAll',
          tags: ['aoe'],
          effects: [dmg('allEnemies', P(1)), { kind: 'gainResource', target: 'summon', resource: `${s}.hits-per-action`, amount: P(2), duration: 'untilNextAction' }],
        }),
        talent: a('120404', {
          id: 'talent',
          kind: 'talent',
          targeting: 'none',
          tags: ['bounce'],
          triggers: [on('battleStart', [{ kind: 'summon', unit: `${s}.lightning-lord`, unitType: 'summon' }])],
        }),
        technique: a('120407', {
          id: 'technique',
          kind: 'technique',
          targeting: 'none',
          triggers: [on('battleStart', [{ kind: 'gainResource', target: 'summon', resource: `${s}.hits-per-action`, amount: P(1), duration: 'untilNextAction' }])],
        }),
      },
      majors: {
        101: { modifiers: [mod('critDmg', 0.25, { scope: 'summon', conditions: [cond('resourceAtLeast', { resource: `${s}.hits-per-action`, value: 6 })] })] },
        102: { triggers: [on('battleStart', [energy('self', 15, true)])] },
        103: { triggers: [on('afterUseSkill', [status('self', 'buff.crit-rate-up', { duration: 2, params: { critRate: 0.1 } })])] },
      },
      eidolons: { 1: { script: 'jing-yuan.e1' }, 2: { script: 'jing-yuan.e2' }, 4: { script: 'jing-yuan.e4' }, 6: { script: 'jing-yuan.e6' } },
    }),
  },
  // ============================================================== HARMONY
  {
    srrId: '1101',
    slug: 'bronya',
    kit: (a, s) => ({
      statuses: [
        buff(`${s}.combat-redeployment`, 'Combat Redeployment', 'DMG dealt increased.', [fromParam('allDmg', 'allDmg')]),
        buff(`${s}.belobog-march`, 'The Belobog March', 'ATK and CRIT DMG increased.', [
          fromParam('atkPct', 'atkPct'),
          fromParam('critDmg', 'critDmgFlat'),
          fromParam('critDmg', 'critDmgRatio', { scaling: { per: 'sourceStat', id: 'critDmg' } }),
        ], { duration: { turns: 2, tickOn: 'ownerTurnEnd' } }),
      ],
      abilities: {
        basic: a('110101', { id: 'basic', kind: 'basic', targeting: 'enemySingle', tags: ['singleTarget'], effects: [dmg('primary', P(1))] }),
        skill: a('110102', {
          id: 'skill',
          kind: 'skill',
          targeting: 'allySingle',
          tags: ['support'],
          effects: [
            { kind: 'dispel', target: 'selectedAlly', statusKind: 'debuff', count: 1 },
            advance('selectedAlly', 1),
            status('selectedAlly', `${s}.combat-redeployment`, { duration: P(3), params: { allDmg: P(1) } }),
          ],
        }),
        ultimate: a('110103', {
          id: 'ultimate',
          kind: 'ultimate',
          targeting: 'allyAll',
          tags: ['support'],
          effects: [status('allAllies', `${s}.belobog-march`, { duration: P(4), params: { atkPct: P(1), critDmgRatio: P(2), critDmgFlat: P(3) } })],
        }),
        talent: a('110104', { id: 'talent', kind: 'talent', targeting: 'none', tags: ['enhance'], energyGain: 0, triggers: [on('afterUseBasic', [advance('self', P(1))])] }),
        technique: a('110107', { id: 'technique', kind: 'technique', targeting: 'none', triggers: [on('battleStart', [status('allAllies', 'buff.atk-up', { duration: P(2), params: { atkPct: P(1) } })])] }),
      },
      majors: {
        101: { modifiers: [mod('critRate', 1, { conditions: [cond('attackType', { is: 'basic' })] })] },
        102: { triggers: [on('battleStart', [status('allAllies', 'buff.def-up', { duration: 2, params: { defPct: 0.2 } })])] },
        103: { modifiers: [mod('allDmg', 0.1, { scope: 'team' })] },
      },
      eidolons: {
        1: { triggers: [on('afterUseSkill', [{ kind: 'skillPoints', amount: 1 }], { conditions: [cond('fixedChance', { chance: 0.5 })], cooldown: 1 })] },
        2: { script: 'bronya.e2' },
        4: { script: 'bronya.e4' },
        6: { script: 'bronya.e6' },
      },
    }),
  },
  {
    srrId: '1202',
    slug: 'tingyun',
    kit: (a, s) => ({
      statuses: [
        buff(`${s}.benediction`, 'Benediction', "ATK increased (capped by Tingyun's ATK); attacks deal extra Lightning Additional DMG.", [fromParam('atkPct', 'atkPct')], {
          duration: { turns: 3, tickOn: 'casterTurnStart' },
          triggers: [on('afterAttack', [dmg('primary', { param: 'additional' }, { element: 'Lightning', attackType: 'additional', toughness: 0 })])],
          script: 'tingyun.benediction-atk-cap',
        }),
      ],
      abilities: {
        basic: a('120201', { id: 'basic', kind: 'basic', targeting: 'enemySingle', tags: ['singleTarget'], effects: [dmg('primary', P(1))] }),
        skill: a('120202', {
          id: 'skill',
          kind: 'skill',
          targeting: 'allySingle',
          tags: ['support'],
          effects: [status('selectedAlly', `${s}.benediction`, { duration: P(3), params: { atkPct: P(2), atkCap: P(4), additional: P(1) } })],
        }),
        ultimate: a('120203', {
          id: 'ultimate',
          kind: 'ultimate',
          targeting: 'allySingle',
          tags: ['support'],
          effects: [energy('selectedAlly', P(1), true), status('selectedAlly', 'buff.dmg-up', { duration: P(2), params: { allDmg: P(3) } })],
        }),
        talent: a('120204', { id: 'talent', kind: 'talent', targeting: 'none', tags: ['enhance'], triggers: [on('afterAttack', [script('tingyun.violet-sparknado', { ratio: P(1) })])] }),
        technique: a('120207', { id: 'technique', kind: 'technique', targeting: 'none', triggers: [on('battleStart', [energy('self', P(1), true)])] }),
      },
      majors: {
        101: { triggers: [on('afterUseSkill', [status('self', 'buff.spd-up', { duration: 1, params: { spdPct: 0.2 } })])] },
        102: { modifiers: [mod('basicDmg', 0.4)] },
        103: { triggers: [on('turnStart', [energy('self', 5, true)])] },
      },
      eidolons: { 1: { script: 'tingyun.e1' }, 2: { script: 'tingyun.e2' }, 4: { script: 'tingyun.e4' }, 6: { script: 'tingyun.e6' } },
    }),
  },
  {
    srrId: '1303',
    slug: 'ruan-mei',
    kit: (a, s) => ({
      statuses: [
        buff(`${s}.overtone`, 'Overtone', "All allies' DMG and Weakness Break Efficiency increase.", [fromParam('allDmg', 'allDmg', { scope: 'team' }), fromParam('breakEfficiency', 'breakEff', { scope: 'team' })], {
          dispellable: false,
          duration: { turns: 3, tickOn: 'ownerTurnStart' },
        }),
        buff(`${s}.zone`, 'Petals to Stream, Repose in Dream', "All allies' All-Type RES PEN increases; their attacks apply Thanatoplum Rebloom.", [fromParam('resPen', 'resPen', { scope: 'team' })], {
          kind: 'neutral',
          category: 'field',
          dispellable: false,
          duration: { turns: 2, tickOn: 'ownerTurnStart' },
          triggers: [on('afterAllyAttack', [status('primary', `${s}.thanatoplum-rebloom`, { params: { delayRatio: { param: 'delayRatio' }, delayBase: { param: 'delayBase' }, breakDmg: { param: 'breakDmg' } } })])],
        }),
        base('debuff', 'mark', `${s}.thanatoplum-rebloom`, 'Thanatoplum Rebloom', 'When this enemy would recover from Weakness Break, the Break is extended, its action is delayed and it takes Ice Break DMG.', {
          duration: { turns: 0, tickOn: 'ownerTurnStart' },
          dispellable: false,
          triggers: [on('onToughnessRecover', [{ kind: 'breakDamage', target: 'self', multiplier: { param: 'breakDmg' } }, script('ruan-mei.rebloom-delay')])],
        }),
      ],
      abilities: {
        basic: a('130301', { id: 'basic', kind: 'basic', targeting: 'enemySingle', tags: ['singleTarget'], effects: [dmg('primary', P(1))] }),
        skill: a('130302', { id: 'skill', kind: 'skill', targeting: 'self', tags: ['support'], effects: [status('self', `${s}.overtone`, { duration: P(3), params: { allDmg: P(1), breakEff: P(2) } })] }),
        ultimate: a('130303', {
          id: 'ultimate',
          kind: 'ultimate',
          targeting: 'allyAll',
          tags: ['support'],
          effects: [status('self', `${s}.zone`, { duration: P(2), params: { resPen: P(1), delayRatio: P(3), delayBase: P(4), breakDmg: P(5) } })],
        }),
        talent: a('130304', {
          id: 'talent',
          kind: 'talent',
          targeting: 'none',
          tags: ['support'],
          modifiers: [mod('spdPct', P(1), { scope: 'teamExceptSelf' })],
          triggers: [on('afterAllyWeaknessBreak', [{ kind: 'breakDamage', target: 'primary', multiplier: P(2) }])],
        }),
        technique: a('130307', {
          id: 'technique',
          kind: 'technique',
          targeting: 'none',
          triggers: [on('battleStart', [status('self', `${s}.overtone`, { duration: T(3, 'skill'), params: { allDmg: T(1, 'skill'), breakEff: T(2, 'skill') } })])],
        }),
      },
      majors: {
        101: { modifiers: [mod('breakEffect', 0.2, { scope: 'team' })] },
        102: { triggers: [on('turnStart', [energy('self', 5, true)])] },
        103: { script: 'ruan-mei.a6' },
      },
      eidolons: {
        1: { script: 'ruan-mei.e1' },
        2: { modifiers: [mod('atkPct', 0.4, { scope: 'team', conditions: [cond('targetIsWeaknessBroken')] })] },
        4: { triggers: [on('afterAllyWeaknessBreak', [status('self', 'buff.break-effect-up', { duration: 3, params: { breakEffect: 1 } })])] },
        6: { script: 'ruan-mei.e6' },
      },
    }),
  },
  // ============================================================== NIHILITY
  {
    srrId: '1005',
    slug: 'kafka',
    kit: (a, s) => ({
      statuses: [
        dotStatus(`${s}.shock`, 'Shocked', 'Takes Lightning DoT at the start of each turn.', 'Lightning'),
        debuff(`${s}.da-capo`, 'Da Capo', 'DoT received increased.', [fromParam('vulnerability', 'vuln', { conditions: [cond('attackType', { is: 'dot' })] })], { duration: { turns: 2, tickOn: 'ownerTurnEnd' } }),
      ],
      abilities: {
        basic: a('100501', { id: 'basic', kind: 'basic', targeting: 'enemySingle', tags: ['singleTarget'], effects: [dmg('primary', P(1))] }),
        skill: a('100502', {
          id: 'skill',
          kind: 'skill',
          targeting: 'enemyBlast',
          tags: ['blast'],
          effects: [dmg('primary', P(1)), dmg('adjacent', P(3)), { kind: 'detonateDot', target: 'primary', fraction: P(2) }],
        }),
        ultimate: a('100503', {
          id: 'ultimate',
          kind: 'ultimate',
          targeting: 'enemyAll',
          tags: ['aoe'],
          effects: [
            dmg('allEnemies', P(1)),
            status('allEnemies', `${s}.shock`, { baseChance: P(2), duration: P(3), params: { multiplier: P(4) } }),
            { kind: 'detonateDot', target: 'allEnemies', fraction: P(5), statuses: [`${s}.shock`] },
          ],
        }),
        talent: a('100504', {
          id: 'talent',
          kind: 'talent',
          targeting: 'none',
          tags: ['singleTarget'],
          energyGain: 0,
          triggers: [on('afterAllyAttack', [insert('followUp', { ability: `${s}.gentle-but-cruel`, target: 'primary' })], { conditions: [cond('attackType', { is: 'basic' })], limitPerTurn: 1 })],
        }),
        technique: a('100507', {
          id: 'technique',
          kind: 'technique',
          targeting: 'none',
          triggers: [on('battleStart', [dmg('allEnemies', P(3)), status('allEnemies', `${s}.shock`, { baseChance: P(1), duration: P(2), params: { multiplier: T(4, 'ultimate') } })])],
        }),
        extra: [
          a('100504', {
            id: 'gentle-but-cruel',
            kind: 'followUp',
            name: 'Gentle but Cruel',
            description: "Follow-Up ATK dealing Lightning DMG equal to {p1}% of Kafka's ATK, with a {p2}% base chance to inflict Shock (as applied by her Ultimate) for {p3} turns.",
            targeting: 'enemySingle',
            tags: ['singleTarget'],
            effects: [dmg('primary', P(1), { attackType: 'followUp' }), status('primary', `${s}.shock`, { baseChance: P(2), duration: P(3), params: { multiplier: T(4, 'ultimate') } })],
          }),
        ],
      },
      majors: {
        101: { script: 'kafka.a2' },
        102: { triggers: [on('onEnemyDefeated', [energy('self', 5)], { conditions: [cond('targetHasStatus', { status: `${s}.shock` })] })] },
        103: { script: 'kafka.a6' },
      },
      eidolons: {
        1: { triggers: [on('onFollowUp', [status('primary', `${s}.da-capo`, { baseChance: 1, duration: 2, params: { vuln: 0.3 } })])] },
        2: { modifiers: [mod('dotDmg', 0.25, { scope: 'team' })] },
        4: { script: 'kafka.e4' },
        6: { script: 'kafka.e6' },
      },
    }),
  },
  {
    srrId: '1006',
    slug: 'silver-wolf',
    kit: (a, s) => ({
      statuses: [
        debuff(`${s}.bug-atk`, 'Bug: ATK Reduction', 'ATK decreased.', [minus('atkPct', 'atkDown')], { duration: { turns: 3, tickOn: 'ownerTurnEnd' } }),
        debuff(`${s}.bug-def`, 'Bug: DEF Reduction', 'DEF decreased.', [fromParam('defReduction', 'defDown')], { duration: { turns: 3, tickOn: 'ownerTurnEnd' } }),
        debuff(`${s}.bug-spd`, 'Bug: SPD Reduction', 'SPD decreased.', [minus('spdPct', 'spdDown')], { duration: { turns: 3, tickOn: 'ownerTurnEnd' } }),
      ],
      abilities: {
        basic: a('100601', { id: 'basic', kind: 'basic', targeting: 'enemySingle', tags: ['singleTarget'], effects: [dmg('primary', P(1))] }),
        skill: a('100602', {
          id: 'skill',
          kind: 'skill',
          targeting: 'enemySingle',
          tags: ['singleTarget', 'impair'],
          effects: [
            { kind: 'implantWeakness', target: 'primary', element: 'randomPartyElement', duration: P(3), resReduction: P(4), baseChance: P(2) },
            status('primary', 'debuff.all-res-down', { baseChance: P(5), duration: P(7), params: { resDown: P(6) } }),
            dmg('primary', P(1)),
          ],
        }),
        ultimate: a('100603', {
          id: 'ultimate',
          kind: 'ultimate',
          targeting: 'enemySingle',
          tags: ['singleTarget', 'impair'],
          effects: [status('primary', 'debuff.def-down', { baseChance: P(2), duration: P(4), params: { defDown: P(3) } }), dmg('primary', P(1))],
        }),
        talent: a('100604', {
          id: 'talent',
          kind: 'talent',
          targeting: 'none',
          tags: ['impair'],
          triggers: [
            on('afterAttack', [
              { kind: 'applyRandomStatus', target: 'primary', pool: [`${s}.bug-atk`, `${s}.bug-def`, `${s}.bug-spd`], baseChance: P(4), duration: P(5), params: { atkDown: P(1), defDown: P(2), spdDown: P(3) } },
            ]),
          ],
        }),
        technique: a('100607', { id: 'technique', kind: 'technique', targeting: 'none', triggers: [on('battleStart', [dmg('allEnemies', P(1), { toughness: 20, ignoresWeakness: true })])] }),
      },
      majors: {
        101: {
          triggers: [
            on('afterAllyWeaknessBreak', [
              {
                kind: 'applyRandomStatus',
                target: 'primary',
                pool: [`${s}.bug-atk`, `${s}.bug-def`, `${s}.bug-spd`],
                baseChance: 0.65,
                duration: T(5, 'talent'),
                params: { atkDown: T(1, 'talent'), defDown: T(2, 'talent'), spdDown: T(3, 'talent') },
              },
            ]),
          ],
          script: 'silver-wolf.a2-bug-duration',
        },
        102: { script: 'silver-wolf.a4' },
        103: { script: 'silver-wolf.a6' },
      },
      eidolons: {
        1: { script: 'silver-wolf.e1' },
        2: { modifiers: [mod('effectRes', 0.2, { scope: 'allEnemies', negate: true })] },
        4: { script: 'silver-wolf.e4' },
        6: { modifiers: [mod('allDmg', 0.2, { scaling: { per: 'targetDebuffCount', max: 5 } })] },
      },
    }),
  },
  {
    srrId: '1106',
    slug: 'pela',
    kit: (a, s) => ({
      statuses: [debuff(`${s}.exposed`, 'Exposed', 'DEF decreased.', [fromParam('defReduction', 'defDown')], { duration: { turns: 2, tickOn: 'ownerTurnEnd' } })],
      abilities: {
        basic: a('110601', { id: 'basic', kind: 'basic', targeting: 'enemySingle', tags: ['singleTarget'], effects: [dmg('primary', P(1))] }),
        skill: a('110602', {
          id: 'skill',
          kind: 'skill',
          targeting: 'enemySingle',
          tags: ['singleTarget', 'impair'],
          effects: [{ kind: 'dispel', target: 'primary', statusKind: 'buff', count: P(2) }, dmg('primary', P(1))],
        }),
        ultimate: a('110603', {
          id: 'ultimate',
          kind: 'ultimate',
          targeting: 'enemyAll',
          tags: ['aoe', 'impair'],
          effects: [dmg('allEnemies', P(4)), status('allEnemies', `${s}.exposed`, { baseChance: P(1), duration: P(3), params: { defDown: P(2) } })],
        }),
        talent: a('110604', {
          id: 'talent',
          kind: 'talent',
          targeting: 'none',
          tags: ['support'],
          triggers: [on('afterAttack', [energy('self', P(1))], { conditions: [cond('targetIsDebuffed')] })],
        }),
        technique: a('110607', {
          id: 'technique',
          kind: 'technique',
          targeting: 'none',
          triggers: [on('battleStart', [dmg('randomEnemy', P(4)), status('allEnemies', 'debuff.def-down', { baseChance: P(1), duration: P(3), params: { defDown: P(2) } })])],
        }),
      },
      majors: {
        101: { modifiers: [mod('allDmg', 0.2, { conditions: [cond('targetIsDebuffed')] })] },
        102: { modifiers: [mod('effectHitRate', 0.1, { scope: 'team' })] },
        103: { script: 'pela.a6' },
      },
      eidolons: {
        1: { triggers: [on('onEnemyDefeated', [energy('self', 5)])] },
        2: { script: 'pela.e2' },
        4: { triggers: [on('afterUseSkill', [status('primary', 'debuff.ice-res-down', { baseChance: 1, duration: 2, params: { resDown: 0.12 } })])] },
        6: { triggers: [on('afterAttack', [dmg('primary', 0.4, { attackType: 'additional', toughness: 0 })], { conditions: [cond('targetIsDebuffed')] })] },
      },
    }),
  },
  {
    srrId: '1004',
    slug: 'welt',
    kit: (a, s) => ({
      statuses: [
        base('debuff', 'cc', `${s}.imprisonment`, 'Imprisoned', 'Action delayed and SPD reduced.', {
          duration: { turns: 1, tickOn: 'ownerTurnStart' },
          modifiers: [minus('spdPct', 'spdDown')],
          cc: { type: 'imprisonment', skipsTurn: false, delayOnApply: { param: 'delay' } },
        }),
      ],
      abilities: {
        basic: a('100401', { id: 'basic', kind: 'basic', targeting: 'enemySingle', tags: ['singleTarget'], effects: [dmg('primary', P(1))] }),
        skill: a('100402', {
          id: 'skill',
          kind: 'skill',
          targeting: 'enemyBounce',
          tags: ['bounce', 'impair'],
          effects: [
            dmg('primary', P(1)),
            dmg('randomEnemy', P(1), { bounces: 1 }),
            status('primary', 'debuff.spd-down', { baseChance: P(2), duration: P(4), params: { spdDown: P(3) } }),
          ],
        }),
        ultimate: a('100403', {
          id: 'ultimate',
          kind: 'ultimate',
          targeting: 'enemyAll',
          tags: ['aoe', 'impair'],
          effects: [dmg('allEnemies', P(1)), status('allEnemies', `${s}.imprisonment`, { baseChance: P(3), duration: 1, params: { delay: P(2), spdDown: P(4) } })],
        }),
        talent: a('100404', {
          id: 'talent',
          kind: 'talent',
          targeting: 'none',
          tags: ['enhance'],
          triggers: [on('afterAttack', [dmg('primary', P(1), { attackType: 'additional', toughness: 0 })], { conditions: [cond('targetIsSlowed')] })],
        }),
        technique: a('100407', {
          id: 'technique',
          kind: 'technique',
          targeting: 'none',
          triggers: [on('battleStart', [status('allEnemies', `${s}.imprisonment`, { baseChance: P(1), duration: 1, params: { delay: P(2), spdDown: P(3) } })])],
        }),
      },
      majors: {
        101: { triggers: [on('afterUseUltimate', [status('allEnemies', 'debuff.vulnerability', { baseChance: 1, duration: 2, params: { vuln: 0.12 } })])] },
        102: { triggers: [on('afterUseUltimate', [energy('self', 10)])] },
        103: { modifiers: [mod('allDmg', 0.2, { conditions: [cond('targetIsWeaknessBroken')] })] },
      },
      eidolons: {
        1: { script: 'welt.e1' },
        2: { triggers: [on('afterAttack', [energy('self', 3)], { conditions: [cond('targetIsSlowed')] })] },
        4: { script: 'welt.e4' },
        6: { script: 'welt.e6' },
      },
    }),
  },
  // ============================================================== PRESERVATION
  {
    srrId: '1001',
    slug: 'march-7th',
    kit: (a, s) => ({
      statuses: [
        freezeStatus(`${s}.freeze`, 'Frozen', 'Cannot take action; takes Ice Additional DMG at the start of each turn.'),
        buff(`${s}.power-of-cuteness`, 'The Power of Cuteness', 'Much more likely to be attacked by enemies.', [fromParam('aggro', 'aggro')], { duration: { turns: 3, tickOn: 'casterTurnStart' } }),
      ],
      abilities: {
        basic: a('100101', { id: 'basic', kind: 'basic', targeting: 'enemySingle', tags: ['singleTarget'], effects: [dmg('primary', P(1))] }),
        skill: a('100102', {
          id: 'skill',
          kind: 'skill',
          targeting: 'allySingle',
          tags: ['defense'],
          effects: [
            shield('selectedAlly', P(1), P(4), P(2)),
            status('selectedAlly', `${s}.power-of-cuteness`, { duration: P(2), params: { aggro: P(5) }, targetConditions: [cond('targetHpAtLeast', { ratio: 0.3 })] }),
          ],
        }),
        ultimate: a('100103', {
          id: 'ultimate',
          kind: 'ultimate',
          targeting: 'enemyAll',
          tags: ['aoe', 'impair'],
          effects: [dmg('allEnemies', P(1)), status('allEnemies', `${s}.freeze`, { baseChance: P(2), duration: P(3), params: { multiplier: P(4) } })],
        }),
        talent: a('100104', {
          id: 'talent',
          kind: 'talent',
          targeting: 'none',
          tags: ['singleTarget'],
          energyGain: 0,
          triggers: [
            on('afterAllyHit', [insert('counter', { ability: `${s}.girl-power`, target: 'attacker' })], { conditions: [cond('targetHasShield')], limitPerTurn: 2 }),
            on('afterBeingHit', [insert('counter', { ability: `${s}.girl-power`, target: 'attacker' })], { conditions: [cond('targetHasShield')], limitPerTurn: 2 }),
          ],
        }),
        technique: a('100107', { id: 'technique', kind: 'technique', targeting: 'none', triggers: [on('battleStart', [status('randomEnemy', `${s}.freeze`, { baseChance: P(1), duration: P(2), params: { multiplier: P(3) } })])] }),
        extra: [
          a('100104', {
            id: 'girl-power',
            kind: 'followUp',
            name: 'Girl Power',
            description: "March 7th Counters, dealing Ice DMG equal to {p1}% of her ATK to the attacker.",
            targeting: 'enemySingle',
            tags: ['singleTarget'],
            effects: [dmg('primary', P(1), { attackType: 'followUp' })],
          }),
        ],
      },
      majors: {
        101: { triggers: [on('afterUseSkill', [{ kind: 'dispel', target: 'selectedAlly', statusKind: 'debuff', count: 1 }])] },
        102: { script: 'march-7th.a4' },
        103: { script: 'march-7th.a6' },
      },
      eidolons: {
        1: { script: 'march-7th.e1' },
        2: { triggers: [on('battleStart', [shield('lowestHpAlly', 0.24, 320, 3)])] },
        4: { script: 'march-7th.e4' },
        6: { script: 'march-7th.e6' },
      },
    }),
  },
  {
    srrId: '1104',
    slug: 'gepard',
    kit: (a, s) => ({
      statuses: [freezeStatus(`${s}.freeze`, 'Frozen', 'Cannot take action; takes Ice Additional DMG at the start of each turn.')],
      abilities: {
        basic: a('110401', { id: 'basic', kind: 'basic', targeting: 'enemySingle', tags: ['singleTarget'], effects: [dmg('primary', P(1))] }),
        skill: a('110402', {
          id: 'skill',
          kind: 'skill',
          targeting: 'enemySingle',
          tags: ['singleTarget', 'impair'],
          effects: [dmg('primary', P(1)), status('primary', `${s}.freeze`, { baseChance: P(2), duration: P(3), params: { multiplier: P(4) } })],
        }),
        ultimate: a('110403', { id: 'ultimate', kind: 'ultimate', targeting: 'allyAll', tags: ['defense'], effects: [shield('allAllies', P(1), P(3), P(2))] }),
        talent: a('110404', {
          id: 'talent',
          kind: 'talent',
          targeting: 'none',
          tags: ['restore'],
          triggers: [on('beforeKnockedDown', [{ kind: 'revive', target: 'self', ratio: P(1) }], { limitPerBattle: 1 })],
        }),
        technique: a('110407', { id: 'technique', kind: 'technique', targeting: 'none', triggers: [on('battleStart', [shield('allAllies', P(1), P(3), P(2))])] }),
      },
      majors: {
        101: { modifiers: [mod('aggro', 3)] },
        102: { script: 'gepard.a4' },
        103: { modifiers: [mod('atk', 0.35, { scaling: { per: 'stat', id: 'def' } })] },
      },
      eidolons: { 1: { script: 'gepard.e1' }, 2: { script: 'gepard.e2' }, 4: { modifiers: [mod('effectRes', 0.2, { scope: 'team' })] }, 6: { script: 'gepard.e6' } },
    }),
  },
  // ============================================================== ABUNDANCE
  {
    srrId: '1105',
    slug: 'natasha',
    kit: (a, s) => ({
      statuses: [
        base('buff', 'hot', `${s}.continuous-healing`, 'Continuous Healing', 'Restores HP at the start of each turn.', {
          duration: { turns: 2, tickOn: 'ownerTurnStart' },
          hot: { stat: 'hp', multiplier: { param: 'multiplier' }, flat: { param: 'flat' } },
        }),
        debuff(`${s}.weakened`, 'Weakened', 'DMG dealt reduced.', [fromParam('weaken', 'weaken')]),
      ],
      abilities: {
        basic: a('110501', { id: 'basic', kind: 'basic', targeting: 'enemySingle', tags: ['singleTarget'], effects: [dmg('primary', P(1))] }),
        skill: a('110502', {
          id: 'skill',
          kind: 'skill',
          targeting: 'allySingle',
          tags: ['restore'],
          effects: [heal('selectedAlly', 'hp', P(1), P(4)), status('selectedAlly', `${s}.continuous-healing`, { duration: P(3), params: { multiplier: P(2), flat: P(5) } })],
        }),
        ultimate: a('110503', { id: 'ultimate', kind: 'ultimate', targeting: 'allyAll', tags: ['restore'], effects: [heal('allAllies', 'hp', P(1), P(2))] }),
        talent: a('110504', {
          id: 'talent',
          kind: 'talent',
          targeting: 'none',
          tags: ['enhance'],
          modifiers: [mod('outgoingHealing', P(2), { conditions: [cond('targetHpBelow', { ratio: 0.3 })] })],
        }),
        technique: a('110507', {
          id: 'technique',
          kind: 'technique',
          targeting: 'none',
          triggers: [on('battleStart', [dmg('randomEnemy', P(4)), status('allEnemies', `${s}.weakened`, { baseChance: P(1), duration: P(3), params: { weaken: P(2) } })])],
        }),
      },
      majors: {
        101: { triggers: [on('afterUseSkill', [{ kind: 'dispel', target: 'selectedAlly', statusKind: 'debuff', count: 1 }])] },
        102: { modifiers: [mod('outgoingHealing', 0.1)] },
        103: { script: 'natasha.a6' },
      },
      eidolons: {
        1: { triggers: [on('afterBeingHit', [heal('self', 'hp', 0.15, 400)], { conditions: [cond('hpBelow', { ratio: 0.3 })], limitPerBattle: 1 })] },
        2: { script: 'natasha.e2' },
        4: { triggers: [on('afterBeingHit', [energy('self', 5)])] },
        6: { script: 'natasha.e6' },
      },
    }),
  },
  {
    srrId: '1211',
    slug: 'bailu',
    kit: (a, s) => ({
      statuses: [
        buff(`${s}.invigoration`, 'Invigoration', "Restores HP after being hit (from Bailu's Max HP).", [], {
          duration: { turns: 2, tickOn: 'ownerTurnEnd' },
          script: 'bailu.invigoration',
        }),
      ],
      abilities: {
        basic: a('121101', { id: 'basic', kind: 'basic', targeting: 'enemySingle', tags: ['singleTarget'], effects: [dmg('primary', P(1))] }),
        skill: a('121102', {
          id: 'skill',
          kind: 'skill',
          targeting: 'allySingle',
          tags: ['restore'],
          effects: [heal('selectedAlly', 'hp', P(1), P(2), { repeats: { count: P(4), decay: P(3) } })],
        }),
        ultimate: a('121103', {
          id: 'ultimate',
          kind: 'ultimate',
          targeting: 'allyAll',
          tags: ['restore'],
          effects: [heal('allAllies', 'hp', P(1), P(2)), status('allAllies', `${s}.invigoration`, { duration: P(3), params: { multiplier: T(1, 'talent'), flat: T(2, 'talent'), triggers: T(5, 'talent') } })],
        }),
        talent: a('121104', {
          id: 'talent',
          kind: 'talent',
          targeting: 'none',
          tags: ['restore'],
          triggers: [on('beforeAllyKnockedDown', [{ kind: 'revive', target: 'primary', ratio: P(3), flat: P(4), fromSource: true }], { limitPerBattle: 1 })],
        }),
        technique: a('121107', {
          id: 'technique',
          kind: 'technique',
          targeting: 'none',
          triggers: [on('battleStart', [status('allAllies', `${s}.invigoration`, { duration: P(1), params: { multiplier: T(1, 'talent'), flat: T(2, 'talent'), triggers: T(5, 'talent') } })])],
        }),
      },
      majors: {
        101: { script: 'bailu.a2' },
        102: { script: 'bailu.a4' },
        103: { modifiers: [mod('dmgMitigation', 0.1, { scope: 'team', conditions: [cond('hasStatus', { status: `${s}.invigoration` })] })] },
      },
      eidolons: {
        1: { script: 'bailu.e1' },
        2: { triggers: [on('afterUseUltimate', [status('self', 'buff.healing-up', { duration: 2, params: { outgoingHealing: 0.15 } })])] },
        4: { script: 'bailu.e4' },
        6: { script: 'bailu.e6' },
      },
    }),
  },
  // ============================================================== REMEMBRANCE
  {
    srrId: '8008',
    slug: 'trailblazer-remembrance',
    name: 'Trailblazer (Remembrance)',
    kit: (a, s) => {
      const mem = `${s}.mem`;
      return {
        resources: [{ id: `${s}.epic`, name: 'Epic', max: 2 }],
        statuses: [
          buff(`${mem}.support`, "Mem's Support", 'Each instance of DMG dealt also deals True DMG equal to a percentage of the original DMG.', [], {
            duration: { turns: 3, tickOn: 'ownerTurnEnd' },
            script: 'mem.support-true-damage',
          }),
        ],
        memosprite: {
          id: mem,
          name: 'Mem',
          hpFromOwner: { ratio: { table: a.talentTable(2) }, flat: { table: a.talentTable(4) }, levelFrom: 'talent' },
          spd: { fixed: 130 },
          aggro: 100,
          resources: [{ id: `${mem}.charge`, name: 'Charge', max: 1, onFull: { action: 'memospriteAction', ability: `${mem}.lemme-help-you`, resetTo: 0 } }],
          abilities: [
            a('1800701', {
              servant: true,
              id: 'mem.baddies-trouble',
              kind: 'memospriteSkill',
              targeting: 'enemyAll',
              tags: ['aoe'],
              effects: [dmg('randomEnemy', P(1), { bounces: 3 }), dmg('allEnemies', P(3))],
            }),
            a('1800707', {
              servant: true,
              id: 'mem.lemme-help-you',
              kind: 'memospriteSkill',
              targeting: 'allySingle',
              tags: ['support'],
              effects: [advance('selectedAlly', P(3)), status('selectedAlly', `${mem}.support`, { duration: P(2), params: { trueDmg: P(1) } })],
            }),
            a('1800703', {
              servant: true,
              id: 'mem.friends-together',
              kind: 'memospriteTalent',
              targeting: 'none',
              tags: ['support'],
              modifiers: [mod('critDmg', P(2), { scope: 'team' }), mod('critDmg', P(1), { scope: 'team', scaling: { per: 'stat', id: 'critDmg' } })],
            }),
            a('1800705', {
              servant: true,
              id: 'mem.go-mem-go',
              kind: 'memospriteTalent',
              targeting: 'none',
              tags: ['enhance'],
              triggers: [on('onEnterBattleField', [{ kind: 'gainResource', target: 'self', resource: `${mem}.charge`, amount: P(1) }])],
            }),
            a('1800706', {
              servant: true,
              id: 'mem.no-regrets',
              kind: 'memospriteTalent',
              targeting: 'none',
              tags: ['enhance'],
              triggers: [on('onLeaveField', [advance('owner', P(1))])],
            }),
          ],
        },
        abilities: {
          basic: a('800801', { id: 'basic', kind: 'basic', targeting: 'enemySingle', tags: ['singleTarget'], effects: [dmg('primary', P(1))] }),
          skill: a('800802', {
            id: 'skill',
            kind: 'skill',
            targeting: 'self',
            tags: ['summon'],
            effects: [
              { kind: 'summon', unit: mem, unitType: 'memosprite' },
              script('trailblazer-remembrance.skill-restore-mem', { hpRatio: P(1) }),
              { kind: 'gainResource', target: 'memosprite', resource: `${mem}.charge`, amount: P(2) },
            ],
          }),
          ultimate: a('800803', {
            id: 'ultimate',
            kind: 'ultimate',
            targeting: 'enemyAll',
            tags: ['aoe', 'summon'],
            effects: [
              { kind: 'summon', unit: mem, unitType: 'memosprite' },
              { kind: 'gainResource', target: 'memosprite', resource: `${mem}.charge`, amount: P(2) },
              dmg('allEnemies', P(1), { source: 'memosprite' }),
            ],
          }),
          talent: a('800804', { id: 'talent', kind: 'talent', targeting: 'none', tags: ['enhance'], triggers: [on('battleStart', [script('trailblazer-remembrance.energy-to-charge', { energyPerCharge: P(3) })])] }),
          technique: a('800807', { id: 'technique', kind: 'technique', targeting: 'none', triggers: [on('battleStart', [{ kind: 'actionAdvance', target: 'allEnemies', fraction: P(2), delay: true }, dmg('allEnemies', P(3))])] }),
          extra: [
            a('800808', {
              id: 'together-we-script-tomorrow',
              kind: 'enhancedBasic',
              targeting: 'enemyAll',
              tags: ['aoe'],
              effects: [
                { kind: 'gainResource', target: 'self', resource: `${s}.epic`, amount: -1 },
                { kind: 'dispel', target: 'memosprite', statusKind: 'debuff', count: 9, category: 'cc' },
                dmg('allEnemies', P(1), { attackType: 'basic' }),
                dmg('allEnemies', P(2), { source: 'memosprite', attackType: 'basic', toughness: 0 }),
                { kind: 'gainResource', target: 'memosprite', resource: `${mem}.charge`, amount: P(3) },
              ],
            }),
          ],
        },
        majors: {
          101: { triggers: [on('battleStart', [advance('self', 0.3)]), on('onMemospriteSummoned', [{ kind: 'gainResource', target: 'memosprite', resource: `${mem}.charge`, amount: 0.4 }], { limitPerBattle: 1 })] },
          102: { script: 'trailblazer-remembrance.a4' },
          103: { script: 'trailblazer-remembrance.a6' },
          501: { triggers: [on('afterUseUltimate', [{ kind: 'gainResource', target: 'self', resource: `${s}.epic`, amount: 1 }])], script: 'trailblazer-remembrance.epic-enhanced-basic' },
        },
        eidolons: {
          1: { script: 'trailblazer-remembrance.e1' },
          2: { script: 'trailblazer-remembrance.e2' },
          4: { script: 'trailblazer-remembrance.e4' },
          6: { modifiers: [mod('critRate', 1, { conditions: [cond('attackType', { is: 'ultimate' })] })] },
        },
      };
    },
  },
];
