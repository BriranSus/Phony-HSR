/**
 * Helpers that turn reference data into Astral Rail JSON. Kits (kits.mjs) describe only the
 * *mechanics* (which effect uses which parameter); names, descriptions, per-level numbers, Energy,
 * Skill Points and toughness all come from the sources.
 */

export const PATH_MAP = {
  Warrior: 'Destruction',
  Rogue: 'Hunt',
  Mage: 'Erudition',
  Shaman: 'Harmony',
  Warlock: 'Nihility',
  Knight: 'Preservation',
  Priest: 'Abundance',
  Memory: 'Remembrance',
};
export const ELEMENT_MAP = { Physical: 'Physical', Fire: 'Fire', Ice: 'Ice', Thunder: 'Lightning', Lightning: 'Lightning', Wind: 'Wind', Quantum: 'Quantum', Imaginary: 'Imaginary' };

/** Reference property names -> Astral Rail stat ids. */
export const PROPERTY_MAP = {
  AttackAddedRatio: 'atkPct',
  HPAddedRatio: 'hpPct',
  DefenceAddedRatio: 'defPct',
  CriticalChanceBase: 'critRate',
  CriticalDamageBase: 'critDmg',
  StatusProbabilityBase: 'effectHitRate',
  StatusResistanceBase: 'effectRes',
  SpeedDelta: 'spd',
  SpeedAddedRatio: 'spdPct',
  BreakDamageAddedRatioBase: 'breakEffect',
  HealRatioBase: 'outgoingHealing',
  SPRatioBase: 'energyRegen',
  PhysicalAddedRatio: 'physicalDmg',
  FireAddedRatio: 'fireDmg',
  IceAddedRatio: 'iceDmg',
  ThunderAddedRatio: 'lightningDmg',
  WindAddedRatio: 'windDmg',
  QuantumAddedRatio: 'quantumDmg',
  ImaginaryAddedRatio: 'imaginaryDmg',
};

export const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/['’!?.,:"]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** `{ "param": "p<n>" }` */
export const P = (n) => ({ param: `p${n}` });

/** Reference description -> template: `#3[i]%` -> `{p3}%`, markup and line breaks stripped. */
export function toTemplate(desc) {
  return String(desc ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/\\n|\n/g, ' ')
    .replace(/#(\d+)\[(?:i|f\d)\](%?)/g, (_m, n, pct) => `{p${n}}${pct}`)
    .replace(/\s+/g, ' ')
    .trim();
}

const pctText = (v) => `${Math.round(v * 1000) / 10}%`;
/** Reference description with literal values (Traces and Light Cone ranks with fixed numbers). */
export function withValues(desc, values) {
  return String(desc ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/\\n|\n/g, ' ')
    .replace(/#(\d+)\[(?:i|f\d)\](%?)/g, (_m, n, pct) => {
      const v = values[Number(n) - 1];
      if (v === undefined) throw new Error(`missing value #${n} in "${desc}"`);
      return pct ? pctText(v) : String(Math.round(v * 1000) / 1000);
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** Per-level parameter rows -> `{ p1: [...], p2: [...] }`; constant tables collapse to one value. */
export function paramTables(rows) {
  const out = {};
  const n = Math.max(0, ...rows.map((r) => r.length));
  for (let i = 0; i < n; i++) {
    const col = rows.map((r) => r[i]);
    out[`p${i + 1}`] = col.every((v) => v === col[0]) ? [col[0]] : col;
  }
  return out;
}

// ---------------------------------------------------------------- effect helpers
export const dmg = (target, multiplier, extra = {}) => ({ kind: 'damage', target, stat: 'atk', multiplier, ...extra });
export const heal = (target, stat, multiplier, flat, extra = {}) => ({ kind: 'heal', target, stat, multiplier, ...(flat !== undefined ? { flat } : {}), ...extra });
export const shield = (target, multiplier, flat, duration) => ({ kind: 'shield', target, stat: 'def', multiplier, flat, duration });
export const status = (target, statusId, extra = {}) => ({ kind: 'applyStatus', target, status: statusId, ...extra });
export const energy = (target, amount, fixed) => ({ kind: 'energy', target, amount, ...(fixed ? { fixed: true } : {}) });
export const advance = (target, fraction) => ({ kind: 'actionAdvance', target, fraction });
export const script = (handler, params) => ({ kind: 'script', handler, ...(params ? { params } : {}) });
export const insert = (action, extra = {}) => ({ kind: 'insertAction', action, ...extra });
export const on = (event, effects, extra = {}) => ({ on: event, effects, ...extra });
export const cond = (type, params) => (params ? { type, params } : { type });
export const mod = (stat, value, extra = {}) => ({ stat, value, ...extra });

/** Toughness by target from the reference stance list [main, all, adjacent]. */
function fillToughness(effects, stance) {
  return effects.map((e) => {
    if (e.kind !== 'damage' || e.toughness !== undefined) return e;
    const [main, all, adj] = stance;
    const t = e.target === 'allEnemies' ? all : e.target === 'adjacent' ? adj : main;
    return { ...e, toughness: t ?? 0 };
  });
}

/**
 * Builds abilities for one character from the sources. `natural` maps skill ids to their natural
 * max level from the Trace tree.
 */
export function abilityFactory(src, charId, natural) {
  const { srr, dm, text } = src;
  return function ability(skillId, o) {
    const servant = o.servant === true;
    let name, desc, rows, maxLevel, cfg;
    if (servant) {
      const levels = dm.servantSkillLevels(Number(skillId));
      if (!levels.length) throw new Error(`no servant skill ${skillId}`);
      cfg = levels[0];
      name = text(cfg.SkillName);
      desc = text(cfg.SkillDesc);
      rows = levels.map((l) => l.ParamList.map((p) => p.Value));
      maxLevel = o.maxLevel ?? natural[skillId] ?? 6;
    } else {
      const s = srr.skills[skillId];
      if (!s) throw new Error(`no skill ${skillId}`);
      cfg = dm.avatarSkill.get(`${Number(skillId)}:1`);
      name = s.name;
      desc = s.desc;
      rows = s.params ?? [];
      maxLevel = o.maxLevel ?? natural[skillId] ?? (o.kind === 'technique' ? 1 : s.max_level);
    }
    const stance = (cfg?.ShowStanceList ?? []).map((x) => x.Value / 3);
    const energyGain = o.energyGain ?? cfg?.SPBase?.Value ?? 0;
    const spCost = Math.max(0, cfg?.BPNeed?.Value ?? 0);
    const spGain = Math.max(0, cfg?.BPAdd?.Value ?? 0);
    const params = paramTables(rows);
    return {
      id: `${charId}.${o.id}`,
      name: o.name ?? name,
      kind: o.kind,
      tags: o.tags ?? [],
      targeting: o.targeting,
      maxLevel,
      params,
      description: o.description ?? toTemplate(desc),
      ...(spCost ? { spCost } : {}),
      ...(spGain && o.spGain !== 0 ? { spGain } : {}),
      ...(energyGain ? { energyGain } : {}),
      ...(o.kind === 'technique' ? { techniquePointCost: 1 } : {}),
      ...(o.keepsTurn ? { keepsTurn: true } : {}),
      effects: fillToughness(o.effects ?? [], stance),
      triggers: (o.triggers ?? []).map((t) => ({ ...t, effects: fillToughness(t.effects, stance) })),
      modifiers: o.modifiers ?? [],
    };
  };
}
