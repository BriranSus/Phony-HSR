/**
 * Assembles full Character records: base stats and promotion costs, abilities (kits.mjs), the
 * Trace tree, Eidolons, memosprites/summons, lore and per-node Trace cost tables.
 */
import { abilityFactory, ELEMENT_MAP, PATH_MAP, PROPERTY_MAP, slugify, withValues } from './builders.mjs';
import { source, SOURCES } from './sources.mjs';

const SLOT_BY_SUFFIX = { '01': 'basic', '02': 'skill', '03': 'ultimate', '04': 'talent', '07': 'technique' };
const ELEMENT_COLOR = { Physical: '#c9ccd4', Fire: '#f0603a', Ice: '#6fd0f0', Lightning: '#c46cf0', Wind: '#5fd6a0', Quantum: '#6a6ff0', Imaginary: '#f0d25a' };

/** Character / Light Cone growth must match the reference promotion tables exactly. */
export function checkGrowth(label, values, levelGrowth, ascensionBonus) {
  const b = values[0];
  for (const stat of ['hp', 'atk', 'def']) {
    const base = b[stat].base;
    values.forEach((phase, asc) => {
      const expectBase = base * (1 + ascensionBonus[asc]);
      const expectStep = base * levelGrowth;
      if (Math.abs(phase[stat].base - expectBase) > 1e-6 || Math.abs(phase[stat].step - expectStep) > 1e-6) {
        throw new Error(`${label} ${stat} A${asc}: reference ${phase[stat].base}+${phase[stat].step}/lv, formula ${expectBase}+${expectStep}/lv`);
      }
    });
  }
}

export function buildCharacters(src, kits, items, costTables) {
  const { srr, dm, text } = src;
  const out = [];
  const statuses = [];
  const scripts = new Set();
  for (const spec of kits) {
    const c = srr.characters[spec.srrId];
    const slug = spec.slug;
    const id = `char.${slug}`;
    const name = spec.name ?? c.name;
    // Base kit only: 7-digit tree ids (8-digit ids starting with 1 are later "enhanced" variants).
    const treeIds = c.skill_trees.filter((t) => t.length === spec.srrId.length + 3);
    // Natural max levels from the Trace tree (ability nodes).
    const natural = {};
    for (const t of treeIds) {
      const n = srr.trees[t];
      for (const s of n.level_up_skills) natural[s.id] = n.max_level;
    }
    const ability = abilityFactory(src, slug, natural);
    const talentId = `${spec.srrId}04`;
    ability.talentTable = (n) => srr.skills[talentId].params.map((r) => r[n - 1]);
    const kit = spec.kit(ability, slug);
    statuses.push(...(kit.statuses ?? []));

    // ---- stats & promotion
    const promo = srr.promotions[spec.srrId];
    checkGrowth(name, promo.values, 0.05, [0, 0.4, 0.8, 1.2, 1.6, 2.0, 2.4]);
    const v0 = promo.values[0];
    const ascensionCosts = promo.materials.slice(0, 6).map((step) => items.cost(step));

    // ---- traces
    const traces = [];
      for (const t of treeIds) {
      const n = srr.trees[t];
      const l0 = n.levels[0];
      const nodeId = `${slug}.t${t.slice(spec.srrId.length)}`;
      const requirements = {};
      if (l0.promotion) requirements.ascension = l0.promotion;
      if (l0.level) requirements.level = l0.level;
      const costId = `trace-cost.${slug}.${t}`;
      const parent = n.pre_points.find((p) => treeIds.includes(p));
      const common = { id: nodeId, ...(parent ? { parent: `${slug}.t${parent.slice(spec.srrId.length)}` } : {}), requirements, costTable: costId };
      if (n.level_up_skills.length && !n.desc) {
        const sid = n.level_up_skills[0].id;
        let slot = SLOT_BY_SUFFIX[sid.slice(-2)];
        if (spec.srrId === '8008' && t === '8008301') slot = 'memospriteSkill';
        if (spec.srrId === '8008' && t === '8008302') slot = 'memospriteTalent';
        if (!slot || slot === 'technique') continue;
        const steps = n.levels.slice(1).map((l) => items.cost(l.materials));
        costTables.push({ id: costId, description: `${name}: ${n.name || slot} levels 2..${n.max_level}`, steps });
        const abilityName = n.name || (slot === 'basic' || slot === 'skill' || slot === 'ultimate' || slot === 'talent' ? kit.abilities[slot].name : slot);
        traces.push({ ...common, kind: 'ability', name: abilityName, ability: slot });
      } else if (l0.properties.length) {
        const p = l0.properties[0];
        const stat = PROPERTY_MAP[p.type];
        if (!stat) throw new Error(`unmapped property ${p.type}`);
        costTables.push({ id: costId, description: `${name}: ${n.name}`, steps: [items.cost(l0.materials)] });
        traces.push({ ...common, kind: 'stat', name: n.name, stat: { stat, value: p.value } });
      } else if (n.desc || n.name) {
        const m = kit.majors?.[Number(t.slice(spec.srrId.length))];
        if (!m) throw new Error(`${name}: no kit for major trace ${t} (${n.name})`);
        if (m.script) scripts.add(m.script);
        costTables.push({ id: costId, description: `${name}: ${n.name}`, steps: [items.cost(l0.materials)] });
        traces.push({
          ...common,
          kind: 'major',
          name: n.name,
          passive: { description: withValues(n.desc, n.params?.[0] ?? []), modifiers: m.modifiers ?? [], triggers: m.triggers ?? [], ...(m.script ? { script: m.script } : {}) },
        });
      }
    }
    // Drop parents that point to skipped nodes (e.g. Technique nodes).
    const ids = new Set(traces.map((t) => t.id));
    for (const t of traces) if (t.parent && !ids.has(t.parent)) delete t.parent;

    // ---- eidolons
    const eidolons = c.ranks.map((rid) => {
      const r = srr.ranks[rid];
      const k = kit.eidolons?.[r.rank] ?? {};
      const bonus = {};
      for (const s of r.level_up_skills) {
        let slot = SLOT_BY_SUFFIX[s.id.slice(-2)];
        if (s.id.length === 7) slot = s.id.slice(-2) === '01' || s.id.slice(-2) === '07' ? 'memospriteSkill' : 'memospriteTalent';
        if (s.id === `${spec.srrId}08`) continue; // enhanced Basic ATK levels with Basic ATK
        if (slot && slot !== 'technique') bonus[slot] = s.num;
      }
      if (k.script) scripts.add(k.script);
      return {
        rank: r.rank,
        name: r.name,
        description: withValues(r.desc, []),
        ...(Object.keys(bonus).length ? { abilityLevelBonus: bonus } : {}),
        modifiers: k.modifiers ?? [],
        triggers: k.triggers ?? [],
        ...(k.script ? { script: k.script } : {}),
      };
    });

    // ---- items: eidolon item (named "<Character>'s Eidolon")
    const eidolonItem = items.add(srr.ranks[c.ranks[0]].materials[0].id, { category: 'eidolon', name: `${name}'s Eidolon` });

    // ---- lore
    const story = dm.stories.find((st) => st.AvatarID === Number(spec.srrId) && st.StoryID === 1);
    const bio = (text(story?.Story) ?? '').replace(/\\n|\n/g, ' ').split(/(?<=\.)\s/)[0] || `${name}.`;
    const camp = text(dm.camps.get(String(src.atlas.get(spec.srrId)?.CampID ?? ''))?.Name) ?? 'Astral Express';
    const element = ELEMENT_MAP[c.element];
    const kitScripts = JSON.stringify(kit).match(/"handler":"[^"]+"/g) ?? [];
    for (const h of kitScripts) scripts.add(h.slice(11, -1));
    for (const st of kit.statuses ?? []) if (st.script) scripts.add(st.script);

    const character = {
      id,
      name,
      rarity: c.rarity,
      element,
      path: PATH_MAP[c.path],
      ultimateResource: { kind: 'energy', max: c.max_sp ?? 160 },
      baseStats: { hp: v0.hp.base, atk: v0.atk.base, def: v0.def.base, spd: v0.spd.base, critRate: v0.crit_rate.base, critDmg: v0.crit_dmg.base, aggro: v0.taunt.base },
      abilities: {
        basic: kit.abilities.basic,
        skill: kit.abilities.skill,
        ultimate: kit.abilities.ultimate,
        talent: kit.abilities.talent,
        technique: kit.abilities.technique,
        extra: kit.abilities.extra ?? [],
      },
      ...(kit.memosprite ? { memosprite: kit.memosprite } : {}),
      ...(kit.summons?.length ? { summons: kit.summons } : {}),
      ...(kit.resources?.length ? { resources: kit.resources } : {}),
      traces,
      eidolons,
      ascensionCosts,
      eidolonItem,
      presentation: { model: `proc.humanoid.${slug}`, portraitColor: ELEMENT_COLOR[element], voice: {} },
      lore: { title: camp, faction: camp, bio },
      sources: [
        source(`${name}: names, descriptions, per-level ability parameters, promotions, Traces, Eidolons`, `${SOURCES.starRailRes.repo}/tree/${SOURCES.starRailRes.commit}/index_new/en`),
        source(`${name}: Energy, Skill Points and toughness per ability (AvatarSkillConfig${spec.srrId === '8008' ? ', AvatarServantSkillConfig' : ''})`, `${SOURCES.datamine.repo}/tree/${SOURCES.datamine.commit}/ExcelOutput`),
      ],
    };
    out.push({ slug, srrId: spec.srrId, character });
  }
  return { characters: out, statuses, scripts };
}

export { slugify };
