/**
 * Light Cones: stats, promotion costs, fodder EXP and lore from the sources; passives map each
 * reference parameter (`#N` -> `pN`, one value per Superimposition) to modifiers and triggers.
 */
import { advance, cond, energy, heal, mod, on, P, PATH_MAP, script, slugify, status, toTemplate } from './builders.mjs';
import { buff, debuff } from './kits.mjs';
import { checkGrowth } from './characters.mjs';
import { source, SOURCES } from './sources.mjs';

const fp = (stat, key, extra = {}) => mod(stat, { param: key }, extra);

export const LIGHT_CONE_STATUSES = [
  debuff('lc.ensnared', 'Ensnared', 'DEF decreased.', [fp('defReduction', 'defDown')]),
  buff('lc.patience-spd', 'Spider Web', 'SPD increased (stacks).', [fp('spdPct', 'spdPct')], { maxStacks: 3, duration: { turns: 0, tickOn: 'ownerTurnEnd' } }),
  {
    id: 'lc.erode',
    name: 'Erode',
    description: 'Counts as Shocked: takes Lightning DoT at the start of each turn.',
    kind: 'debuff',
    category: 'dot',
    dispellable: true,
    duration: { turns: 1, tickOn: 'ownerTurnStart' },
    dot: { element: 'Lightning', formula: 'attackerScaled', stat: 'atk', multiplier: { param: 'multiplier' } },
  },
  debuff('lc.aether-code', 'Aether Code', 'DMG taken increased.', [fp('vulnerability', 'vuln')]),
  buff('lc.unfulfilled-yearning', 'Unfulfilled Yearning', 'DMG dealt increased; removed after attacking.', [fp('allDmg', 'allDmg')], { duration: { turns: 0, tickOn: 'ownerTurnEnd' }, script: 'lc.remove-after-attack' }),
  buff('lc.somnus-corpus', 'Somnus Corpus', 'The next Follow-Up ATK deals more DMG.', [fp('followUpDmg', 'followUpDmg')], { duration: { turns: 0, tickOn: 'ownerTurnEnd' }, script: 'lc.consume-on-follow-up' }),
];

/** Passive mechanics per reference Light Cone id (`P(n)` = superimposed param n). */
export const CONES = {
  20000: { modifiers: [], triggers: [on('battleStart', [status('self', 'buff.crit-rate-up', { duration: P(2), params: { critRate: P(1) } })])] },
  20004: { triggers: [on('battleStart', [status('self', 'buff.ehr-up', { duration: P(2), params: { effectHitRate: P(1) } })])] },
  20010: { triggers: [on('afterUseUltimate', [heal('self', 'hp', P(1))])] },
  21000: { modifiers: [mod('energyRegen', P(1)), mod('outgoingHealing', P(2), { conditions: [cond('attackType', { is: 'ultimate' })] })] },
  21001: { modifiers: [mod('allDmg', P(1), { scaling: { per: 'targetDebuffCount', max: 3 } })] },
  21002: { modifiers: [mod('defPct', P(1)), mod('allRes', P(2), { scope: 'team' })] },
  21003: { modifiers: [mod('atkPct', P(1)), mod('critRate', P(2), { conditions: [cond('enemyCountAtMost', { count: 2 })] })] },
  21004: { modifiers: [mod('breakEffect', P(1))], triggers: [on('afterAttack', [energy('self', P(2))], { limitPerTurn: 1 })] },
  21015: { triggers: [on('afterAttack', [status('primary', 'lc.ensnared', { baseChance: P(1), duration: P(3), params: { defDown: P(2) } })])] },
  21017: {
    modifiers: [mod('basicDmg', P(1)), mod('skillDmg', P(1)), mod('basicDmg', P(2), { conditions: [cond('energyFull')] }), mod('skillDmg', P(2), { conditions: [cond('energyFull')] })],
  },
  21018: { triggers: [on('afterUseUltimate', [advance('allAllies', P(1))])] },
  21050: { modifiers: [mod('critDmg', P(1))], triggers: [on('battleStart', [script('lc.victory-in-a-blink', { allDmg: P(2), duration: P(3) })])] },
  23000: {
    modifiers: [mod('atkPct', P(2), { scaling: { per: 'enemyCount', max: 5, whole: true } })],
    triggers: [on('afterAllyWeaknessBreak', [status('self', 'buff.dmg-up', { duration: 1, params: { allDmg: P(1) } })])],
  },
  23001: {
    modifiers: [
      mod('critRate', P(1)),
      mod('basicDmg', P(3), { scaling: { per: 'stat', id: 'spd', step: 10, offset: 100, max: 6, whole: true } }),
      mod('skillDmg', P(3), { scaling: { per: 'stat', id: 'spd', step: 10, offset: 100, max: 6, whole: true } }),
      mod('critDmg', P(4), { conditions: [cond('attackType', { is: 'ultimate' })], scaling: { per: 'stat', id: 'spd', step: 10, offset: 100, max: 6, whole: true } }),
    ],
  },
  23002: {
    modifiers: [mod('atkPct', P(1))],
    triggers: [
      on('onKill', [heal('self', 'atk', P(2)), status('self', 'buff.dmg-up', { duration: 1, params: { allDmg: P(3) } })], { limitPerTurn: 1 }),
      on('afterBeingHit', [heal('self', 'atk', P(2)), status('self', 'buff.dmg-up', { duration: 1, params: { allDmg: P(3) } })], { limitPerTurn: 1 }),
    ],
  },
  23003: {
    modifiers: [mod('energyRegen', P(1))],
    triggers: [
      on('afterUseUltimate', [{ kind: 'skillPoints', amount: 1 }, script('lc.but-the-battle-every-second-ultimate')], { conditions: [cond('abilityTargetsAlly')] }),
      on('afterUseSkill', [script('lc.but-the-battle-next-ally', { allDmg: P(2), duration: P(3) })]),
    ],
  },
  23004: {
    modifiers: [
      mod('allDmg', P(1), { conditions: [cond('targetIsDebuffed')] }),
      mod('effectHitRate', P(2), { conditions: [cond('attackType', { is: 'skill' })] }),
      mod('atkPct', P(3), { conditions: [cond('attackType', { is: 'skill' })] }),
    ],
  },
  23005: {
    modifiers: [mod('defPct', P(2)), mod('effectHitRate', P(4)), mod('aggro', P(1))],
    triggers: [on('afterBeingHit', [status('self', 'buff.def-up', { duration: 1, params: { defPct: P(3) } })])],
  },
  23006: {
    modifiers: [mod('allDmg', P(2))],
    triggers: [on('afterAttack', [status('self', 'lc.patience-spd', { params: { spdPct: P(3) } }), status('primary', 'lc.erode', { baseChance: 1, duration: P(5), params: { multiplier: P(1) } })])],
  },
  23007: {
    modifiers: [mod('effectHitRate', P(1)), mod('critRate', P(5), { conditions: [cond('debuffCountAtLeast', { count: 3 })] })],
    triggers: ['afterUseBasic', 'afterUseSkill', 'afterUseUltimate'].map((e) => on(e, [status('randomEnemy', 'lc.aether-code', { baseChance: P(2), duration: 1, params: { vuln: P(3) } })])),
  },
  23009: {
    modifiers: [mod('critRate', P(1)), mod('hpPct', P(2))],
    triggers: [on('afterBeingHit', [status('self', 'lc.unfulfilled-yearning', { params: { allDmg: P(3) } })]), on('onHpChanged', [status('self', 'lc.unfulfilled-yearning', { params: { allDmg: P(3) } })])],
  },
  23010: {
    modifiers: [mod('critDmg', P(1)), mod('skillDmg', P(2)), mod('ultimateDmg', P(2))],
    triggers: ['afterUseSkill', 'afterUseUltimate'].map((e) => on(e, [status('self', 'lc.somnus-corpus', { params: { followUpDmg: P(3) } })])),
  },
  23013: { modifiers: [mod('hpPct', P(1)), mod('outgoingHealing', P(2))], triggers: [on('battleStart', [script('lc.time-waits-for-no-one', { ratio: P(3) })])] },
  23019: {
    modifiers: [mod('breakEffect', P(1))],
    triggers: [
      on('afterUseUltimate', [status('allAllies', 'buff.dmg-up', { duration: P(3), params: { allDmg: P(2) } })]),
      on('afterUseUltimate', [{ kind: 'skillPoints', amount: 1 }], { conditions: [cond('statAtLeast', { stat: 'breakEffect', value: 1.5 })] }),
      on('waveStart', [energy('allAllies', P(5), true)]),
    ],
  },
};

export function buildLightCones(src, items) {
  const { srr, dm } = src;
  const out = [];
  const scripts = new Set();
  for (const [refId, spec] of Object.entries(CONES)) {
    const lc = srr.lightCones[refId];
    const rank = srr.lcRanks[refId];
    const promo = srr.lcPromotions[refId];
    checkGrowth(lc.name, promo.values, 0.15, [0, 1.2, 2.8, 4.4, 6.0, 7.6, 9.2]);
    const n = Math.max(...rank.params.map((r) => r.length));
    const params = {};
    for (let i = 0; i < n; i++) params[`p${i + 1}`] = rank.params.map((r) => r[i]);
    const json = JSON.stringify(spec);
    for (const m of json.match(/"handler":"[^"]+"/g) ?? []) scripts.add(m.slice(11, -1));
    const v0 = promo.values[0];
    const slug = slugify(lc.name);
    out.push({
      slug,
      lightCone: {
        id: `lc.${slug}`,
        name: lc.name,
        rarity: lc.rarity,
        path: PATH_MAP[lc.path],
        baseStats: { hp: v0.hp.base, atk: v0.atk.base, def: v0.def.base },
        passive: { name: rank.skill, description: toTemplate(rank.desc), modifiers: spec.modifiers ?? [], triggers: spec.triggers ?? [], params },
        ascensionCosts: promo.materials.slice(0, 6).map((step) => items.cost(step)),
        fodderExp: dm.equipment.get(refId)?.ExpProvide ?? 0,
        lore: String(lc.desc ?? '').replace(/\s+/g, ' ').trim() || lc.name,
        sources: [
          source(`${lc.name}: stats, promotions, Superimposition parameters and passive text`, `${SOURCES.starRailRes.repo}/tree/${SOURCES.starRailRes.commit}/index_new/en`),
          source(`${lc.name}: fodder EXP (EquipmentConfig.ExpProvide)`, `${SOURCES.datamine.repo}/tree/${SOURCES.datamine.commit}/ExcelOutput`),
        ],
      },
    });
  }
  return { lightCones: out, scripts };
}
