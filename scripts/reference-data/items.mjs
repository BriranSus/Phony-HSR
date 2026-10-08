/**
 * Item registry: every material referenced by promotion / Trace costs, plus currencies, warp passes
 * and EXP materials, with names, rarities and descriptions from the sources.
 */
import { slugify } from './builders.mjs';

const FIXED_IDS = { 2: 'credit', 1: 'stellar-jade', 3: 'oneiric-shard', 11: 'trailblaze-power', 101: 'star-rail-pass', 102: 'star-rail-special-pass', 251: 'undying-embers', 252: 'undying-starlight' };
const CATEGORY = {
  Virtual: 'currency',
  AvatarExp: 'characterExp',
  EquipmentExp: 'lightConeExp',
  RelicExp: 'relicExp',
  TracePath: 'trace',
  CommonMonsterDrop: 'ascension',
  MonsterDrop: 'ascension',
  WeeklyMonsterDrop: 'trace',
  Eidolon: 'eidolon',
  Material: 'misc',
};

export function itemRegistry(src) {
  const { srr, dm, text } = src;
  const items = new Map();
  const clean = (s) => String(s ?? '').replace(/<[^>]+>/g, '').replace(/\\n|\n/g, ' ').replace(/\s+/g, ' ').trim();
  function add(refId, overrides = {}) {
    const key = String(refId);
    if (items.has(key)) return items.get(key).id;
    const r = srr.items[key];
    if (!r) throw new Error(`unknown item ${key}`);
    const cfg = dm.item.get(key);
    const exp = dm.itemExp.get(key);
    const category = overrides.category ?? (FIXED_IDS[key] === 'stellar-jade' ? 'premiumCurrency' : key === '101' || key === '102' ? 'warpPass' : CATEGORY[r.sub_type] ?? 'misc');
    const description = clean(text(cfg?.ItemDesc)) || (r.come_from?.length ? `Obtained from: ${r.come_from.slice(0, 3).join(', ')}.` : r.name);
    const item = {
      id: FIXED_IDS[key] ?? slugify(overrides.name ?? r.name),
      name: overrides.name ?? r.name,
      category,
      rarity: Math.min(5, Math.max(1, r.rarity)),
      description,
      maxStack: cfg?.PileLimit ?? 999999,
      ...(exp ? { exp } : {}),
      ...(category === 'currency' || category === 'premiumCurrency' ? { hidden: true } : {}),
    };
    items.set(key, item);
    return item.id;
  }
  const cost = (materials) => materials.map((m) => ({ item: add(m.id), count: m.num }));
  return { add, cost, all: () => [...items.values()] };
}
