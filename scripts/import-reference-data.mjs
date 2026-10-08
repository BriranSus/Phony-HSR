/**
 * Regenerates the reference content in src/data from pinned datamined sources:
 *
 *   npm run import:reference
 *
 * Writes characters, Light Cones, enemies, relic sets, items, Trace cost tables, kit statuses,
 * banners, loot tables and the enemy level curve. Source files are cached under
 * .cache/reference-data/. Kit mechanics live in scripts/reference-data/*.mjs; every number comes
 * from the sources (see docs/DATA_SOURCES.md).
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSources, source, SOURCES } from './reference-data/sources.mjs';
import { itemRegistry } from './reference-data/items.mjs';
import { KITS, SHARED_STATUSES } from './reference-data/kits.mjs';
import { buildCharacters } from './reference-data/characters.mjs';
import { buildLightCones, LIGHT_CONE_STATUSES } from './reference-data/lightcones.mjs';
import { buildRelicSets, RELIC_STATUSES } from './reference-data/relics.mjs';
import { buildEnemies, ENEMY_STATUSES } from './reference-data/enemies.mjs';
import { slugify } from './reference-data/builders.mjs';
import { SCRIPT_HANDLERS } from './reference-data/handlers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = path.join(root, 'src', 'data');

/** Compact JSON: objects/arrays that fit on one line stay on one line. */
function fmt(v, ind = '') {
  const flat = JSON.stringify(v, null, 1).replace(/\n\s*/g, ' ').replace(/\[ /g, '[').replace(/ \]/g, ']');
  if (typeof v !== 'object' || v === null || flat.length + ind.length <= 120) return flat;
  const next = ind + '  ';
  if (Array.isArray(v)) return '[\n' + v.map((x) => next + fmt(x, next)).join(',\n') + '\n' + ind + ']';
  const entries = Object.entries(v).filter(([, x]) => x !== undefined);
  return '{\n' + entries.map(([k, x]) => next + JSON.stringify(k) + ': ' + fmt(x, next)).join(',\n') + '\n' + ind + '}';
}
async function write(rel, value) {
  const file = path.join(data, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, fmt(value) + '\n');
}
async function clearDir(rel) {
  const dir = path.join(data, rel);
  for (const f of await readdir(dir).catch(() => [])) if (f.endsWith('.json')) await rm(path.join(dir, f));
}

const src = await loadSources(root);
const items = itemRegistry(src);
const costTables = [];

// Base items (currencies, passes, EXP materials) - always present.
for (const id of [2, 1, 3, 11, 101, 102, 251, 252, 211, 212, 213, 221, 222, 223, 231, 232, 233]) items.add(id);

const chars = buildCharacters(src, KITS, items, costTables);
const cones = buildLightCones(src, items);
const sets = buildRelicSets(src);
const campName = (id) => src.text(src.dm.monsterCamps.get(String(id))?.Name) ?? 'Unknown';
const foes = buildEnemies(src, campName);

// ---- characters / light cones / enemies
await clearDir('characters');
for (const c of chars.characters) await write(`characters/${c.slug}.json`, c.character);
await clearDir('light-cones');
for (const l of cones.lightCones) await write(`light-cones/${l.slug}.json`, l.lightCone);

// Loot tables per enemy faction: 2-star common drops whose reference "come_from" names the faction.
const loot = new Map();
for (const e of foes.enemies) {
  const faction = e.enemy.faction;
  const drops = Object.values(src.srr.items).filter((i) => i.sub_type === 'CommonMonsterDrop' && i.rarity === 2 && (i.come_from ?? []).includes(faction));
  if (!drops.length) continue;
  const id = `loot.${slugify(faction)}`;
  if (!loot.has(id)) {
    loot.set(id, {
      id,
      entries: [
        { item: 'credit', min: 1, max: 1, chance: 1 },
        ...drops.map((d) => ({ item: items.add(d.id), min: 1, max: 1, chance: 1 })),
      ],
    });
  }
  e.enemy.lootTable = id;
}
await clearDir('enemies');
for (const e of foes.enemies) await write(`enemies/${e.slug}.json`, e.enemy);
await clearDir('loot-tables');
await write('loot-tables/loot.json', [...loot.values()]);

// ---- relics
await write('relics/sets/sets.json', sets);

// ---- statuses (kits + Light Cones + relics + enemies + shared). Break statuses stay in weakness-break.json.
const statuses = [...SHARED_STATUSES, ...chars.statuses, ...LIGHT_CONE_STATUSES, ...RELIC_STATUSES, ...ENEMY_STATUSES];
await rm(path.join(data, 'status-effects', 'common.json'), { force: true });
await write('status-effects/kits.json', statuses);

// ---- banners (featured units from the roster)
await clearDir('banners');
const pull = { item: 'star-rail-special-pass', count: 1 };
await write('banners/butterfly-on-swordtip.json', {
  id: 'banner.butterfly-on-swordtip',
  name: 'Butterfly on Swordtip',
  type: 'character',
  cost: pull,
  pityGroup: 'limited-character',
  rates: { fiveStar: 0.006, fourStar: 0.051 },
  pity: { fiveStarHard: 90, fiveStarSoftStart: 74, fiveStarSoftIncrement: 0.06, fourStarHard: 10 },
  featured: { fiveStar: ['char.seele'], fourStar: ['char.pela', 'char.natasha'], fiveStarChance: 0.5, fourStarChance: 0.5, guaranteeAfterLoss: true },
  pools: {
    fiveStar: ['char.seele', 'char.clara', 'char.himeko', 'char.welt', 'char.bronya', 'char.gepard', 'char.bailu'],
    fourStar: ['char.pela', 'char.natasha', 'char.dan-heng', 'char.march-7th', 'char.tingyun', 'lc.only-silence-remains', 'lc.post-op-conversation', 'lc.good-night-and-sleep-well', 'lc.memories-of-the-past', 'lc.dance-dance-dance'],
    threeStar: ['lc.arrows', 'lc.void', 'lc.defense'],
  },
  tenPullDiscount: 0,
});
await write('banners/brilliant-fixation-in-the-night.json', {
  id: 'banner.brilliant-fixation-in-the-night',
  name: 'Brilliant Fixation: In the Night',
  type: 'lightCone',
  cost: pull,
  pityGroup: 'limited-light-cone',
  rates: { fiveStar: 0.008, fourStar: 0.066 },
  pity: { fiveStarHard: 80, fiveStarSoftStart: 66, fiveStarSoftIncrement: 0.07, fourStarHard: 10 },
  featured: { fiveStar: ['lc.in-the-night'], fourStar: ['lc.only-silence-remains', 'lc.post-op-conversation', 'lc.good-night-and-sleep-well'], fiveStarChance: 0.75, fourStarChance: 0.75, guaranteeAfterLoss: true },
  pools: {
    fiveStar: ['lc.in-the-night', 'lc.something-irreplaceable', 'lc.night-on-the-milky-way', 'lc.but-the-battle-isnt-over', 'lc.in-the-name-of-the-world', 'lc.moment-of-victory', 'lc.time-waits-for-no-one'],
    fourStar: ['lc.only-silence-remains', 'lc.post-op-conversation', 'lc.good-night-and-sleep-well', 'lc.memories-of-the-past', 'lc.dance-dance-dance', 'lc.subscribe-for-more', 'char.pela', 'char.natasha'],
    threeStar: ['lc.arrows', 'lc.void', 'lc.defense'],
  },
  tenPullDiscount: 0,
});

// ---- items / cost tables
const all = items.all();
await clearDir('items');
await write('items/currencies.json', all.filter((i) => ['currency', 'premiumCurrency', 'warpPass', 'characterExp', 'lightConeExp', 'relicExp'].includes(i.category)));
await write('items/materials.json', all.filter((i) => !['currency', 'premiumCurrency', 'warpPass', 'characterExp', 'lightConeExp', 'relicExp'].includes(i.category)));
await write('items/project.json', [
  { id: 'quest.signal-beacon', name: 'Signal Beacon', category: 'quest', rarity: 4, description: "The waystation's emergency beacon. Its light has gone out.", maxStack: 1 },
]);
await clearDir('cost-tables');
await write('cost-tables/traces.json', costTables);

// ---- enemy level curve (HardLevelGroup 1)
const progPath = path.join(data, 'rules', 'progression', 'default.json');
const prog = JSON.parse(await readFile(progPath, 'utf8'));
prog.enemy = {
  levels: Object.fromEntries(src.dm.hardLevels.map((h) => [String(h.Level), { hp: h.HPRatio.Value, atk: h.AttackRatio.Value, def: h.DefenceRatio.Value, spd: h.SpeedRatio.Value }])),
};
prog.sources = [
  ...(prog.sources ?? []).filter((s) => !s.topic.startsWith('Enemy level curve')),
  source('Enemy level curve (HardLevelGroup 1: HP/ATK/DEF/SPD ratios, Lv1-95)', `${SOURCES.datamine.repo}/blob/${SOURCES.datamine.commit}/ExcelOutput/HardLevelGroup.json`),
];
await writeFile(progPath, fmt(prog) + '\n');

// ---- script handler manifest (documented in docs/DATA_SOURCES.md; checked by tests)
const handlerIds = [...new Set([...chars.scripts, ...cones.scripts, ...foes.scripts, ...statuses.filter((s) => s.script).map((s) => s.script)])].sort();
const undocumented = handlerIds.filter((h) => !SCRIPT_HANDLERS[h]);
if (undocumented.length) throw new Error(`undocumented script handlers: ${undocumented.join(', ')}`);
const handlers = handlerIds.map((id) => ({ id, phase: 5, description: SCRIPT_HANDLERS[id] }));
await rm(path.join(data, 'rules', 'script-handlers'), { recursive: true, force: true });
await write('script-handlers/handlers.json', handlers);

console.log(
  `characters ${chars.characters.length}, light cones ${cones.lightCones.length}, enemies ${foes.enemies.length}, relic sets ${sets.length}, ` +
    `items ${all.length + 1}, cost tables ${costTables.length}, statuses ${statuses.length}, script handlers ${handlers.length}`,
);
