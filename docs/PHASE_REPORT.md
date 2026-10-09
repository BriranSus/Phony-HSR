# Phase 1 Report: Project Architecture

**Project:** Astral Rail, an original fan project inspired by the gameplay structure of *Honkai: Star Rail*
**Scope:** spec §39 "FIRST ACTION" (analysis, engine, stack, architecture, folders, data models, dependencies, roadmap) and **Phase 1** of §37
**Status:** Phase 1 complete: Revision 1 (§7) and Revision 2, real Honkai: Star Rail content (§8), were each validated at 8.5/10. **Phase 2 (Player controller) is complete** and awaiting validation, see [§9](#9-phase-2-player-controller). Phase 3+ is not started.

---

## 1. What was done

### 1.1 Planning documents
| Document | Contents |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Spec analysis, engine selection (Three.js + TypeScript + Vite) with alternatives, tech stack, layered architecture, core services, module design, folder structure, data pipeline, §38 compliance, performance and testing strategy |
| [DATA_MODELS.md](DATA_MODELS.md) | Every core data model with TypeScript shapes and JSON examples. Covers mechanics: AV = 10000/SPD, party SP (start 3 / max 5), energy (20/30/5, ERR), damage zones (base, CRIT, DMG%, weaken, DEF, RES, vulnerability, mitigation, broken 0.9/1.0), toughness and the 7 break effects, Paths with aggro, Traces, Eidolons E1–E6, Light Cones with Path rule and S1–S5, 4 Cavern + 2 Planar relic slots with main/sub stats and set bonuses, gacha pity |
| [ROADMAP.md](ROADMAP.md) | All 26 phases with goals, dependencies and exit criteria, plus the enforced module dependency graph |

### 1.2 Runnable foundation
- **Tooling:** Vite 8, TypeScript 5.9 (`strict` + `noUncheckedIndexedAccess`), ESLint 10 + typescript-eslint, Vitest 4, and a Playwright 1.63 end-to-end/screenshot script.
- **Engine core (`src/core`):** fixed-timestep `GameLoop`; stack-based `StateManager` with queued operations, overlays and transition hooks; typed `EventBus` (extensible through declaration merging); `ServiceRegistry` DI with cycle detection; `DataRegistry` (Zod validation, duplicate-id, semantic and cross-reference checks, progress); `ConfigService` (data defaults + URL overrides); `Logger`; action-mapped `InputManager` (keyboard, mouse, wheel, gamepad); `RenderService` (one WebGL renderer, per-state views with bloom); `ModuleManager` (topological init).
- **Data models (`src/models`):** 16 schema files (incl. description templates), a collection catalog, and pure formulas for AV and turn order, damage zones, toughness and break (incl. Bleed cap, Wind Shear stacks, Entanglement, Super Break, the full Lv1–95 level-multiplier table), SP, energy, effect-hit chance, stat growth and unit lifecycle (memosprites leave the field at 0 HP). All constants are read from data.
- **Reference content (`src/data`, 79 files / 670 records / 20 collections; real Honkai: Star Rail data since Revision 2, see [DATA_SOURCES.md](DATA_SOURCES.md)):**
  - 18 characters with full kits (per-level reference parameters), Traces and E1–E6, covering all 7 Types and 8 Paths: Clara, Blade, Seele, Dan Heng, Himeko, Jing Yuan (with the Lightning-Lord summon), Bronya, Tingyun, Ruan Mei, Kafka, Silver Wolf, Pela, Welt, March 7th, Gepard, Natasha, Bailu and Trailblazer (Remembrance) with the memosprite Mem
  - 24 Light Cones: 12 signature 5★, 9 popular 4★, 3 × 3★
  - 15 enemies: Voidranger: Reaver, Silvermane Soldier, Frostspawn, Flamespawn, Thunderspawn, Automaton Beetle, Automaton Spider, Vagrant, Mara-Struck Soldier, 2 Lances of the Eternal Freeze, Automaton Grizzly, Voidranger: Trampler, Silvermane Lieutenant, and the 2-phase boss Cocolia, Mother of Deception
  - 12 Cavern + 8 Planar relic sets, 5★ relic stat tables, real items (95), 309 Trace cost tables, a real enemy level curve (Lv1–95)
  - the 7 break statuses plus 65 kit / Light Cone / relic / enemy statuses, 85 documented script handlers, a Seele character banner and an In the Night Light Cone banner, a quest + branching dialogue, input bindings, loading tips and combat/progression/scaling rules
- **Modules (`src/modules`):** 28 `GameModule`s covering every system in spec §36 (and more), each with a public interface, a DI token, a roadmap phase and declared dependencies. Two are partial: **ui** (layers, transitions, theme, SVG icon set, screens) and **vfx** (procedural starfield, nebula, ringed planet).
- **Boot flow (in the browser):**
  1. **Loading:** emblem with rotating rings, a gameplay tip loaded from data, and a gold progress rail tracking real per-file validation and module initialisation.
  2. **Title:** a procedural express rides a rail of light through a nebula past a ringed gas giant (tracking shot, bloom), with the "ASTRAL RAIL" wordmark, a pulsing "CLICK TO START" and side shortcuts.
  3. **Main menu:** a "Departure Board" overlay sliding in over the live backdrop. Future systems appear with phase badges.
  4. **Data Archive:** a registry browser with character cards (rarity, element/Path icons, Lv80 stats computed by the shared formulas, base AV, Taunt, kit incl. memosprite/summon), Light Cones (S1/S5 values), relic sets (2/4-piece bonuses), enemies (weakness icons, toughness, Lv80 HP/SPD from the real level curve, RES and debuff RES), and a combat-rules / break-effects table.
  5. **Test Scene:** a calibration platform with one crystal per element (colours from data), a placeholder mannequin and a light-rail arch. A debug orbit camera responds to WASD/Q/E/drag/wheel, a live input monitor shows held actions, and the F3 debug overlay (off by default) shows FPS, draw calls, state stack, registry and modules.
  6. Diagonal shutter transitions (navy panels, gold seam, emblem) between Loading → Title and Menu ↔ Test Scene. Esc returns to the menu.

## 2. How to run and verify

```bash
npm install            # once
npm run dev            # dev server → http://localhost:5173
npm run build          # typecheck (tsc --noEmit) + production build to dist/
npm run preview        # serve dist/ → http://localhost:4173
npm test               # Vitest unit tests (core, formulas, schemas, all shipped data)
npm run lint           # ESLint
npm run screenshots    # build + preview + Playwright walk-through → docs/screenshots/*.png
npm run import:reference   # regenerate the HSR reference content from the pinned sources
npm run screenshots -- --dev          # same against the dev server
npm run screenshots -- --swiftshader  # force software WebGL
```

**Controls:** click or Enter to start. W/S + Enter or mouse in menus, Esc to go back, Q/E to switch archive tabs. In the Test Scene: WASD to pan, Shift for faster, drag to orbit, wheel or +/− to zoom, Q/E to rotate, F3 or ` for the debug overlay.

**QA URL overrides** (config system): `?cfg.debug.startState=test-scene`, `?cfg.graphics.quality=low`, `?cfg.graphics.bloom=false`, `?cfg.ui.minLoadingMs=0`, `?cfg.debug.logLevel=debug`.

## 3. Test and build results

| Check | Result |
|---|---|
| `npm run build` (tsc + vite) | ✅ 0 type errors. Bundle: app 130 KB (40.8 KB gzip), three 579 KB (144 KB gzip), zod 95 KB, plus lazy per-file data chunks |
| `npm test` | ✅ **144 / 144 tests passed** in 13 files |
| `npm run lint` | ✅ 0 problems |
| `npm run screenshots` (production build) | ✅ 26 screenshots: full flow at 1600×900 plus menu / archive / test scene at 1280×720, 1024×768 and 390×844. **0 console or page errors, 0 layout problems** (overlap, cut-off and horizontal-overflow checks), 0 unresolved placeholders, input actions verified (`moveForward, moveRight, sprint, cameraDrag`) |
| `npm run screenshots -- --dev` | ✅ same flow on the dev server |
| Runtime FPS (headless Chromium, Intel UHD via ANGLE D3D11, 1600×900) | 60 FPS in the test scene |

**Unit test coverage by file:**

| File | Tests | Focus |
|---|---|---|
| `tests/core/EventBus.test.ts` | 9 | typing, once/off, priority, error isolation, unsubscribe during dispatch, onAny, waitFor |
| `tests/core/StateManager.test.ts` | 7 | push/pop/replace/reset lifecycles, serialised ops, overlays, transitions, errors |
| `tests/core/ServiceRegistry.test.ts` | 5 | singletons, transients, duplicates, cycles, scopes |
| `tests/core/GameLoop.test.ts` | 6 | fixed steps, clamping, interpolation alpha, step cap, pause/time scale, start/stop |
| `tests/core/DataRegistry.test.ts` | 8 | item/list loading, schema errors, duplicate ids, dangling refs, strict mode, path mapping |
| `tests/core/ModuleManager.test.ts` | 6 | topological order, cycle/unknown detection, **real module graph acyclic + spec §36 coverage**, headless boot |
| `tests/core/ConfigLoggerInput.test.ts` | 11 | config overrides and validation, logger levels and sinks, input edges, axes, mouse, blur, wheel, rebinding, gamepad |
| `tests/models/formulas.test.ts` | 31 | AV, advance/delay, SPD change, cycles, turn order, DEF/RES/mitigation/broken zones, toughness, **full level-multiplier table** (anchors Lv1/4/20/40/50/60/70/80/95, monotonic, no interpolation, gap rejection), break multipliers and delays, Bleed cap, DoTs, Freeze advance, SP pool, energy, debuff chance, stat growth (87.12 → 640; **Light Cones 26.4 → 582.12** and all three rarity tiers), memosprite leave-field lifecycle |
| `tests/models/templates.test.ts` | 5 | `{n}`/`{name}` placeholder resolution, load-time failures for abilities / Eidolons / Light Cones / relic sets, Light Cone param usage |
| `tests/models/kit-model.test.ts` | 6 | trigger hooks, closed condition types, memosprite Skill + Talent, memosprite Eidolon bonuses, Energy vs points Ultimates |
| `tests/models/schemas.test.ts` | 13 | rejection of invalid elements, paths, rarities, eidolon counts, typos, effects, relic sets, LC superimposition, statuses, curves, banners, dialogue |
| `tests/data/content.test.ts` | 11 | every shipped file validates (schemas, references, placeholders, param refs, script handlers), all elements and paths, roster covers 7 Types / 8 Paths with a memosprite and a summon, standard Basic/Skill/Ultimate economy and levels, relic tables, every set / Light Cone bonus encoded as data, documented handlers, banners |
| `tests/data/reference.test.ts` | 26 | **real values:** Lv80 stats of 8 characters, Energy / Taunt / Path / Type, Seele / Kafka / Jing Yuan / Blade multipliers and economy, Silver Wolf implant, Bronya advance, Clara counter, Mem HP, E3/E5 bonuses, Lv80 stats of 6 Light Cones, enemy weaknesses / toughness / RES, Cocolia phases, enemy level curve |

## 4. Screenshots (`docs/screenshots/`)

| File | Screen |
|---|---|
| `01-loading.png` | Loading screen mid-progress with tip |
| `02-title.png` | Title screen with procedural express backdrop |
| `03-main-menu.png` | Departure Board main menu over the live backdrop |
| `04-archive-characters.png` | Data Archive: character cards (gold 5★ / purple 4★) |
| `04b-archive-light-cones.png` | Data Archive: Light Cones with resolved passives and Lv80 stats |
| `04c-archive-relic-sets.png` | Data Archive: Cavern and Planar relic sets |
| `05-archive-enemies.png` | Data Archive: enemies with weaknesses and toughness |
| `06-archive-rules.png` | Data Archive: combat rules and weakness-break table |
| `07-transition.png` | Shutter transition (navy panels, gold seam, emblem) |
| `08-test-scene.png` | Test Scene with HUD and input monitor (debug overlay off by default) |
| `09-test-scene-input.png` | Test Scene with the F3 debug overlay while W+D+Shift are held and the camera is dragged / zoomed |
| `vp-<size>-main-menu.png` | Main menu at 1280x720, 1024x768 and 390x844 |
| `vp-<size>-archive.png`, `vp-<size>-archive-rules.png` | Archive characters and Combat Rules tabs at each size |
| `vp-<size>-test-scene-banner.png`, `vp-<size>-test-scene.png` | Test Scene with the area banner, then settled, at each size |

## 5. Known limitations (intentional for Phase 1, or data to be completed later)

- **No gameplay yet.** Player controller, combat, progression and the other systems are interfaces and stubs, as the spec requires before Phase 1 is validated. The Test Scene's orbit camera is a sandbox tool, not the Phase-3 camera system.
- **Interpretations and unverified fields** of the reference data are listed in [DATA_SOURCES.md §3](DATA_SOURCES.md#3-unverified-fields-and-interpretations) (e.g. Cocolia's phase transition, loot quantities, 4★ banner line-ups). Relic main-stat drop weights remain approximations. Relic stat tables cover 5★ only (other rarities in Phase 11).
- **Data references not executed yet:** script handler ids (e.g. `kafka.e6`) must be documented in `script-handlers/handlers.json` (85 handlers), but their implementations arrive with the skills module in Phase 5. Condition types and trigger events are closed enums (typos fail at load), but they are evaluated only once the Phase 5 engine exists.
- **UI:** only the Phase-1 screens exist. Characters keep procedural silhouettes: no copyrighted art, splash, icons, models, audio or fonts are used. Side shortcuts and disabled menu entries show their target phase. There's no localisation yet (plain strings), no audio (Phase 22), and characters show generic silhouettes (no character art by design).
- **Headless rendering:** the screenshot script prefers the hardware GPU through ANGLE and falls back to SwiftShader, where frames are slow but captures still work.

## 6. Revision note on reference numbers

The break level-multiplier table (Lv1–95) was copied from the HSR community wiki page
[Toughness → Level Multiplier](https://honkai-star-rail.fandom.com/wiki/Toughness) (wikitext read through the MediaWiki API on
2026-10-06, since the HTML page is behind a bot check). All 95 rows were compared programmatically with `rules/combat/default.json`
(0 mismatches), and the source is cited in that file's `sources` array. The Light Cone growth constants were checked against the
22.05× Lv80 ratio (In the Night 48 / 26.4 / 21 → 1058.4 / 582.12 / 463.05), also cited in `rules/progression/default.json`.

## 7. Revision 1 changelog

Validator score before revision: **7.5/10** (Mechanics 8, Architecture 8.5, Visual 7.5, Functionality 8.5).

| # | Finding | What changed |
|---|---|---|
| 1 | Main menu didn't fit at 1280×720 / 1024×768; 390px overlaps and archive overflow | `screens.css`: the Departure Board uses a clamp/vh vertical rhythm (panel padding, title, caption gap, row padding and gaps) and its list scrolls if the viewport is very short. While the board is open, the title footer stacks in the free area left of the panel and the wordmark scales to 0.82 / 0.66 below 1440 / 1180 px. At ≤900 px the board is full width and replaces the wordmark and footer; at ≤700 px the title logo, start prompt and footer re-flow. Archive: the tab strip scrolls on its own, the page never scrolls sideways, the rules table sits in its own scroll box and drops the prose column on phones, and the cards use `minmax(min(250px, 100%), 1fr)`. `scripts/screenshots.mjs` now captures 1280×720, 1024×768 and 390×844 and **fails** on horizontal overflow, overlapping elements (menu rows vs. footers, wordmark vs. panel, footer halves, HUD panels, banner) and cut-off UI. |
| 2 | "?" placeholder in Light Cone passives | New `models/templates.ts`: one resolver for `{n}` (Light Cones: modifiers, then params) and `{name}` placeholders, used by the archive. Load-time validation for every ability (incl. memosprite and enemy abilities), Trace passive, Eidolon, Light Cone and relic set: an unresolved placeholder fails the data load. Harmonic Thread now reads `{skillTargetDmg}` and renders "12% (S5 24%)". The E2E run also fails if an archive passive contains `{`, `}` or `?`. |
| 3 | Light Cone growth reached 20.05× instead of 22.05× | Growth curves use cumulative per-phase `ascensionBonus` tables (Light Cones 0, 1.2, 2.8, 4.4, 6.0, 7.6, 9.2 with 0.15/level; characters 0…2.4 with 0.05/level), so every rarity reaches 22.05×. Unit tests assert 26.4 → 582.12 and all nine 5★/4★/3★ reference values. Sample cones rebased: Ember Oath 48 / 26.4 / 21, Harmonic Thread 43.2 / 19.2 / 18, Bulwark Memory 38.4 / 14.4 / 12. |
| 4 | Remembrance Eidolons couldn't boost memosprite abilities | `abilityLevelBonus` accepts `memospriteSkill` / `memospriteTalent` (`LeveledAbilitySlotSchema`); validation rejects them on characters without a memosprite. Lyra E3 = Ultimate +2, Basic ATK +1, Memosprite Skill +1; E5 = Skill +2, Talent +2, Memosprite Talent +1 (reference wording "up to a maximum of Lv. 10/15"). Memosprites must have exactly one Memosprite Skill and one Memosprite Talent; Aria gained *Lingering Cadence* (team CRIT DMG while on the field, Energy for Lyra on entering). Memosprite abilities cap at Lv6 naturally (`abilityMaxLevel`), with their own trace nodes. |
| 5 | Trigger vocabulary missing core hooks; description-only bonuses | Added `afterUseBasic`, `afterUseSkill`, `afterUseUltimate`, `onFollowUp`, `onEnterBattleField`, `onMemospriteSummoned`, `onMemospriteLeave`; split `afterAllyAttacked` into `afterAllyAttack` and `afterAllyHit` (Seraphine/Lyra talents use the former, Brann's counter the latter). Condition types are now a closed enum (incl. `abilityTargetsAlly`, `attackerIsOwnMemosprite`). Courier 4pc is an `afterUseUltimate` + `abilityTargetsAlly` trigger applying `buff.gale-courier` (+12% SPD) to all allies; Pilgrim 4pc uses `afterUseUltimate` and applies **Fire** DMG via `buff.ember-pilgrim`; Harmonic Thread's `skillTargetDmg` is consumed by an `afterUseSkill` trigger through a `{ "param": … }` reference. Ignatius E2/A6 use the new hooks. Validators require every Light Cone param to be used by a trigger, and a content test requires every set and Light Cone bonus to carry modifiers or triggers. |
| 6 | Combat runtime couldn't represent HSR turn mechanics | `models/combat.ts`: `Combatant.kind` (character / memosprite / enemy / summon), `ownerUid`, `presence` (active / downed / leftField) and `onZeroHp`; memosprites leave the field at 0 HP and a downed owner takes its memosprite with it (`formulas/units.ts`, tested). `BattleState.insertedActions` (follow-up / counter / extra turn / immediate memosprite action, ordered by `seq`) alongside a typed `ultimateQueue`. `PlayerAction` adds `enhancedBasic`, `enhancedSkill` and `memospriteSkill`. `UnitFactory.create(spec, uid)` takes a `UnitBuildSpec` (`CharacterBuildSpec` = `CharacterInstance` + Light Cone + relic instances; enemy id + level; owned memosprite/summon + owner), and `EncounterSpec.party` carries build specs. New `combat:unitEntered` / `combat:unitLeft` events. |
| 7 | Break level multiplier was a linear placeholder | Full Lv1–95 table in `rules/combat/default.json` with a cited source (see §6); `levelMultiplier()` is an exact lookup that throws outside the table; the schema requires a contiguous, strictly increasing table covering at least Lv1–80. Tests check the Lv1/4/20/40/50/60/70/80/95 anchors. Also from the reference page: break debuff base chance 150% (`statusBaseChance`), Freeze/Entanglement deal Additional DMG (`damageType`), and Freeze advances the next action 50% on thaw (`advanceOnExpire`). |

**Nice-to-haves**

| Item | What changed |
|---|---|
| Light Cone banner | `banners/oath-of-embers-cone.json`: 0.8% 5★ / 6.6% 4★, hard pity 80, soft pity from pull 66, 75/25 featured odds, own pity group `limited-light-cone`. |
| Abstract Ultimate resource | `ultimateResource: { kind: "energy", max } \| { kind: "points", name, max, cost, initial }` replaces `maxEnergy`; `ultimatePoints` effect; runtime `UltimateGauge`. The archive shows Max Energy or the point counter. |
| Debug overlay | Off by default (`debug.overlay: false`, F3 or the backquote key toggles it), placed below the back button and height-capped; full width under the area title on phones. |
| "TEST SCENE" banner | Moved into the sky band (13 vh) on a soft horizontal scrim, smaller type, so it no longer crosses a crystal; checked at all sizes. |
| Input monitor | Keycap highlight has no fade, so the highlighted keys and the "No input" / action text change in the same frame. |
| Rarity colours | Gold 5★ / purple 4★ (/ blue 3★) tokens, rarity-coloured stars, gradient card backdrops and Light Cone card tints. |
| Chamfered corners | `--chamfer-*` clip-path tokens: menu rows, character cards, info cards, the input monitor and the debug overlay use clipped corners; pills remain for buttons, chips and badges. |

## 8. Revision 2 changelog (real HSR data)

Phase 1 passed validation at **8.5/10** after Revision 1. Before Phase 2, the user asked for the characters, Light Cones and enemies to be real Honkai: Star Rail content researched from real data. The rule against HSR names was lifted for this private test project. Binary assets stay forbidden, and the title stays "Astral Rail".

| Area | What changed |
|---|---|
| Sources | `npm run import:reference` regenerates the content from **StarRailRes** (structured English data: names, per-level ability parameters, promotions, Traces, Eidolons, Light Cones, relic sets, items) and the **TurnBasedGameData** datamine (Energy, SP, toughness per ability, memosprite skills, enemies, enemy level curve, EXP values, factions, bios), both pinned by commit, plus the HSR wiki for cross-checks. Every record has `sources`. [DATA_SOURCES.md](DATA_SOURCES.md) lists the sources, conversions, verified values and every unverified field. |
| Characters (18) | Destruction: Clara, Blade · Hunt: Seele, Dan Heng · Erudition: Himeko, Jing Yuan · Harmony: Bronya, Tingyun, Ruan Mei · Nihility: Kafka, Silver Wolf, Pela, Welt · Preservation: March 7th, Gepard · Abundance: Natasha, Bailu · Remembrance: **Trailblazer (Remembrance) with Mem** (chosen over Castorice; see DATA_SOURCES §3). Real rarity, Path, Type, base stats (promotion growth asserted against the reference tables), Taunt, max Energy, per-level multipliers, Energy / SP / toughness per ability, all 6 Eidolons with real E3/E5 bonuses (incl. Mem's), and the real Trace tree (A2/A4/A6, stat nodes, unlock requirements, costs). |
| Kits exercised | Follow-ups (Kafka, Himeko, Blade, Jing Yuan's Lightning-Lord), counters (Clara, March 7th), extra turns (Seele, Dan Heng E4), DoT + detonation (Kafka, Himeko Burn), shields (March 7th, Gepard), heals / HoT / revives (Natasha, Bailu, Gepard), summons (Lightning-Lord, Mem), Weakness implant (Silver Wolf), action advance (Bronya), Break DMG and break extension (Ruan Mei), HP consumption (Blade). |
| Light Cones (24) | 5★: Something Irreplaceable, The Unreachable Side, In the Night, Night on the Milky Way, Before Dawn, But the Battle Isn't Over, Past Self in Mirror, Patience Is All You Need, Incessant Rain, In the Name of the World, Moment of Victory, Time Waits for No One. 4★: Memories of the Past, Dance! Dance! Dance!, Good Night and Sleep Well, Post-Op Conversation, Only Silence Remains, Subscribe for More!, Resolution Shines As Pearls of Sweat, Day One of My New Life, Victory In a Blink. 3★: Arrows, Void, Defense. Real stats, promotion costs, fodder EXP and S1–S5 passives as modifiers / triggers. |
| Enemies (15) | Normal: Voidranger: Reaver, Silvermane Soldier, Frostspawn, Flamespawn, Thunderspawn, Automaton Beetle, Automaton Spider, Vagrant, Mara-Struck Soldier, Lance of the Eternal Freeze ×2. Elite: Automaton Grizzly, Voidranger: Trampler, Silvermane Lieutenant. Boss: **Cocolia, Mother of Deception** (Echo of War): 2 phases (Ice → Imaginary, toughness 180 → 160, Creator's Resolve +40 SPD), summons the Lances, Weakness Protected while they live, Lock On, Freeze / Imprisonment and a charged AoE. Real weaknesses, toughness, element RES, debuff RES, SPD, skills, multipliers and energy, scaled by the real HardLevelGroup curve. |
| Relic sets (20) | 12 Cavern (Passerby, Musketeer, Knight, Hunter, Champion, Guard, Genius, Band, Eagle, Thief, Messenger, Prisoner) + 8 Planar (Space Sealing Station, Fleet of the Ageless, Pan-Cosmic Commercial Enterprise, Belobog of the Architects, Inert Salsotto, Talia, Sprightly Vonwacq, Broken Keel) with real piece names and 2/4-piece effects encoded as data. |
| Schema (generic, data-driven) | Ability `params` tables with `{ param }` / `{ param, from }` references; custom resources (Charge, Hits Per Action); summons; new effects (`hpChange`, `insertAction`, `detonateDot`, `implantWeakness`, `breakDamage`, `revive`, `gainResource`, `applyRandomStatus`, `removeStatus`); damage `extraScaling` / `source` / `repeat` / `targetConditions`; new trigger events and conditions; modifier `scaling` and `negate`; HoT, CC delay-on-apply, ability replacement, toughness protection; multi-bar boss phases; the enemy level curve. See DATA_MODELS §14. |
| Script handlers | 85 handlers for mechanics generic effects can't express. Each is documented with its behaviour (`script-handlers/handlers.json`, DATA_SOURCES §4). The data registry rejects references to undocumented handlers, and the importer refuses to write them. Implementations arrive in Phase 5. |
| Removed | The original samples (Ignatius, Lyra/Aria, Brann, Seraphine, the original Light Cones, enemies, relic sets, statuses, items and banners) and every reference to them (tests, docs, quest, dialogue, loot). |
| UI | The Data Archive shows the real roster: floored Lv80 stats as in game, Taunt, memosprite/summon in the kit, a new **Relic Sets** tab, enemies sorted by rank with Lv80 HP/SPD, RES and debuff RES, and constant Light Cone values printed once. Visuals stay procedural/CSS. |
| Tests | `tests/data/reference.test.ts` pins real values. The template, kit-model, schema and content tests were moved to the real data. |

## 9. Phase 2: Player controller

Validator fixes first (Revision 2 scored 8.5/10, with 0 data mismatches):
- Cocolia's phase 2 now begins at **75% HP** (`restoreHpTo: 0.75`; the wiki says her Max HP is reduced by 25%).
- Welt's Skill Slow is rolled **on every hit** (new `damage.onHit`); his Skill is 1 hit on the target plus 2 random hits.
- The stale lyra/aria/brann ids in `formulas.test.ts` are renamed.

### 9.1 Architecture (spec §38)
| Piece | Where | Role |
|---|---|---|
| Data | `rules/locomotion/default.json`, `parties/default.json`, `levels/test-level.json`, `config/game.config.json -> camera.follow`, `input/default.json` | Gait speeds and strides, acceleration, turn rate, deadzone, capsule (radius, height, step, max slope, snap), gravity, interaction radius, the animation states, the party (March 7th, Dan Heng, Himeko, Welt), level colliders / interactables / spawn, follow-camera tuning, key and gamepad bindings |
| Schemas | `models/locomotion.ts` (+ 3 collections) | Validated at load: gait order, unique party members that must exist as characters, collider bounds, unique interactables |
| Simulation | `modules/player/` (`movement`, `collision`, `animation`, `party`, `interaction`, `controller`) | Pure and deterministic, no THREE or DOM. Unit-tested on the real level |
| Camera contract | `modules/camera -> ExplorationCamera` | The controller only needs `yaw`. The Phase-2 `FollowCamera` implements this contract; Phase 3 replaces it |
| Presentation | `app/scenes/TestLevelScene`, `PlaceholderCharacter`, `FollowCamera`; `modules/ui/screens/ExplorationHud` | Level meshes are generated from the collider data. A procedural low-poly figure is tinted by the leader's element. The HUD shows the party list, the right-side prompt list, the gait readout, toasts and a message box |
| Wiring | `app/states/TestSceneState` | Action map → `ControlInput` (keys, mouse, left/right stick). Fixed 1/60 s sub-steps. Events go to the bus and the HUD. The `window.__ASTRAL__.probes.exploration` probe serves the E2E test |

**Dependencies:** `player` depends only on core and data (input actions, data registry, event bus). `camera` (Phase 3) depends on `player`. Combat (Phase 5) will consume `player:overworldAttack` / `player:technique`, and audio (Phase 22) will consume `player:footstep`. Existing systems are unchanged apart from three things: the InputManager gained analog sticks (`stick()`), the debug handle gained `probes`, and the Phase-1 sandbox (orbit camera, input monitor) was replaced by the level.

### 9.2 What was built
- **Movement:** camera-relative WASD or left stick, with diagonals normalised and partial stick tilt kept. Running is the default (5 m/s). **Ctrl** toggles walking (2 m/s) and holding **Shift** sprints (7.5 m/s). Acceleration is 28 m/s² and deceleration 36 m/s². The character turns toward the move direction at up to 12.5 rad/s. There is no jump.
- **Collision:** a capsule (r 0.35 m, h 1.7 m) against axis-aligned boxes and ramps. It covers walls with sliding, a 0.35 m step-up (the stairs), slopes up to 46° (the east ramp at 18° is walkable, the 49° west ramp blocks), ground snapping within 0.45 m when walking down, gravity off ledges, and a respawn below the kill height. The 1.4 m corridor fits the capsule.
- **Party switching:** keys **1–4** switch between March 7th, Dan Heng, Himeko and Welt. Position, facing and momentum are kept, and the model re-tints to the new element with a pop.
- **Interaction:** **F** interacts with the selected prompt. The prompt list sits right of centre in the reference game's style: F on the selected row, nearest first, at most 3 visible, scrolled with the wheel or d-pad. The wheel zooms the camera only when no prompts are open. Interactables include signs, a chest placeholder and an NPC placeholder (Pom-Pom).
- **Hooks:** **E** fires the Technique hook (the toast shows the leader's real Technique name) and **Q** or left click fires the overworld attack hook. Both are stubs that emit events, with a 0.45 s cooldown. Footstep events alternate left/right at each gait's stride and carry the surface material.
- **Animation:** a data-driven state machine (idle / walk / run / sprint, with `clip` ids and blend times) drives a procedural bob, lean and arm/leg swing. Real clips can plug in by `clip` id.
- **Test level** "Calibration Grounds": a ramp and platform with a chest, 6-step stairs to a landing with an NPC, a too-steep ramp, perimeter walls, a narrow corridor, pillars, a crate and two signs.
- **Camera:** a basic follow camera. Hold the right mouse button to rotate, use Z/C or the right stick to turn, and the wheel or +/- to zoom. It follows with smoothing.

**Controls:**

| Action | Keyboard / mouse | Gamepad |
|---|---|---|
| Move | WASD / arrow keys | left stick |
| Sprint (hold) | Shift | RT |
| Walk / run toggle | Ctrl | L3 |
| Interact | F | A |
| Technique | E | Y |
| Attack | Q or left click | X |
| Switch character | 1–4 | — |
| Camera | hold right mouse, Z/C, wheel, +/− | right stick |
| Debug overlay | F3 | — |
| Back | Esc | B |

### 9.3 Tests and verification
- `tests/player/player.test.ts` (20 tests):
  - movement math: camera-relative input, deadzone, gait selection, acceleration and deceleration, turn rate
  - collision: ramp surfaces and slopes, wall push-out, steep-slope blocking, step-up vs platform
  - the data-driven animation selection and cross-fade
  - party switching rules and prompt list ordering / scrolling
  - the controller on the real level: run 5 / sprint 7.5 / walk 2 m/s, turning, ramp climb, stair climb, steep slope and wall blocking, corridor fit, falling off a ledge and landing, alternating footsteps with material, switching without moving, prompt + F, and Technique / attack hooks with cooldown
- **Playwright walkthrough** (`npm run screenshots`) at **1600×900** and **1280×720**:
  - walk up to the sign and check that the prompt row is shown and selected
  - press F and check that the message box opens
  - run and check 5 m/s in the run state; sprint and check 7.5 m/s in the sprint state
  - press 3 and check that Himeko leads, the slot is highlighted and the position is unchanged
  - press E and Q, and check that footstep, technique, overworld-attack, leader-changed and interact events reached the bus
  - layout checks at 1024×768 and 390×844
- **Results:** `npm run build` has 0 type errors. `npm test` passes **165/165** in 14 files. `npm run lint` reports 0 problems. `npm run screenshots` produces **33 screenshots** with 0 console errors and 0 layout problems.
- **Screenshots:**
  - `08-explore-01-spawn` … `08-explore-06-switch`, and `09-explore-debug`
  - `vp-1280x720-explore-01-spawn` … `-06-switch`
  - `vp-1024x768-explore` and `vp-390x844-explore`

### 9.4 Known gaps (by design or deferred)
- **Movement speeds are tuned to feel**, not verified against reference data. The datamine doesn't expose overworld speeds. They live in data and are easy to retune.
- **Collision is limited:** only axis-aligned boxes and ramps, with no rotated or mesh colliders. The capsule is treated as a vertical cylinder footprint, and there are no ceilings. That is enough for greybox levels; Phase 15 (world) brings authored geometry.
- **The follow camera** has no collision, auto-recentering or lock-on. Those come with the Phase-3 camera rig.
- **The overworld attack and Technique only emit events.** Encounter advantage, Technique Points and enemy ambushes arrive in Phase 5.
- **Party switching has no cooldown**, and the exploration model is a placeholder figure, not character art.
- **Touch controls are not implemented.** On phones the HUD lays out correctly, but movement needs a keyboard or gamepad.

## 10. What Phase 3 will add (Camera)

- One camera rig behind the `CameraSystem` / `ExplorationCamera` interfaces, with modes for exploration (orbit with collision against the level colliders, auto-recentering behind the character, zoom limits), combat, skill / ultimate shots, boss, dialogue and cinematic, plus smooth blends between modes.
- Data-driven camera shots referenced by ability `presentation.camera` ids, and camera shake.
- Tests for the orbit and collision math and mode blending, plus an E2E check that the camera never clips through the test level's walls.
