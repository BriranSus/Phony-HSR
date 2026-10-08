/**
 * Reference-data sources for `npm run import:reference`.
 *
 * Both repositories are pinned to the commits the shipped data was generated from, so a re-import is
 * reproducible. Files are cached under `.cache/reference-data/` (git-ignored).
 *
 * - StarRailRes (Mar-7th): structured English game data - names, per-level ability parameters,
 *   promotions, Eidolons, Traces, Light Cones, relic sets and items.
 * - TurnBasedGameData (DimbreathBot): the raw datamine "ExcelOutput" tables - Energy (`SPBase`),
 *   Skill Point cost/gain (`BPNeed`/`BPAdd`), toughness (`ShowStanceList`, stance / 3 = toughness),
 *   memosprite skills, enemies, enemy level curves, and the English text map.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const SOURCES = {
  starRailRes: {
    name: 'StarRailRes (Mar-7th), index_new/en',
    repo: 'https://github.com/Mar-7th/StarRailRes',
    commit: 'dbe8cdfcfb0bf657b9fe1cf92d5537f118ccb487',
    raw: (file) => `https://raw.githubusercontent.com/Mar-7th/StarRailRes/dbe8cdfcfb0bf657b9fe1cf92d5537f118ccb487/index_new/en/${file}.json`,
  },
  datamine: {
    name: 'TurnBasedGameData (DimbreathBot), ExcelOutput + TextMapEN',
    repo: 'https://github.com/DimbreathBot/TurnBasedGameData',
    commit: '724b139d8c9c32d12552eb95745a4fee72bfe48b',
    raw: (file) => `https://raw.githubusercontent.com/DimbreathBot/TurnBasedGameData/724b139d8c9c32d12552eb95745a4fee72bfe48b/${file}.json`,
  },
  wiki: {
    name: 'Honkai: Star Rail Wiki (Fandom), MediaWiki API',
    repo: 'https://honkai-star-rail.fandom.com',
  },
};

/** Date the pinned sources were read for the shipped data. */
export const RETRIEVED = '2026-10-08';

export function source(topic, url) {
  return { topic, url, retrieved: RETRIEVED };
}

async function cached(cacheDir, key, url) {
  const file = path.join(cacheDir, key.replace(/[/\\]/g, '_') + '.json');
  if (!existsSync(file)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    await mkdir(cacheDir, { recursive: true });
    await writeFile(file, await res.text());
  }
  // 64-bit text hashes do not fit a double: keep them as strings.
  return JSON.parse((await readFile(file, 'utf8')).replace(/"Hash":\s*(-?\d+)/g, '"Hash":"$1"'));
}

const asArray = (x) => (Array.isArray(x) ? x : Object.values(x));

export async function loadSources(root) {
  const cacheDir = path.join(root, '.cache', 'reference-data');
  const srr = (f) => cached(cacheDir, 'srr-' + f, SOURCES.starRailRes.raw(f));
  const dm = async (f) => asArray(await cached(cacheDir, 'dm-' + f, SOURCES.datamine.raw('ExcelOutput/' + f)));
  const [characters, promotions, skills, ranks, trees, lightCones, lcPromotions, lcRanks, relicSets, relics, items] = await Promise.all(
    ['characters', 'character_promotions', 'character_skills', 'character_ranks', 'character_skill_trees', 'light_cones', 'light_cone_promotions', 'light_cone_ranks', 'relic_sets', 'relics', 'items'].map(srr),
  );
  const [avatarSkills, servantSkills, servants, atlas, itemConfig, avatarExp, equipmentExp, relicExp, monsterCamps, monsters, monsterTemplates, monsterSkills, eliteGroups, hardLevels, equipment, stories, camps] = await Promise.all(
    ['AvatarSkillConfig', 'AvatarServantSkillConfig', 'AvatarServantConfig', 'AvatarAtlas', 'ItemConfig', 'AvatarExpItemConfig', 'EquipmentExpItemConfig', 'RelicExpItem', 'MonsterCamp', 'MonsterConfig', 'MonsterTemplateConfig', 'MonsterSkillConfig', 'EliteGroup', 'HardLevelGroup', 'EquipmentConfig', 'StoryAtlas', 'AvatarCamp'].map(dm),
  );
  const textMap = await cached(cacheDir, 'dm-TextMapEN', SOURCES.datamine.raw('TextMap/TextMapEN'));
  const text = (h) => (h ? textMap[typeof h === 'object' ? h.Hash : h] : undefined);
  const byKey = (list, ...keys) => new Map(list.map((x) => [keys.map((k) => x[k]).join(':'), x]));
  return {
    srr: { characters, promotions, skills, ranks, trees, lightCones, lcPromotions, lcRanks, relicSets, relics, items },
    dm: {
      avatarSkill: byKey(avatarSkills, 'SkillID', 'Level'),
      servantSkill: byKey(servantSkills, 'SkillID', 'Level'),
      servantSkillLevels: (id) => servantSkills.filter((s) => s.SkillID === id).sort((a, b) => a.Level - b.Level),
      servants: byKey(servants, 'ServantID'),
      monster: byKey(monsters, 'MonsterID'),
      monsterTemplate: byKey(monsterTemplates, 'MonsterTemplateID'),
      monsterSkill: byKey(monsterSkills, 'SkillID'),
      eliteGroup: byKey(eliteGroups, 'EliteGroup'),
      hardLevels: hardLevels.filter((h) => h.HardLevelGroup === 1).sort((a, b) => a.Level - b.Level),
      equipment: byKey(equipment, 'EquipmentID'),
      stories,
      camps: byKey(camps, 'ID'),
      monsterCamps: byKey(monsterCamps, 'ID'),
      item: byKey(itemConfig, 'ID'),
      itemExp: new Map([...avatarExp.map((x) => [String(x.ItemID), x.Exp]), ...equipmentExp.map((x) => [String(x.ItemID), x.ExpProvide]), ...relicExp.map((x) => [String(x.ItemID), x.ExpProvide])]),
    },
    atlas: byKey(atlas, 'AvatarID'),
    text,
  };
}
