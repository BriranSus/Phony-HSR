/**
 * Enemies from the raw datamine (MonsterConfig / MonsterTemplateConfig / MonsterSkillConfig /
 * EliteGroup). Stats, weaknesses, RES, debuff RES, toughness (stance / 3), skill names, text,
 * multipliers (`ParamList`) and energy are read from the sources. The specs below say what each
 * parameter does; the parameter meanings were cross-checked against the HSR wiki's enemy pages.
 */
import { ELEMENT_MAP, on, script, slugify, status } from './builders.mjs';
import { buff } from './kits.mjs';
import { source, SOURCES } from './sources.mjs';

export const ENEMY_STATUSES = [
  {
    id: 'enemy.shock',
    name: 'Shock',
    description: 'Takes Lightning DoT at the start of each turn.',
    kind: 'debuff',
    category: 'dot',
    dispellable: true,
    duration: { turns: 2, tickOn: 'ownerTurnStart' },
    dot: { element: 'Lightning', formula: 'attackerScaled', stat: 'atk', multiplier: { param: 'multiplier' } },
  },
  {
    id: 'enemy.wind-shear',
    name: 'Wind Shear',
    description: 'Takes Wind DoT per stack at the start of each turn.',
    kind: 'debuff',
    category: 'dot',
    dispellable: true,
    maxStacks: 5,
    duration: { turns: 3, tickOn: 'ownerTurnStart' },
    dot: { element: 'Wind', formula: 'attackerScaled', stat: 'atk', multiplier: { param: 'multiplier' }, perStack: true },
  },
  {
    id: 'enemy.entanglement',
    name: 'Entanglement',
    description: 'Action delayed; takes Quantum Additional DMG per stack when the effect ends.',
    kind: 'debuff',
    category: 'cc',
    dispellable: true,
    maxStacks: 5,
    duration: { turns: 1, tickOn: 'ownerTurnStart' },
    cc: { type: 'entanglement', skipsTurn: false, delayOnApply: { param: 'delay' } },
    dot: { element: 'Quantum', formula: 'attackerScaled', stat: 'atk', multiplier: { param: 'multiplier' }, perStack: true, damageType: 'additional', tickOn: 'onExpire' },
  },
  {
    id: 'enemy.freeze',
    name: 'Frozen',
    description: 'Cannot take action; takes Ice DMG when the effect ends.',
    kind: 'debuff',
    category: 'cc',
    dispellable: true,
    duration: { turns: 1, tickOn: 'ownerTurnStart' },
    cc: { type: 'freeze', skipsTurn: true },
    dot: { element: 'Ice', formula: 'attackerScaled', stat: 'atk', multiplier: { param: 'multiplier' }, damageType: 'additional', tickOn: 'onExpire' },
  },
  {
    id: 'enemy.imprisonment',
    name: 'Imprisoned',
    description: 'Action delayed.',
    kind: 'debuff',
    category: 'cc',
    dispellable: true,
    duration: { turns: 1, tickOn: 'ownerTurnStart' },
    cc: { type: 'imprisonment', skipsTurn: false, delayOnApply: { param: 'delay' } },
  },
  { id: 'enemy.barrier', name: 'Barrier', description: 'Nullifies all DMG received except DoT until after being attacked.', kind: 'buff', category: 'shield', dispellable: true, duration: { turns: 0, tickOn: 'ownerTurnEnd' }, script: 'enemy.barrier' },
  { id: 'enemy.lock-on', name: 'Locked On', description: 'The enemy will focus its next attack on this target.', kind: 'debuff', category: 'mark', dispellable: false, duration: { turns: 1, tickOn: 'casterTurnEnd' } },
  buff('enemy.charging', 'Charging', 'Charging a powerful attack; DMG dealt increased.', [{ stat: 'allDmg', value: { param: 'allDmg' } }], { dispellable: false }),
  buff('enemy.counter-stance', 'Shield Reflect', 'When attacked by a single character, acts immediately and casts "Pierce" on the attacker.', [], {
    dispellable: false,
    triggers: [on('afterBeingHit', [{ kind: 'insertAction', action: 'counter', ability: 'silvermane-lieutenant.pierce', target: 'attacker' }])],
  }),
  buff('enemy.rejuvenate', 'Rebirth', 'Upon receiving a killing blow, restores HP. Can be dispelled.', [], {
    duration: { turns: 0, tickOn: 'ownerTurnEnd' },
    triggers: [on('beforeKnockedDown', [{ kind: 'revive', target: 'self', ratio: { param: 'ratio' } }], { limitPerBattle: 1 })],
  }),
  buff('enemy.creators-resolve', "Creator's Resolve", 'SPD increased; attacks deal Imaginary DMG.', [{ stat: 'spd', value: { param: 'spd' } }], { dispellable: false, duration: { turns: 0, tickOn: 'ownerTurnEnd' } }),
  { id: 'enemy.weakness-protected', name: 'Weakness Protected', description: "(Unremovable) Toughness cannot be reduced while the boss's summons are on the field.", kind: 'buff', category: 'other', dispellable: false, duration: { turns: 0, tickOn: 'ownerTurnEnd' }, toughnessProtection: 'whileSummonsOnField' },
];

// Spec helpers: `p` is the datamine ParamList of the skill (0-based).
const hit = (target, m, el) => ({ kind: 'damage', target, stat: 'atk', multiplier: m, element: el, toughness: 0 });
const targeting = { 'Single Target': 'enemySingle', Blast: 'enemyBlast', 'AoE ATK': 'enemyAll', Summon: 'none', Impair: 'enemyAll', Charging: 'self', 'Lock On': 'enemySingle', Support: 'allySingle', Talent: 'none', Others: 'self' };
const tagOf = { 'Single Target': ['singleTarget'], Blast: ['blast'], 'AoE ATK': ['aoe'], Summon: ['summon'], Impair: ['impair'], Charging: ['enhance'], 'Lock On': ['impair'], Support: ['support'], Talent: ['enhance'], Others: ['defense'] };

/** Default damage effects by skill tag. */
function defaultEffects(tag, p, el) {
  if (tag === 'Single Target') return [hit('primary', p[0], el)];
  if (tag === 'Blast') return [hit('primary', p[0], el), hit('adjacent', p[0], el)];
  if (tag === 'AoE ATK') return [hit('allEnemies', p[0], el)];
  return [];
}

export const ENEMIES = [
  { id: 8012010, slug: 'voidranger-reaver' },
  {
    id: 1002040,
    slug: 'silvermane-soldier',
    skills: { 100204001: { effects: (p, el) => [hit('primary', p[0], el), status('primary', 'debuff.def-down', { baseChance: 1, duration: p[2], params: { defDown: p[1] } })] } },
  },
  { id: 8001020, slug: 'frostspawn' },
  { id: 8001010, slug: 'flamespawn' },
  { id: 8001040, slug: 'thunderspawn', skills: { 800104001: { effects: (p, el) => [hit('primary', p[0], el), status('primary', 'enemy.shock', { baseChance: p[1], duration: p[2], params: { multiplier: p[3] } })] } } },
  { id: 1012030, slug: 'automaton-beetle', skills: { 101203001: { effects: (p, el) => [hit('primary', p[0], el), status('self', 'enemy.barrier')] } } },
  { id: 1002020, slug: 'vagrant', skills: { 100202002: { effects: (p) => [status('randomAlly', 'buff.atk-up', { duration: p[2], params: { atkPct: p[0] } }), { kind: 'actionAdvance', target: 'randomAlly', fraction: 1 }] } } },
  {
    id: 2022010,
    slug: 'mara-struck-soldier',
    skills: {
      202201001: { effects: (p, el) => [hit('primary', p[0], el), status('primary', 'enemy.wind-shear', { baseChance: p[4], stacks: p[1], duration: p[2], params: { multiplier: p[3] } })] },
      202201002: { triggers: (p) => [on('battleStart', [status('self', 'enemy.rejuvenate', { params: { ratio: p[0] } })])] },
      202201003: { skip: true },
    },
  },
  {
    id: 1012021,
    slug: 'automaton-spider',
    faction: 'Jarilo-VI',
    skills: {
      101202102: { skip: true },
      101202103: { chargeTurns: 1, effects: (p, el) => [hit('primary', p[0], el), hit('adjacent', p[0], el), script('enemy.self-destruct')] },
      101202104: { triggers: (p) => [on('beforeKnockedDown', [script('enemy.automaton-spider.chains-of-destruction', { hpRatio: p[0], toughness: 20 })])] },
    },
  },
  {
    id: 1013010,
    slug: 'automaton-grizzly',
    skills: {
      101301001: { effects: () => [{ kind: 'summon', unit: 'enemy.automaton-spider', unitType: 'enemy' }, { kind: 'summon', unit: 'enemy.automaton-spider', unitType: 'enemy' }] },
      101301002: { effects: (p) => [status('allEnemies', 'cc.reference-taunt', { baseChance: p[2], duration: p[1] })] },
      101301003: { effects: (p) => [status('self', 'enemy.charging', { duration: 1, params: { allDmg: p[0] } })] },
      101301004: { chargeTurns: 1 },
      101301005: { skip: true },
    },
  },
  {
    id: 8013010,
    slug: 'voidranger-trampler',
    skills: {
      801301004: { effects: () => [status('primary', 'enemy.lock-on')] },
      801301005: { effects: (p, el) => [hit('primary', p[0], el), status('primary', 'enemy.entanglement', { baseChance: 1, duration: 1, params: { delay: p[1], multiplier: p[2] } })] },
    },
  },
  {
    id: 1003010,
    slug: 'silvermane-lieutenant',
    skills: {
      100301003: { effects: () => [status('self', 'enemy.counter-stance')] },
      100301004: { effects: () => [{ kind: 'summon', unit: 'enemy.silvermane-soldier', unitType: 'enemy' }] },
    },
  },
  { id: 1002017, slug: 'lance-of-the-eternal-freeze-a', faction: 'Jarilo-VI', skills: { 100201702: { effects: () => [status('primary', 'enemy.lock-on'), script('enemy.lance.subzero-pursuit')] } } },
  { id: 1002018, slug: 'lance-of-the-eternal-freeze-b', faction: 'Jarilo-VI', skills: { 100201802: { effects: () => [status('primary', 'enemy.lock-on'), script('enemy.lance.subzero-pursuit')] } } },
  {
    id: 1005012,
    slug: 'cocolia-mother-of-deception',
    rank: 'weeklyBoss',
    skills: {
      100501202: { effects: (p, el) => [hit('primary', p[0], el), status('primary', 'enemy.freeze', { baseChance: 1, duration: 1, params: { multiplier: 1 } })] },
      100501204: { effects: () => [{ kind: 'summon', unit: 'enemy.lance-of-the-eternal-freeze-a', unitType: 'enemy' }, { kind: 'summon', unit: 'enemy.lance-of-the-eternal-freeze-b', unitType: 'enemy' }] },
      100501205: { effects: (p, el) => [hit('primary', p[0], el), status('primary', 'enemy.imprisonment', { baseChance: p[1], duration: 1, params: { delay: p[2] } })] },
      100501206: { effects: () => [status('self', 'enemy.charging', { duration: 1, params: { allDmg: 0 } })] },
      100501207: { chargeTurns: 1 },
      100501208: { effects: () => [status('primary', 'enemy.lock-on')] },
      100501209: { effects: () => [script('enemy.cocolia.harbingers-resolve')], aiWeight: 0 },
      100501210: { aiWeight: 0 },
    },
    phases: (abilityIdsByPhase) => [
      { id: 'phase-1', hpThreshold: 1, abilities: abilityIdsByPhase(1), onEnter: [status('self', 'enemy.weakness-protected')] },
      {
        id: 'phase-2',
        hpThreshold: 0,
        // Wiki: in phase 2 Cocolia's Max HP is reduced by 25%, so the new bar starts at 75%.
        restoreHpTo: 0.75,
        // Phase-2 toughness from the wiki infobox ("180 (Phase 1) / 160 (Phase 2)").
        toughness: 160,
        abilities: abilityIdsByPhase(2),
        onEnter: [status('self', 'enemy.creators-resolve', { params: { spd: 40 } }), { kind: 'removeStatus', target: 'self', status: 'enemy.weakness-protected' }],
      },
    ],
  },
];

const DEBUFF_RES = { STAT_CTRL_Frozen: 'freeze', STAT_Confine: 'imprisonment', STAT_Entangle: 'entanglement', STAT_DOT_Burn: 'burn', STAT_DOT_Electric: 'shock', STAT_DOT_Bleed: 'bleed', STAT_DOT_Poison: 'windShear' };
const RANK = { Minion: 'normal', MinionLv2: 'normal', Elite: 'elite', LittleBoss: 'boss', BigBoss: 'boss' };

export function buildEnemies(src, campName) {
  const { dm, text } = src;
  const statuses = new Set();
  const scripts = new Set();
  const out = ENEMIES.map((spec) => {
    const m = dm.monster.get(String(spec.id));
    const t = dm.monsterTemplate.get(String(m.MonsterTemplateID));
    const e = dm.eliteGroup.get(String(m.EliteGroup));
    const id = `enemy.${spec.slug}`;
    const abilities = [];
    const phaseOf = {};
    for (const sid of m.SkillList) {
      const s = dm.monsterSkill.get(String(sid));
      const sp = spec.skills?.[sid] ?? {};
      if (!s || sp.skip || !text(s.SkillName)) continue;
      const tag = text(s.SkillTag) ?? 'Others';
      const p = (s.ParamList ?? []).map((x) => x.Value);
      const el = ELEMENT_MAP[s.DamageType];
      const effects = sp.effects ? sp.effects(p, el) : defaultEffects(tag, p, el);
      const abilityId = `${spec.slug}.${slugify(text(s.SkillName))}`;
      if (abilities.some((a) => a.id === abilityId)) continue;
      phaseOf[abilityId] = s.PhaseList ?? [];
      const triggers = sp.triggers ? sp.triggers(p) : [];
      const desc = String(text(s.SkillDesc)).replace(/<[^>]+>/g, '').replace(/\\n|\n/g, ' ').trim();
      for (const h of JSON.stringify([effects, triggers]).match(/"handler":"[^"]+"/g) ?? []) scripts.add(h.slice(11, -1));
      for (const st of JSON.stringify([effects, triggers]).match(/"status":"[^"]+"/g) ?? []) statuses.add(st.slice(10, -1));
      if (sp.script) scripts.add(sp.script);
      abilities.push({
        id: abilityId,
        name: text(s.SkillName),
        kind: 'enemy',
        tags: tagOf[tag] ?? [],
        targeting: targeting[tag] ?? 'none',
        maxLevel: 1,
        description: desc || text(s.SkillName),
        effects: sp.script ? [script(sp.script)] : effects,
        triggers,
        energyToTarget: s.SPHitBase?.Value ?? 0,
        aiWeight: sp.aiWeight ?? (tag === 'Talent' ? 0 : 1),
        ...(sp.chargeTurns ? { chargeTurns: sp.chargeTurns } : {}),
      });
    }
    const resistances = {};
    for (const r of m.DamageTypeResistance) resistances[ELEMENT_MAP[r.DamageType]] = r.Value.Value;
    for (const w of m.StanceWeakList) delete resistances[ELEMENT_MAP[w]];
    const debuffRes = {};
    for (const d of m.DebuffResist) if (DEBUFF_RES[d.Key]) debuffRes[DEBUFF_RES[d.Key]] = d.Value.Value;
    const rank = spec.rank ?? RANK[t.Rank] ?? 'normal';
    const byPhase = (n) => abilities.filter((a) => a.aiWeight > 0 && (phaseOf[a.id].length === 0 || phaseOf[a.id].includes(n))).map((a) => a.id);
    const enemy = {
      id,
      name: text(m.MonsterName),
      rank,
      // Variant templates without a camp inherit their template group's; summons without either use the wiki faction.
      faction: spec.faction ?? campName(t.MonsterCampID ?? dm.monsterTemplate.get(String(t.TemplateGroupID))?.MonsterCampID),
      baseStats: {
        hp: round(t.HPBase.Value * m.HPModifyRatio.Value * e.HPRatio.Value),
        atk: round(t.AttackBase.Value * m.AttackModifyRatio.Value * e.AttackRatio.Value),
        spd: round(t.SpeedBase.Value * m.SpeedModifyRatio.Value * e.SpeedRatio.Value),
        effectRes: t.StatusResistanceBase?.Value ?? 0,
      },
      toughness: round((t.StanceBase.Value * m.StanceModifyRatio.Value * e.StanceRatio.Value) / 3),
      weaknesses: m.StanceWeakList.map((w) => ELEMENT_MAP[w]),
      resistances,
      debuffRes,
      abilities,
      ai: { pattern: 'weighted' },
      phases: spec.phases ? spec.phases(byPhase) : rank === 'normal' || rank === 'elite' ? [] : [{ id: 'phase-1', hpThreshold: 1, abilities: byPhase(1) }],
      description: String(text(m.MonsterIntroduction) ?? '').replace(/\\n|\n/g, ' ').trim() || undefined,
      presentation: { model: `proc.enemy.${spec.slug}`, scale: rank === 'normal' ? 1 : rank === 'elite' ? 1.5 : 2.4, bossBar: rank !== 'normal' && rank !== 'elite' },
      sources: [source(`${text(m.MonsterName)}: MonsterConfig ${spec.id}, MonsterTemplateConfig ${m.MonsterTemplateID}, MonsterSkillConfig, EliteGroup ${m.EliteGroup}`, `${SOURCES.datamine.repo}/tree/${SOURCES.datamine.commit}/ExcelOutput`)],
    };
    if (spec.slug.startsWith('cocolia')) enemy.sources.push(source('Cocolia, Mother of Deception: phase-2 toughness 160, phase-2 HP at 75% (Max HP -25%), skill parameter meanings', 'https://honkai-star-rail.fandom.com/wiki/Cocolia,_Mother_of_Deception'));
    if (enemy.phases.length) for (const ph of enemy.phases) for (const st of JSON.stringify(ph).match(/"status":"[^"]+"/g) ?? []) statuses.add(st.slice(10, -1));
    return { slug: spec.slug, enemy };
  });
  return { enemies: out, statuses, scripts };
}

const round = (v) => Math.round(v * 10000) / 10000;
