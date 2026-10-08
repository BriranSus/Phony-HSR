/**
 * Relic sets: names, piece names, bonus text and unconditional stats from the sources; conditional
 * effects are encoded here as triggers / conditional modifiers.
 */
import { advance, cond, energy, heal, mod, on, PROPERTY_MAP, slugify, status } from './builders.mjs';
import { buff } from './kits.mjs';

export const RELIC_STATUSES = [buff('relic.champion-atk', 'Champion of Streetwise Boxing', 'ATK increased for the rest of the battle (stacks).', [mod('atkPct', { param: 'atkPct' })], { maxStacks: 5, duration: { turns: 0, tickOn: 'ownerTurnEnd' } })];

/** Extra (conditional) mechanics per reference set id: [2-piece, 4-piece]. */
export const SETS = {
  101: [{}, { triggers: [on('battleStart', [{ kind: 'skillPoints', amount: 1 }])] }],
  102: [{}, { modifiers: [mod('basicDmg', 0.1)] }],
  103: [{}, { modifiers: [mod('shieldBonus', 0.2)] }],
  104: [{}, { triggers: [on('afterUseUltimate', [status('self', 'buff.crit-dmg-up', { duration: 2, params: { critDmg: 0.25 } })])] }],
  105: [{}, { triggers: ['afterAttack', 'afterBeingHit'].map((e) => on(e, [status('self', 'relic.champion-atk', { params: { atkPct: 0.05 } })])) }],
  106: [{ modifiers: [mod('dmgMitigation', 0.08)] }, { triggers: [on('turnStart', [heal('self', 'hp', 0.08), energy('self', 5)], { conditions: [cond('hpBelow', { ratio: 0.5 })] })] }],
  108: [{}, { modifiers: [mod('defIgnore', 0.1), mod('defIgnore', 0.1, { conditions: [cond('targetHasWeakness', { element: 'Quantum' })] })] }],
  109: [{}, { triggers: [on('afterUseSkill', [status('self', 'buff.atk-up', { duration: 1, params: { atkPct: 0.2 } })])] }],
  110: [{}, { triggers: [on('afterUseUltimate', [advance('self', 0.25)])] }],
  111: [{}, { triggers: [on('onWeaknessBreak', [energy('self', 3)])] }],
  114: [{}, { triggers: [on('afterUseUltimate', [status('allAllies', 'buff.spd-up', { duration: 1, params: { spdPct: 0.12 } })], { conditions: [cond('abilityTargetsAlly')] })] }],
  116: [{}, { modifiers: [mod('defIgnore', 0.06, { scaling: { per: 'targetDotCount', max: 3 } })] }],
  301: [{ modifiers: [mod('atkPct', 0.12, { conditions: [cond('statAtLeast', { stat: 'spd', value: 120 })] })] }],
  302: [{ modifiers: [mod('atkPct', 0.08, { scope: 'team', conditions: [cond('statAtLeast', { stat: 'spd', value: 120 })] })] }],
  303: [{ modifiers: [mod('atkPct', 0.25, { scaling: { per: 'stat', id: 'effectHitRate', max: 1 } })] }],
  304: [{ modifiers: [mod('defPct', 0.15, { conditions: [cond('statAtLeast', { stat: 'effectHitRate', value: 0.5 })] })] }],
  306: [{ modifiers: ['ultimateDmg', 'followUpDmg'].map((s) => mod(s, 0.15, { conditions: [cond('statAtLeast', { stat: 'critRate', value: 0.5 })] })) }],
  307: [{ modifiers: [mod('breakEffect', 0.2, { conditions: [cond('statAtLeast', { stat: 'spd', value: 145 })] })] }],
  308: [{ triggers: [on('battleStart', [advance('self', 0.4)], { conditions: [cond('statAtLeast', { stat: 'spd', value: 120 })] })] }],
  310: [{ modifiers: [mod('critDmg', 0.1, { scope: 'team', conditions: [cond('statAtLeast', { stat: 'effectRes', value: 0.3 })] })] }],
};

const CAVERN_SLOT = { HEAD: 'head', HAND: 'hands', BODY: 'body', FOOT: 'feet' };
const PLANAR_SLOT = { OBJECT: 'planarSphere', NECK: 'linkRope' };

export function buildRelicSets(src) {
  const { srr } = src;
  return Object.entries(SETS).map(([refId, extra]) => {
    const s = srr.relicSets[refId];
    const planar = refId.startsWith('3');
    const pieces = {};
    for (const r of Object.values(srr.relics)) {
      if (r.set_id !== refId || r.rarity !== 5) continue;
      const slot = (planar ? PLANAR_SLOT : CAVERN_SLOT)[r.type];
      if (slot) pieces[slot] = r.name;
    }
    const bonuses = s.desc.map((desc, i) => ({
      pieces: i === 0 ? 2 : 4,
      description: desc.replace(/\s+/g, ' ').trim(),
      modifiers: [...(s.properties[i] ?? []).map((p) => mod(PROPERTY_MAP[p.type] ?? (() => { throw new Error(`unmapped ${p.type}`); })(), p.value)), ...(extra[i]?.modifiers ?? [])],
      triggers: extra[i]?.triggers ?? [],
    }));
    return { id: `${planar ? 'planar' : 'relic'}.${slugify(s.name)}`, name: s.name, kind: planar ? 'planar' : 'cavern', pieces, bonuses };
  });
}
