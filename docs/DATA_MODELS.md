# Astral Rail: Core Data Models

All static content is JSON under `src/data/`, validated at load by **Zod schemas** in `src/models/`. The TypeScript types are *inferred* from those schemas (`type Character = z.infer<typeof CharacterSchema>`), so schema and type cannot drift. The interfaces below are the inferred shapes, simplified for reading. The source files are authoritative.

Runtime-only shapes (combat state, player-owned instances, saves) are plain interfaces in `models/combat.ts`, `models/save.ts` and the `*Instance` interfaces.

**Conventions:** ids are lower-case dotted (`char.ignatius`). Percentages are fractions (`0.12` = 12%). Every tunable number of the battle system comes from `src/data/rules/*.json`, and the formulas in `src/models/formulas/` never embed constants.

| Model | Schema / type | Data folder | Sample |
|---|---|---|---|
| Elements, Paths | `ElementDefSchema`, `PathDefSchema` (`models/rules.ts`) | `elements/`, `paths/` | 7 elements, 8 paths |
| Combat rules | `CombatRulesSchema` | `rules/combat/` | `default.json` |
| Progression rules | `ProgressionRulesSchema` | `rules/progression/` | `default.json` |
| Scaling curves | `ScalingCurvesSchema` (`models/scaling.ts`) | `rules/scaling/` | basic / standard / support / heal |
| Abilities & effects | `AbilitySchema`, `EffectSchema`, `TriggerSchema` (`models/ability.ts`) | inside characters / enemies | |
| Status effects | `StatusEffectSchema` (`models/status.ts`) | `status-effects/` | 7 break effects + 10 kit / equipment statuses |
| Characters | `CharacterSchema` (`models/character.ts`) | `characters/` | 4 original characters |
| Enemies, loot | `EnemySchema`, `LootTableSchema` (`models/enemy.ts`) | `enemies/`, `loot-tables/` | normal, elite, 2-phase boss |
| Light Cones | `LightConeSchema` (`models/lightcone.ts`) | `light-cones/` | 5★ / 4★ / 3★ |
| Relics | `RelicSetSchema`, `RelicStatTablesSchema` (`models/relic.ts`) | `relics/sets/`, `relics/stat-tables/` | 2 cavern + 2 planar sets, 5★ tables |
| Items, cost tables | `ItemSchema`, `CostTableSchema` (`models/item.ts`) | `items/`, `cost-tables/` | currencies, EXP, trace mats |
| Warp banners | `BannerSchema` (`models/gacha.ts`) | `banners/` | limited character banner + limited Light Cone banner |
| Description templates | `models/templates.ts` | (all descriptions) | `{n}` / `{name}` placeholders, validated at load |
| Quests, dialogue | `QuestSchema`, `DialogueSchema` (`models/quest.ts`) | `quests/`, `dialogues/` | prologue quest + branching dialogue |
| Input bindings, tips | `InputBindingsSchema`, `LoadingTipSchema` | `input/`, `ui/tips/` | |
| Engine config | `GameConfigSchema` (`core/config/GameConfig.ts`) | `config/` | `game.config.json` |

---

## 1. Elements, Paths and stats

```ts
type Element = 'Physical' | 'Fire' | 'Ice' | 'Lightning' | 'Wind' | 'Quantum' | 'Imaginary';
type Path = 'Destruction' | 'Hunt' | 'Erudition' | 'Harmony' | 'Nihility' | 'Preservation' | 'Abundance' | 'Remembrance';
// New Paths from future content: add to PATHS (models/common.ts) + paths.json. Nothing else enumerates them.

interface PathDef { id; path: Path; name; role; description; baseAggro: number }
```

| Path | Role | Base aggro (chance weight to be targeted) |
|---|---|---|
| Destruction | Frontline DPS | 125 |
| Hunt | Single-target DPS | 75 |
| Erudition | Multi-target DPS | 75 |
| Harmony | Buffer | 100 |
| Nihility | Debuffer | 100 |
| Preservation | Shielder / tank | 150 |
| Abundance | Healer | 100 |
| Remembrance | Summoner (memosprites) | 100 |

**Stats** (`models/stats.ts`). Panel stats: `hp atk def spd`, `hpPct atkPct defPct spdPct`, `critRate critDmg breakEffect outgoingHealing maxEnergy energyRegen effectHitRate effectRes`, `<element>Dmg`, `<element>Res`. Combat-zone modifiers: `allDmg basicDmg skillDmg ultimateDmg followUpDmg dotDmg breakDmg superBreakDmg defIgnore defReduction resPen vulnerability dmgMitigation weaken shieldBonus incomingHealing breakEfficiency debuffRes aggro`.

```
Final ATK = (character base ATK + Light Cone base ATK) × (1 + Σ ATK%) + Σ flat ATK      (same for HP, DEF)
Final SPD = base SPD × (1 + Σ SPD%) + Σ flat SPD
```

Base CRIT Rate is 5% and base CRIT DMG is 50% (schema defaults on `baseStats`).

## 2. Combat rules (`rules/combat/default.json`)

```ts
interface CombatRules {
  actionValue: { numerator: 10000; firstCycle: 150; cycle: 100 };
  skillPoints: { max: 5; start: 3; basicGain: 1; skillCost: 1 };          // party-shared pool
  energy: { basic: 20; skill: 30; ultimate: 5; kill: 10; initialRatio: 0.5 };
  techniquePoints: { max: 5; regenPerDay: number };
  crit: { baseRate: 0.05; baseDmg: 0.5 };
  defense: { enemyBase: 200; enemyPerLevel: 10; levelOffset: 20; charBase: 200; charPerLevel: 10 };
  resistance: { defaultEnemyRes: 0.2; weakEnemyRes: 0; multiplierMin: 0.1; multiplierMax: 2.0 };
  brokenMultiplier: { unbroken: 0.9; broken: 1.0 };
  toughness: { basic: 10; skill: 20; ultimate: 30; multiplierBase: 0.5; multiplierDivisor: 40 };
  weaknessBreak: { baseDelay: 0.25; superBreakDivisor: 10; recoverOnNextTurn: true; statusBaseChance: 1.5;
                   elements: Record<Element, { breakDmgMultiplier; status; extraDelay; scalesWithBreakEffect; summary }> };
  effectHit: { minChance: 0; maxChance: 1 };
  lightCone: { equipRequiresMatchingPath: false; passiveRequiresMatchingPath: true; maxSuperimposition: 5 };
  party: { maxActive: 4; maxEnemiesPerWave: 5 };
  levelMultiplier: Record<level, number>;   // full per-level table, Lv1..95 (81-95 enemy-only); no interpolation
  sources: { topic; url; retrieved }[];     // where reference numbers were verified
}
```

**Break level multiplier.** The table is the reference game's full per-level list, copied verbatim from the
HSR community wiki ([Toughness > Level Multiplier](https://honkai-star-rail.fandom.com/wiki/Toughness), read 2026-10-06 through the
MediaWiki API; all 95 rows compared programmatically). The schema requires every level from 1 to at least 80, strictly increasing,
and `levelMultiplier()` throws for a level outside the table. Anchors: Lv1 54 · Lv20 139.7703 · Lv40 363.6658 · Lv50 774.9041 ·
Lv60 1640.3068 · Lv70 2659.6406 · Lv80 3767.5533 · Lv95 7494.3713.

### 2.1 Action Value and turn order (`formulas/actionValue.ts`)

| Mechanic | Formula |
|---|---|
| Base AV | `AV = 10000 / SPD` (SPD 100 → 100 AV; SPD 134 → 74.6 AV) |
| Next actor | Lowest remaining AV. On acting, every unit's AV decreases by the elapsed AV and the actor resets to its base AV. Ties resolve in slot order. |
| Action Advance X% | `AV = max(0, AV − X × baseAV)` |
| Action Delay X% | `AV = AV + X × baseAV` |
| SPD change mid-wait | `AV_new = AV_old × SPD_old / SPD_new` (remaining distance preserved) |
| Cycles | First cycle 150 AV, then 100 AV each (Memory-style stages score by cycles) |
| Ultimates | Can be queued any time energy is full. They are inserted before the next action and don't consume a turn. |

`predictTurnOrder(units, n)` drives the turn-order bar. Example: SPD 100 vs SPD 200 gives `fast@50, slow@100, fast@100, fast@150, slow@200, fast@200`.

### 2.2 Skill Points and Energy (`formulas/resources.ts`)

- **Skill Points** are shared by the whole party. A battle starts at **3**, the cap is **5**, Basic ATK gives **+1**, a Skill costs **1**, and excess is lost. Kits can override costs and gains per ability (`spCost`, `spGain`).
- **Ultimate resource** is per character (`ultimateResource`): `{ kind: "energy", max }` for the usual Energy bar (120–160 in samples), or `{ kind: "points", name, max, cost, initial }` for kits whose Ultimate charges from a point counter instead of Energy (charged by `ultimatePoints` effects, unaffected by ERR). Energy gains: Basic 20, Skill 30, Ultimate 5 (granted after the reset to 0), kill 10, hit taken = enemy ability `energyToTarget`. `gain × (1 + Energy Regeneration Rate)` applies unless `fixed`. The Ultimate is usable when the resource reaches its cost.
- **Break debuffs** have a **150%** base chance (`weaknessBreak.statusBaseChance`) before EHR / Effect RES / Debuff RES.
- **Debuff chance:** `Base × (1 + Effect Hit Rate) × (1 − Effect RES) × (1 − Debuff RES)`. Fixed-chance effects ignore EHR and RES.

### 2.3 Damage formula: multiplier zones (`formulas/damage.ts`)

```
DMG = Base × CRIT × DMG Boost × Weaken × DEF × RES × Vulnerability × DMG Mitigation × Broken
```

| Zone | Formula |
|---|---|
| Base | `(ability multiplier + extra multiplier) × scaling stat (ATK/HP/DEF) + extra flat` |
| CRIT | `1 + CRIT DMG` on crit (expected value `1 + min(1, CR) × CD`) |
| DMG Boost | `1 + Σ(elemental DMG% + all-type DMG% + attack-type DMG%, e.g. Follow-up / DoT / Ultimate)` |
| Weaken | `1 − weaken` |
| DEF (vs enemy) | `(Lv_atk + 20) / ((Lv_target + 20) × (1 − DEF reduction − DEF ignore) + Lv_atk + 20)`. Equal levels give **0.5**. Enemy DEF = 200 + 10 × Lv. |
| DEF (vs character) | `1 − DEF / (DEF + 200 + 10 × Lv_attacker)` |
| RES | `1 − (RES − RES PEN)`, clamped to [0.1, 2.0]. Enemy RES is **20%** by default and **0%** for elements it is weak to (per-enemy overrides allowed). |
| Vulnerability | `1 + Σ vulnerability` |
| DMG Mitigation | `Π (1 − mitigation_i)` |
| Toughness / Broken | **0.9** while toughness is up, **1.0** while Weakness Broken |

`computeDamage()` returns each zone separately for tests and the future damage-breakdown UI.

### 2.4 Toughness, Weakness Break and break effects (`formulas/toughness.ts`, `status-effects/weakness-break.json`)

- Only hits of an element the enemy is **weak** to reduce toughness. Standard reduction is Basic 10, Skill 20, Ultimate 30 (data units), scaled by `× (1 + Break Efficiency)`. Some abilities ignore weakness.
- When toughness reaches 0, the enemy is **Weakness Broken**. It takes Break DMG, gets the element's break status, is delayed **25%**, and takes full damage until it recovers at the start of its next turn.
- **Max Toughness multiplier** = `0.5 + MaxToughness / 40`.
- **Break DMG** = `ElementMult × LevelMult(attacker) × MaxToughnessMult × (1 + Break Effect) × DEF × RES × Vuln × Broken`.
- **Super Break DMG** = `LevelMult × (toughness reduced / 10) × (1 + BE) × SuperBreakMult × …`.

| Element | Break DMG mult | Break effect (status id) | Effect |
|---|---|---|---|
| Physical | 2.0× | **Bleed** (`break.bleed`) | 2 turns. DoT = min(16% Max HP (7% Elite/Boss), 2 × LevelMult × MaxToughnessMult) × (1 + BE) |
| Fire | 2.0× | **Burn** (`break.burn`) | 2 turns. DoT = 1 × LevelMult × (1 + BE) |
| Ice | 1.0× | **Freeze** (`break.freeze`) | 1 turn. On thaw the frozen turn is skipped, the unit takes 1 × LevelMult Ice **Additional DMG**, and its next action is **Advanced Forward 50%** (`cc.advanceOnExpire`) |
| Lightning | 1.0× | **Shock** (`break.shock`) | 2 turns. DoT = 2 × LevelMult × (1 + BE) |
| Wind | 1.5× | **Wind Shear** (`break.wind-shear`) | 2 turns. 1 stack (3 on Elite/Boss), max 5. DoT = 1 × LevelMult × stacks |
| Quantum | 0.5× | **Entanglement** (`break.entanglement`) | Extra delay 20% × (1 + BE). Stacks up to 5 per hit received. On its turn: 0.6 × stacks × LevelMult × MaxToughnessMult as Additional DMG |
| Imaginary | 0.5× | **Imprisonment** (`break.imprisonment`) | Extra delay 30% × (1 + BE), SPD −10% for 1 turn |

The effects are ordinary status effects, so cleanses, resistances (`debuffRes`) and VFX hooks apply uniformly:

```json
{
  "id": "break.wind-shear", "name": "Wind Shear", "kind": "debuff", "category": "dot", "dispellable": true,
  "maxStacks": 5, "initialStacks": { "normal": 1, "elite": 3 },
  "duration": { "turns": 2, "tickOn": "ownerTurnStart" },
  "dot": { "element": "Wind", "formula": "breakDot", "levelMultiplier": 1, "perStack": true }
}
```

## 3. Abilities, effects and triggers (`models/ability.ts`)

```ts
interface Ability {
  id; name; kind: 'basic'|'skill'|'ultimate'|'talent'|'technique'|'enhancedBasic'|'enhancedSkill'|'followUp'|'memospriteSkill'|'memospriteTalent'|'enemy';
  tags: ('singleTarget'|'blast'|'aoe'|'bounce'|'enhance'|'support'|'defense'|'restore'|'impair'|'summon')[];
  targeting: 'enemySingle'|'enemyBlast'|'enemyAll'|'enemyBounce'|'allySingle'|'allyAll'|'self'|'none';
  maxLevel: number;              // Basic 6, others 10 (Eidolons add +1/+2)
  description: string;           // template, see "Description templates" below
  spCost; spGain; energyGain; techniquePointCost;
  effects: Effect[];             // executed in order
  triggers: Trigger[];           // talents, passives: { on, conditions?, effects, limitPerTurn? }
  modifiers: StatModifier[];     // always-on stat changes
  presentation?: { animation?, vfx?[], sfx?[], voice?, camera? };   // hooks resolved by id
}

type Effect =
  | { kind: 'damage'; target; stat: 'atk'|'hp'|'def'; multiplier: LevelScaled; element?; toughness; hitSplit?; bounces?; attackType? }
  | { kind: 'heal' | 'shield'; target; stat; multiplier; flat?; duration? }
  | { kind: 'applyStatus'; target; status: Id; baseChance?; fixedChance?; duration?; stacks?;
      params?: Record<string, LevelScaled | { param: string }> }   // { param } = owner's params (Light Cone S1..S5)
  | { kind: 'dispel'; target; statusKind: 'buff'|'debuff'; count }
  | { kind: 'energy'; target; amount; fixed? }
  | { kind: 'ultimatePoints'; target; amount }           // points-based Ultimates only
  | { kind: 'skillPoints'; amount }
  | { kind: 'actionAdvance'; target; fraction }         // negative = delay
  | { kind: 'summon'; unit: Id; unitType: 'memosprite'|'enemy' }
  | { kind: 'script'; handler: string; params? };        // character-specific mechanics

type LevelScaled = number | { curve: 'basic'|'standard'|'support'|'heal'; ref: number } | { table: number[] };
type EffectTarget = 'primary'|'adjacent'|'allEnemies'|'randomEnemy'|'self'|'selectedAlly'|'allAllies'|'allAlliesExceptSelf'
  |'attacker'|'memosprite'|'owner';                     // primary = the ability's selected target (enemy or ally)
type TriggerEvent = 'battleStart'|'waveStart'|'onEnterBattleField'|'turnStart'|'turnEnd'|'beforeAttack'|'afterAttack'
  |'afterUseBasic'|'afterUseSkill'|'afterUseUltimate'|'onFollowUp'|'afterBeingHit'|'afterAllyAttack'|'afterAllyHit'
  |'afterAllyUsesUltimate'|'onMemospriteSummoned'|'onMemospriteLeave'|'onKill'|'onWeaknessBreak'|'onDebuffApplied'
  |'onEnemyDefeated'|'onHpChanged'|'onShieldBroken';
type ConditionType = 'attackType'|'attackerHasStatus'|'attackerIsOwnMemosprite'|'sourceIsMemosprite'|'memospriteOnField'
  |'hasStatus'|'targetHasStatus'|'targetHasShield'|'abilityTargetsAlly'|'hpBelow'|'statAtLeast';   // closed list
```

**Trigger semantics** (full list in `models/ability.ts`): `afterUseBasic/Skill/Ultimate` fire after the owner uses that ability
whether or not it deals damage, so a buff-only Ultimate still triggers "after using the Ultimate" effects (Pilgrim 4pc, Ignatius E2).
`afterAllyAttack` is "after another ally attacks" (Seraphine's Talent, Lyra's Talent), and `afterAllyHit` is "when an ally is attacked"
(Brann's counter). `onFollowUp` fires for follow-ups and counters, `onEnterBattleField` when the owner enters the field (memosprites
on summon), and `onMemospriteSummoned` / `onMemospriteLeave` around the owner's memosprite. Condition types are a closed enum, so a
typo fails at load time.

**Description templates** (`models/templates.ts`). Every description is a template whose numbers come from the executed data:

| Source | `{n}` indexes | `{name}` |
|---|---|---|
| Ability | damage `multiplier`; heal/shield `multiplier`, `flat`; applyStatus `params` (key order), across effects then trigger effects; then `modifiers` | applyStatus param name |
| Light Cone passive | `modifiers` values, then `params` in key order | `params` key |
| Trace passive, Eidolon, relic set bonus | `modifiers` values, then trigger applyStatus params | applyStatus param name |

`{0}%` formats a fraction as a percentage. The registry runs `templateProblems()` for every character (abilities, memosprite, Traces,
Eidolons), Light Cone, relic set and enemy, so an unresolved placeholder fails the data load. Light Cones additionally must use
every `params` entry from a trigger (`{ "param": "skillTargetDmg" }`) and may not reference unknown params.

**Ability level scaling** follows the reference game's standard curves (`rules/scaling/default.json`). `ref` is the value at the reference level:

| Curve | Ref level | Example |
|---|---|---|
| `basic` | 6 | 50% at Lv1 → **100%** at Lv6 → 130% at Lv9 |
| `standard` | 10 | 100% → **200%** at Lv10 → 220% at Lv12 → 250% at Lv15 |
| `support` / `heal` | 10 | Gentler curves for buffs and healing (approximations) |

Attack types (`basic, skill, ultimate, followUp, dot, break, superBreak, additional, technique, memosprite`) select which DMG% bonuses apply. Counters are follow-ups.

## 4. Characters (`models/character.ts`)

```ts
interface Character {
  id; name; rarity: 4 | 5; element: Element; path: Path;
  ultimateResource: { kind: 'energy'; max } | { kind: 'points'; name; max; cost; initial = 0 };
  baseStats: { hp; atk; def; spd; critRate = 0.05; critDmg = 0.5; aggro? };   // Lv1 values
  abilities: { basic; skill; ultimate; talent; technique; extra: Ability[] };
  memosprite?: { id; name; hpFromOwner: { ratio; flat }; spd: { fixed } | { ownerRatio };
                 onZeroHp: 'leaveField'; abilities: Ability[] };   // Remembrance: exactly one memospriteSkill + one memospriteTalent
  traces: TraceNode[];
  eidolons: [Eidolon × 6];          // ranks 1..6 in order (validated)
  ascensionCosts: [Cost × 6];       // phases 0→1 … 5→6
  eidolonItem: Id;                  // duplicate item that unlocks the next Eidolon
  presentation: { model; portraitColor; voice: Record<cue, id>; hooks? };
  lore: { title; faction; bio };
}

interface TraceNode {
  id; kind: 'ability' | 'major' | 'stat'; name; parent?: Id;        // tree edge
  ability?: 'basic'|'skill'|'ultimate'|'talent'|'memospriteSkill'|'memospriteTalent';
  stat?: { stat: StatId; value: number };                              // minor nodes
  passive?: { description; modifiers; triggers };                      // Major Traces (A2/A4/A6)
  requirements: { ascension?; level? };
  costTable: Id;                                                       // shared ladder, one step per level-up
}

type LeveledAbilitySlot = 'basic'|'skill'|'ultimate'|'talent'|'memospriteSkill'|'memospriteTalent';
interface Eidolon { rank: 1..6; name; description; abilityLevelBonus?: Partial<Record<LeveledAbilitySlot, n>>;
                    modifiers; triggers; script? }   // E3/E5: e.g. { skill: 2, basic: 1 } / { ultimate: 2, talent: 2 }
// Remembrance pattern (Lyra): E3 { ultimate: 2, basic: 1, memospriteSkill: 1 }, E5 { skill: 2, talent: 2, memospriteTalent: 1 }
```

**Stat growth** reproduces the reference promotion structure: `stat(Lv, A) = base × (1 + ascensionBonus[A] + levelGrowth × (Lv − 1))`, with level caps 20/30/40/50/60/70/80 for ascension phases 0–6 (`rules/progression/default.json`).

| Curve | `levelGrowth` | `ascensionBonus` (phases 0..6) | Lv80 A6 / Lv1 | Check |
|---|---|---|---|---|
| Characters | 0.05 | 0, 0.4, 0.8, 1.2, 1.6, 2.0, 2.4 | 7.35× | 5★ ATK 87.12 → **640.33** |
| Light Cones | 0.15 | 0, 1.2, 2.8, 4.4, 6.0, 7.6, 9.2 | **22.05×** | 5★ 48 / 26.4 / 21 → **1058.4 / 582.12 / 463.05**; 4★ 43.2 / 19.2 / 18 → 952.56 / 423.36 / 396.9; 3★ 38.4 / 14.4 / 12 → 846.72 / 317.52 / 264.6 |

Natural ability max levels: Basic 6, Skill / Ultimate / Talent 10, Memosprite Skill / Talent 6 (`abilityMaxLevel`); Eidolon bonuses go above them.

**Player-owned state (saved):**

```ts
interface CharacterInstance { characterId; level; ascension; exp; eidolon: 0..6; traces: Record<nodeId, level>;
                              lightCone: uid | null; relics: Partial<Record<RelicSlot, uid>> }
```

Example (abridged from `characters/ignatius.json`):

```json
{
  "id": "char.ignatius", "name": "Ignatius Rhee", "rarity": 5, "element": "Fire", "path": "Destruction",
  "ultimateResource": { "kind": "energy", "max": 120 },
  "baseStats": { "hp": 168.96, "atk": 84.48, "def": 59.535, "spd": 97 },
  "abilities": {
    "skill": {
      "id": "ignatius.skill", "name": "Pyre Rend", "kind": "skill", "tags": ["blast"], "targeting": "enemyBlast",
      "maxLevel": 10, "spCost": 1, "energyGain": 30,
      "effects": [
        { "kind": "damage", "target": "primary", "stat": "atk", "multiplier": { "curve": "standard", "ref": 2.0 }, "toughness": 20, "hitSplit": [0.3, 0.7] },
        { "kind": "damage", "target": "adjacent", "stat": "atk", "multiplier": { "curve": "standard", "ref": 0.8 }, "toughness": 10 }
      ]
    },
    "talent": {
      "id": "ignatius.talent", "kind": "talent", "targeting": "none", "maxLevel": 10,
      "triggers": [{ "on": "afterAttack", "conditions": [{ "type": "targetHasStatus", "params": { "status": "status.scorch" } }],
                     "effects": [{ "kind": "applyStatus", "target": "self", "status": "buff.kindled", "duration": 2,
                                   "params": { "atkPct": { "curve": "support", "ref": 0.25 } } }] }]
    }
  },
  "eidolons": [{ "rank": 3, "name": "Kiln of Stars", "abilityLevelBonus": { "skill": 2, "basic": 1 } }]
}
```

Validation beyond the schema: eidolon order, unique trace ids, existing trace parents, slot/kind agreement, Remembrance characters must define a memosprite, memosprite summons must reference it, memosprite level bonuses and trace nodes require a memosprite, `ultimatePoints` effects require a points resource, `{ param }` references are only allowed on Light Cones, and every description placeholder must resolve. Cross-references are also checked: every status, item and cost table used must exist.

## 5. Status effects (`models/status.ts`)

```ts
interface StatusEffect {
  id; name; description; kind: 'buff'|'debuff'|'neutral';
  category: 'stat'|'dot'|'cc'|'shield'|'mark'|'field'|'other';
  dispellable: boolean; maxStacks = 1; initialStacks?: { normal; elite };
  duration: { turns /* 0 = permanent */; tickOn: 'ownerTurnStart'|'ownerTurnEnd'|'casterTurnStart'|'casterTurnEnd' };
  modifiers: { stat; value: LevelScaled | { param: string }; scope; conditions? }[];  // {param} pulls the level-scaled value from the applying effect
  triggers: Trigger[];
  dot?: { element; formula: 'breakDot'|'breakBleed'|'attackerScaled'; levelMultiplier?; useToughnessMultiplier?; perStack?;
          maxHpRatio?: { normal; elite }; capLevelMultiplier?; stat?; multiplier?; tickOn: 'ownerTurnStart'|'onExpire';
          damageType: 'dot' | 'additional' };   // Freeze / Entanglement deal Additional DMG, not DoT
  cc?: { type: 'freeze'|'entanglement'|'imprisonment'|'stun'|'dominated'|'taunt'|'outrage'; skipsTurn; delayOnExpire?; advanceOnExpire? };
}
```

## 6. Enemies (`models/enemy.ts`)

```ts
interface Enemy {
  id; name; rank: 'normal'|'elite'|'boss'|'weeklyBoss'|'storyBoss'|'event'; faction;
  baseStats: { hp; atk; spd; effectHitRate; effectRes };   // Lv1; level growth from rules (DEF from combat rules)
  toughness: number; weaknesses: Element[];
  resistances: Partial<Record<Element, number>>;            // default 20%, weak 0%
  debuffRes: Partial<Record<CcType, number>>;               // e.g. bosses resist Freeze
  abilities: (Ability & { kind: 'enemy'; energyToTarget; aiWeight; cooldown; chargeTurns })[];
  ai: { pattern: 'sequence'|'weighted'|'script'; sequence?; script?; conditions? };
  phases: { id; hpThreshold; toughness?; weaknesses?; abilities: Id[]; onEnter: Effect[]; summons: Id[] }[];
  lootTable?: Id;
  presentation: { model; scale; hooks?; bossBar; music? };
}
```

Validation: bosses must define phases, a weakness can't carry positive RES, and AI sequences and phases must reference real abilities. "Elite or higher" ranks switch Bleed to 7% and Wind Shear to 3 stacks.

## 7. Light Cones (`models/lightcone.ts`)

```ts
interface LightCone {
  id; name; rarity: 3 | 4 | 5; path: Path;
  baseStats: { hp; atk; def };               // only HP/ATK/DEF; added to character base before % bonuses
  passive: { name; description; modifiers: { stat; value: [S1, S2, S3, S4, S5]; conditions? }[]; triggers;
             params: Record<string, [S1..S5]> };   // every param must be used by a trigger via { "param": name }
  ascensionCosts: [Cost × 6]; fodderExp: number; lore;
}
interface LightConeInstance { uid; lightConeId; level; ascension; exp; superimposition: 1..5; locked; equippedBy }
```

Lv1 base stats follow the reference tiers (5★ 48 / 26.4 / 21, 4★ 43.2 / 19.2 / 18, 3★ 38.4 / 14.4 / 12 in the samples). Example of a trigger-driven passive (`lc.harmonic-thread`): "When the wearer uses their Skill, the target's DMG increases by {skillTargetDmg}% for 1 turn" is `{ on: "afterUseSkill", effects: [{ kind: "applyStatus", target: "primary", status: "buff.resonant-strings", duration: 1, params: { allDmg: { param: "skillTargetDmg" } } }] }`.

**Path rule:** as in the reference game, any character may *equip* any Light Cone and receive its base stats, but the passive only activates for the matching Path (`rules.lightCone.passiveRequiresMatchingPath = true`). Spec §8's stricter reading ("only the correct Path can use it") is one config switch away: `equipRequiresMatchingPath = true`.

## 8. Relics (`models/relic.ts`, `relics/stat-tables/default.json`)

| Slot group | Slots | Set bonuses |
|---|---|---|
| **Cavern Relics** | Head, Hands, Body, Feet | 2-piece and 4-piece |
| **Planar Ornaments** | Planar Sphere, Link Rope | 2-piece |

| Slot | Possible main stats |
|---|---|
| Head | flat HP |
| Hands | flat ATK |
| Body | HP%, ATK%, DEF%, CRIT Rate, CRIT DMG, Outgoing Healing, Effect Hit Rate |
| Feet | HP%, ATK%, DEF%, SPD |
| Planar Sphere | HP%, ATK%, DEF%, any elemental DMG% |
| Link Rope | HP%, ATK%, DEF%, Break Effect, Energy Regeneration Rate |

- **Main stat value** = `base + step × level`. 5★ at +15: HP 705.6, ATK 352.8, HP%/ATK% 43.2%, DEF% 54%, CRIT Rate 32.4%, CRIT DMG 64.8%, SPD 25.032, elemental DMG 38.88%, Break Effect 64.8%, ERR 19.44%. Unit tests check these.
- **Substats:** pool of 12 (flat HP/ATK/DEF, HP%/ATK%/DEF%, SPD, CRIT Rate, CRIT DMG, EHR, Effect RES, Break Effect). Never duplicates the main stat. 3–4 initial lines, max 4. Every 3 levels (+3/+6/+9/+12/+15) a new line is added or a random existing one is upgraded. A roll is `base + step × tier`, tier ∈ {0,1,2} (e.g. 5★ CRIT Rate 2.592% / 2.916% / 3.24%; SPD 2.0 / 2.3 / 2.6).

```ts
interface RelicSet { id; name; kind: 'cavern'|'planar'; pieces: Partial<Record<RelicSlot, string>>;
                     bonuses: { pieces: 2 | 4; description; modifiers; triggers }[] }   // validated: cavern 4 slots + 2/4pc, planar 2 slots + 2pc
// Conditional bonuses are triggers, e.g. Courier 4pc:
// { on: 'afterUseUltimate', conditions: [{ type: 'abilityTargetsAlly' }],
//   effects: [{ kind: 'applyStatus', target: 'allAllies', status: 'buff.gale-courier', duration: 1, params: { spdPct: 0.12 } }] }
interface RelicInstance { uid; setId; slot; rarity: 2..5; level; exp; mainStat: StatId;
                          substats: { stat; rolls; tierSum }[]; locked; discard; equippedBy }
```

## 9. Items, currencies and costs (`models/item.ts`)

```ts
interface Item { id; name; category: 'currency'|'premiumCurrency'|'warpPass'|'characterExp'|'lightConeExp'|'relicExp'
                 |'ascension'|'trace'|'eidolon'|'consumable'|'quest'|'event'|'misc';
                 rarity: 1..5; description; maxStack; exp?; use?; hidden }
type Cost = { item: Id; count: number }[];                     // credits are items too → one economy ledger
interface CostTable { id; description; steps: Cost[] }          // shared trace/ascension ladders
```

Samples: Credit, Aster Jade (premium), Voyage Pass / Special Voyage Pass (warp), character EXP books (1,000 / 5,000 / 20,000), Light Cone EXP (500 / 2,000 / 6,000), relic EXP, ascension, trace and weekly-boss materials, and Eidolon items.

## 10. Warp banners (`models/gacha.ts`)

```ts
interface Banner {
  id; name; type: 'character'|'lightCone'|'standard'|'beginner'; cost: { item; count }; pityGroup;
  rates: { fiveStar: 0.006; fourStar: 0.051 };
  pity: { fiveStarHard: 90; fiveStarSoftStart: 74; fiveStarSoftIncrement: 0.06; fourStarHard: 10 };
  featured: { fiveStar; fourStar; fiveStarChance: 0.5; fourStarChance: 0.5; guaranteeAfterLoss: true };
  pools: { fiveStar; fourStar; threeStar };
}
interface PityState { pullsSinceFiveStar; pullsSinceFourStar; fiveStarGuaranteed; fourStarGuaranteed }
```

Light Cone banners use 0.8% base (4★ 6.6%), hard pity 80, soft pity from pull 66, 75/25 odds and their own pity group (`banners/oath-of-embers-cone.json`). These are data values, not code.

## 11. Quests and dialogue (`models/quest.ts`)

Quest types: main, adventure, companion, daily, event, tutorial. A quest is a graph of objectives (`talk | reach | defeat | collect | interact | cutscene | custom`) with markers, dialogue links, branching `next` (optionally keyed by dialogue choice), prerequisites and rewards. Dialogue is a line graph with speakers, expressions, voice/camera hooks, and choices that set flags. Both are validated for dangling links.

## 12. Runtime combat state (`models/combat.ts`)

```ts
type CombatantKind = 'character' | 'memosprite' | 'enemy' | 'summon';
interface Combatant { uid; kind: CombatantKind; side: 'ally'|'enemy'; defId; ownerUid: uid | null; level; element; rank;
                      baseStats: StatBlock; abilityLevels: Record<slot, number>;
                      hp; ultimate: { kind: 'energy'|'points'; current; max; cost } | null;
                      toughness; maxToughness; broken; weaknesses; statuses: ActiveStatus[]; shield; actionValue;
                      presence: 'active'|'downed'|'leftField'; onZeroHp: 'downed'|'leaveField' }
interface ActiveStatus { statusId; sourceId; stacks; turnsLeft; params: Record<string, number> }
interface InsertedAction { kind: 'followUp'|'counter'|'extraTurn'|'memospriteAction'; actorUid; abilityId | null;
                           targetUid | null; sourceUid; seq }
interface BattleState { id; wave; waveCount; cycle; avElapsed; units: Combatant[]; skillPoints: { current; max };
                        ultimateQueue: { actorUid; targetUid }[]; insertedActions: InsertedAction[];
                        activeUid; outcome: 'ongoing'|'victory'|'defeat'|'fled' }
type PlayerAction =
  | { type: 'basic' | 'skill' | 'ultimate'; actor; target }
  | { type: 'enhancedBasic' | 'enhancedSkill'; actor; target; abilityId }   // kits that replace Basic/Skill
  | { type: 'memospriteSkill'; actor; target; abilityId };                  // a memosprite's own turn
```

- **Memosprites** are `kind: 'memosprite'` units with `ownerUid`. At 0 HP they `leftField` (off the timeline, owner unaffected,
  can be re-summoned) instead of being `downed`; a downed owner takes its memosprite off the field
  (`resolveZeroHp` in `formulas/units.ts`, unit-tested).
- **Inserted actions** (follow-ups, counters, extra turns, "memosprite immediately acts") wait in `insertedActions`, ordered by
  `seq`, and resolve before the next regular AV turn. Player Ultimates stay in their own `ultimateQueue`.
- **Building units:** the combat module's `UnitFactory.create(spec, uid)` takes a `UnitBuildSpec`: a `CharacterBuildSpec`
  (the `CharacterInstance` with Eidolon and Trace levels, plus the equipped `LightConeInstance` and `RelicInstance`s), an
  `EnemyBuildSpec` (`enemyId`, `level`), or an owned-unit spec (memosprite/summon definition + owner combatant).

## 13. Save game (`models/save.ts`)

A versioned `SaveGame { version: 1; account; characters; party; lightCones; relics; inventory; quests; exploration; achievements; gacha: { pity, history }; dailies; settings }`. Only *player progress* is saved; definitions always come from data. Each module serialises its own slice through a `SaveProvider`.
