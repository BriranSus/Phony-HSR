# Phase 1 Report: Project Architecture

**Project:** Astral Rail, an original fan project inspired by the gameplay structure of *Honkai: Star Rail*
**Scope:** spec §39 "FIRST ACTION" (analysis, engine, stack, architecture, folders, data models, dependencies, roadmap) and **Phase 1** of §37
**Status:** Phase 1 complete (Revisions 1 and 2 each validated at 8.5/10) and Phase 2 validated at 8.5/10. **Phase 3 (Camera)** scored 7.5/10 and, after Revision 1, 8.5/10. **Phase 4 (World exploration) is complete** and awaiting validation, see [§11](#11-phase-4-world-exploration). Phase 5+ is not started.

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
| Camera contract | `modules/camera -> ExplorationCamera` | The controller only needs `yaw`. The Phase-2 follow camera implemented this contract; Phase 3 replaced it with the camera module |
| Presentation | `app/scenes/AreaScene` (was TestLevelScene), `PlaceholderCharacter`; `modules/ui/screens/ExplorationHud` | Level meshes are generated from the collider data. A procedural low-poly figure is tinted by the leader's element. The HUD shows the party list, the right-side prompt list, the gait readout, toasts and a message box |
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
| Attack | left click (Q removed in Phase 3, as on PC) | X |
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

## 10. Phase 3: Camera

Two validator fixes came first (Phase 2 scored 8.5/10):
1. **The overworld attack is left click only**, as on HSR PC. Q no longer attacks (input data, HUD hint, docs). The walkthrough asserts that Q does nothing and a left click attacks once.
2. **The camera can no longer end up behind the perimeter wall.** Validator screenshot p2-12 showed a black frame; this is solved by the exploration camera's collision (§10.2).

### 10.1 Architecture (spec §29, §38)
| Piece | Where | Role |
|---|---|---|
| Data | `camera/rules/default.json`, `camera/shots/gallery.json`, `levels/test-level.json -> markers, galleryStage` | Exploration tuning, per-mode blends and priorities, shake profiles and letterbox height. Six shot presets. Dummy units for the gallery |
| Settings | `config -> camera` (fov, orbitSensitivity, zoomSensitivity, invertY, autoRecenter, shakeIntensity, pointerLock) | Player preferences, shared with the future settings screen |
| Schemas | `models/camera.ts` (+ 2 collections) | Modes, easings, blends, shake profiles, anchors (unit / point / centroid / unit-toward-unit), keyframes and shots, all validated at load |
| Module | `modules/camera/`: `math`, `occlusion`, `exploration`, `shots`, `shake`, `director` | Pure and unit-tested. The app applies the output `CameraPose` to the scene camera |
| Wiring | `app/states/TestSceneState` | Builds `CameraInput` from the action map (right-mouse drag or pointer lock, Z/C, right stick, wheel, +/-). Runs the director every frame. Hosts the Camera Gallery (F4) and gates player input. Exposes a camera probe for E2E |

**Dependencies:** `camera` depends on `player` (turn math, collider surfaces, and the controller as follow target) and on data. Combat (Phase 5), dialogue (Phase 14) and cinematics play shots by id through `CameraDirector.playShot` and call `shake(profile)`. The player controller was not changed: `ExplorationProvider` implements the existing `ExplorationCamera` contract.

### 10.2 What was built
- **Director:** a priority stack, where the highest priority wins and the latest pushed wins ties.
  - Blends use the provider's `blendIn`, or its `blendOut` when it pops, otherwise the mode default from data. A blend is a curve plus a duration, or a cut.
  - Finished shots pop automatically and `playShot` resolves when they end.
  - It adds trauma shake (data profiles; strength = trauma², linear decay, scaled by `shakeIntensity`) and an animated letterbox.
  - `inputGated` is true while a scripted shot plays.
- **Exploration camera (HSR feel):** an orbit around the player's head.
  - **Controls:** yaw and pitch from right-mouse drag (or pointer lock), Z/C or the right stick. Pitch is clamped to -0.2…1.15 rad, zoom ranges 2.2–9 m and is smoothed, X recenters manually.
  - **Follow:** damping, plus a look-ahead in the direction of travel that only shifts the look target and fades out when the camera is pulled in.
  - **Auto-recenter:** after 2 s without camera input while the player moves, the camera gently swings behind them (toggle: `autoRecenter`).
- **Collision and occlusion:** every frame a sphere (r 0.3 m) is cast from the player's head toward the desired position against the level colliders.
  - The camera **pulls in instantly** and **eases back out** at 3 m/s.
  - If less than `comfortDistance` (1.5 m) is free (wall hug, corner), the camera **slides sideways**: it searches yaw offsets in 15° steps up to `yawSearchDeg` with a small pitch lift capped at `maxLiftPitch` (0.9 rad, well below vertical), and eases into the freest direction. It never goes closer than `minDistance` (0.9 m) unless the final line-of-sight guard has to pull it in.
  - The player is never hidden by level geometry. This is unit-tested with 360° spins at every wall, every corner and the validator's failing samples, and checked live in E2E (Revision 1).
- **Shots (data):** anchors resolve each frame to the player, level markers or interactables. Shots use keyframes with per-key easing, Catmull-Rom splines, FOV punch (60 ms attack, quadratic release), shake triggers, letterbox and blend overrides. The HUD chrome fades during letterboxed shots.
- **Camera Gallery (F4):**
  - **Staging:** it places the player in front of three dummy enemies, a boss dummy and a speaker dummy.
  - **Shots** (keys 1–6):
    1. Combat Overview
    2. Skill Close-up
    3. Ultimate (cut, FOV punch, shake, letterbox)
    4. Boss Intro (spline sweep, roar shake)
    5. Dialogue Two-shot (over-the-shoulder)
    6. Cinematic Flyover (spline path)
  - **Gating:** player input is gated while the gallery is open. Esc or F4 closes it and blends back to exploration.

**Controls:**

| Action | Keyboard / mouse | Gamepad |
|---|---|---|
| Rotate camera | hold right mouse (or move the mouse with `camera.pointerLock`), Z / C | right stick |
| Zoom | wheel (when no prompt list is open), + / − | — |
| Recenter | X | R3 |
| Camera Gallery | F4, then 1–6 to play shots, Esc / F4 to close | — |
| Attack (overworld) | **left click** | X |

All other controls are unchanged from Phase 2.

### 10.3 Tests and verification
- `tests/camera/camera.test.ts` has 15 tests:
  - orbit math, pitch/zoom clamps and zoom smoothing, sensitivity and invert Y
  - sphere cast vs the perimeter wall
  - no clipping behind or into the perimeter wall at 96 wall/corner poses, with line of sight checked
  - instant pull-in and eased recovery
  - recenter timing (no swing before the 2 s delay, a full swing after it, none with the setting off or the player still)
  - easing and blend interpolation, shake decay and intensity, shot evaluation with anchors and FOV punch
  - director priority, tie-breaking, popping, blend timing, cuts, letterbox, playing shots with gating and the return to exploration, and shake-intensity 0
- **Playwright walkthrough** at **1600×900** and **1280×720**. Besides the Phase-2 steps it checks:
  - **Attack:** Q doesn't attack and a left click attacks once.
  - **Walls:** the player stays visible while running along the east wall with the camera forced toward it and in the north-east corner. Visibility is sampled every 200 ms: the player's head projects on screen, the camera-to-head line isn't occluded, and the camera is inside the walls.
  - **Camera controls:** Z rotates, the wheel zooms out and X recenters.
  - **Gallery:** each of the 6 shots is captured, the mode is correct and player input is gated. The ultimate shows shake and letterbox. Esc returns to exploration.
- **Results:** `npm run build` has 0 type errors. `npm test` passes **180/180** in 15 files. `npm run lint` reports 0 problems. `npm run screenshots` produces **51 screenshots** with 0 console errors and 0 layout problems.
- **Screenshots** (in `docs/screenshots/`):
  - `08-explore-07-wall`, `-08-corner`, `-09-rotate-zoom`, `08-explore-gallery-1-combat` … `-6-cinematic`
  - the same set as `vp-1280x720-explore-*`
  - `vp-1024x768-explore`, `vp-390x844-explore`

### 10.4 Known gaps
- **Walls are not faded**; the camera slides around them instead. The character mesh fades when the camera is closer than about 1.1 m (Revision 1).
- **Collision is a marched sphere cast** against the axis-aligned colliders (boxes and ramps). Arbitrary meshes arrive with authored geometry in Phase 15.
- **Shots are previewed against dummies only.** Real combat, dialogue and cinematic triggers come in Phases 5, 14 and later. Ability `presentation.camera` ids are not mapped to shots yet.
- **No camera settings UI yet.** The settings live in config and the settings screen is Phase 21. Pointer lock is off by default.
- **E2E visibility is geometric**, not pixel-based: it uses projection plus a line-of-sight test, because the WebGL buffer isn't preserved for readback.

### 10.5 Phase 3 – Revision 1 changelog
The validator scored Phase 3 at 7.5/10. Fixes:

1. **Wall-hug and corner collapse.**
   - The old pitch lift could reach almost vertical and collapse the camera to about 0.2 m. It is replaced with a yaw-offset search (15° steps, both directions, up to 150°) combined with a lift capped at 0.9 rad. Offsets ease in at 7/s and snap only if the eased direction would be squeezed below the minimum.
   - New collision rules in `camera/rules/default.json`: `minDistance` 0.9, `comfortDistance` 1.5, `yawSearchDeg` 150, `maxLiftPitch` 0.9 (schema-validated).
   - The pivot lag behind the head is capped at 0.12 m, and the look-ahead fades out as the camera pulls in, so the focus stays in frame.
   - New tests: 360° spins at 4 walls, 4 corners and the 5 reported samples ((23.05, 17.79), (23.05, 1.59), (-23.03, -12.95), (-22.95, 1.21), and the ramp at (-19.14, 6.41)). Every frame asserts the head is in the frustum, the line of sight is clear, the camera is inside the walls and the distance is at least the minimum. A separate test checks for at least 1.2 m of usable distance at the east wall.
2. **Occluded at full zoom beside the west landing.** The cast now starts from the tightly lagged pivot. A final guard checks the line from the camera to the **actual head** (the same point the probe validates) and pulls in along that ray if it is blocked. There is a regression test at (-4.9, -7.25) at 9 m.
3. **Dialogue two-shot and shake.**
   - The speaker dummy now renders as the Pom-Pom-style NPC (capsule body, head with a simple face, ears) and faces the listener.
   - The shot is a tight over-the-shoulder mid-shot (FOV 30→28) on the speaker's face, with the listener's shoulder as a thin frame edge.
   - Shake profiles now decay more slowly (ultimate: trauma 1.0, decay 0.75; boss roar: 0.8, 0.7), so the shake is visible for about 1.3 s instead of about 0.6 s.
   - The probe exposes `shakePeak`, `roll` and `rollPeak`. The unit test asserts shake on more than 60% of the frames after the trigger. E2E asserts peak trauma > 0.5 and roll > 0.002 rad for both the Ultimate and Boss Intro shots.
4. **Nice-to-haves.**
   - The gallery panel hides while a shot plays (asserted in E2E).
   - The character fades when the exploration camera is closer than about 1.1 m (opacity floor 0.15). Shaders recompile only when the blend mode flips.
5. **E2E additions.**
   - 13 spots (walls, corners and the regression samples), each spun 360° with Z. Every sample asserts the player is on screen, not occluded, the camera is inside the walls and the distance is at least 0.75 m.
   - The west landing at full zoom.
   - New screenshots: `08-explore-07b-wall-hug` and `-08b-landing-zoom`. The spin sweep runs once at 1600×900 and only samples freshly rendered frames after a teleport has settled.
6. **Results:** `npm run build` has 0 errors. `npm test` passes **196/196** in 15 files. `npm run lint` reports 0 problems. `npm run screenshots` passes with **55 screenshots**, 0 console errors, 310 spin samples and peak trauma 0.99 (Ultimate) and 0.79 (Boss).
7. **Known gap:** in the dialogue shot the listener's shoulder takes about 25% of the frame at the right edge, slightly more than the 15–20% target.

## 11. Phase 4: World exploration

Two validator fixes came first (Phase 3 scored 8.5/10):
1. **The area title is hidden with the rest of the HUD during letterboxed shots.** Root cause: the title's entrance animation used `fill-mode: both`, whose forwards fill pinned `opacity: 1` over the cinematic rule. It now uses `backwards`, and the cinematic class is applied as soon as the letterbox starts.
2. **The dialogue two-shot is tightened** so the listener's shoulder is a thin edge. The speaker marker moved so the background is clean (the ramp behind it had been read as part of the shoulder), and the shot is a mid-shot on the speaker's face. A unit test projects the vertices of the real placeholder figure with a THREE camera, ignores what the letterbox bars cover, and asserts that the listener takes 15–20% of the frame width at five times across the shot with the speaker's face inside the middle of the frame.

### 11.1 Architecture (spec §13, §14, §38)
| Piece | Where | Role |
|---|---|---|
| Data | `worlds/*.json`, `levels/*.json`, `rules/world/default.json`, `config -> world.startWorld` | World -> regions -> areas; per-area geometry, spawns, objects, puzzles, hidden areas, enemy spawns; overworld tuning |
| Schemas | `models/world.ts` (+ `worlds`, `worldRules` collections; `levels` extended) | Object kinds (discriminated union), requirements, puzzles, hidden areas, enemy spawns, world rules, serialisable `WorldStateData`. Local references are checked per file, item / enemy / area references by the registry |
| Module | `modules/world/`: `objects`, `puzzles`, `enemies`, `encounter`, `state`, `graph`, `progress`, `runtime`, `events`, `session` | Pure TypeScript, no rendering or DOM. `WorldRuntime` is the one object the app drives |
| Rendering | `app/scenes/AreaScene.ts`, `app/scenes/WorldObjects.ts` | One `AreaScene` per loaded area (colliders, sky). `WorldObjectsView` draws objects, enemies and hidden-area veils from the runtime's state; props fade near the camera |
| Wiring | `app/states/TestSceneState.ts` | Feeds the runtime the player pose and the F / attack / Technique actions, rebuilds the area behind the transition overlay, owns the anchor list and encounter overlay, exposes a `world` probe and a debug-overlay section |
| HUD | `modules/ui/screens/ExplorationHud.ts`, `DebugOverlay.ts` | Area name banner, exploration percentage, toast stack, Space Anchor list, encounter overlay, event log |

**Dependencies:** `world` depends on `player` (controller, collision world, prompt list) and `camera` (line of sight for enemy detection). The controller gained only `setInteractables` and `setSpawn`; the camera rig shares the runtime's live collider list, so opened gates and moved crates change what it avoids. Quest (Phase 13), inventory (Phase 12) and the map (Phase 15) consume the `world:*` events and `WorldState` without any change to world code.

**Spec §38:** there is one interactable implementation (the Phase 2 `interactables` field is now the typed object list, so the prompt list, controller and world share it), one collider list, and one place for each rule. Nothing about content is in code: a new area, object kind combination, puzzle or world is JSON.

### 11.2 What was built
- **Interactable framework.** Generic typed objects with `requires` clauses (puzzle solved, object state, key item, hidden area found) and state machines, plugged into the F prompt list. Kinds:
  - `sign`, `npc` (emits `world:npcTalked`, shows the message box; the dialogue system is Phase 14)
  - `chest` (opens once, rewards from data), `collectible` (pickups, counted)
  - `breakable` (left click; can remove a wall collider and reveal a hidden area)
  - `switch`, `plate`, `crate` (pushed on a grid; plates are held by the player or a crate), `gate` (opens when its requirements hold, or by F for key doors and the one-way shortcut)
  - `anchor`, `portal`
- **Puzzles (2).** *Elemental Sequence* (3 switches in order; a wrong press resets them and emits `puzzleFailed`) opens a gate to a chest with the Camp Pass. *Twin Plates* (crate on one plate, the player on the other) opens a vault. Both grant rewards and unlock through the generic requirement system.
- **Hidden areas (2).** The Starlit Alcove is found by walking into it (discovered on enter, veil fades in over `hiddenFadeSeconds`). The Annex Nook is found by breaking a cracked wall. Objects inside only exist once discovered.
- **Space Anchors and portals.** Interacting activates an anchor and opens a travel list of every activated anchor in the world (W/S, F or click, Esc). Portals and anchor travel run the transition overlay, load the target area from data and keep the party and world state. A key-gated portal needs the Camp Pass.
- **World graph.** `world.astral-demo`: 2 regions (Astral Express, Jarilo-VI) and 3 areas (Calibration Grounds, Observation Deck, Snowfield Camp). `validateWorldGraph` checks portal targets and arrival spawns at load (the loading screen shows a fatal screen on failure).
- **Exploration progress.** Per area: chests, collectibles, puzzles and anchors found; percent = found / total, floored. Regions and the world aggregate by counts. Shown in the HUD and the debug overlay; `world:progressChanged` fires on change.
- **Enemies.** Spawns from data using the real roster (Silvermane Soldier, Frostspawn, Automaton Beetle). AI states: idle / patrol / alert / chase / return / stunned, with a detection radius and FOV cone plus a close radius, line of sight, lose-radius timer and home return. Contact or the overworld attack starts an encounter carrying the group and the advantage: player strike (attack on an unaware or stunned enemy), neutral (attack on an aware enemy, frontal contact), ambush (contact from behind the player's facing). A placeholder "Encounter started" overlay returns to exploration, counting the group as defeated. The Technique (E) stuns enemies in range. Respawn per spawn or default: `timer`, `reenter` or `never`.
- **Events.** 17 typed `world:*` events (area-entered, npc-talked, chest-opened, item-collected, puzzle-solved / failed, hidden-area-discovered, anchor-activated, teleported, enemy-detected, encounter-started / ended, enemy-defeated, technique-used, progress-changed, object-changed, locked). The runtime keeps a ring-buffer log that the debug overlay (F3) shows.
- **World state.** `WorldState` is plain, id-keyed JSON with `version`; `toJSON` / `fromJSON` validate with Zod, reject unknown versions and have a migration table. An in-memory session keeps it while the scene is left and re-entered, until the Phase 21 save system.
- **Level loading.** `enterArea` streams area JSON into the live colliders, objects, enemies and spawns and unloads the previous area (persisted states re-applied: open gates, broken walls, moved crates).

**Controls** (additions; the rest is unchanged):

| Action | Keyboard / mouse | Gamepad |
|---|---|---|
| Interact (chests, switches, crates, anchors, portals, signs, NPCs) | F | A |
| Break objects / start an encounter | left click | X |
| Technique (stun nearby enemies) | E | Y |
| Anchor list: select / travel / close | W, S / F or Enter / Esc | n/a |
| Return from the encounter placeholder | Enter, F or Esc | n/a |
| Debug overlay (world progress, event log) | F3 or ` | n/a |

### 11.3 Tests and verification
- `tests/world/world.test.ts` has 42 tests:
  - state machines for every object kind, requirement clauses and which objects leave the prompt list
  - puzzle logic (order, wrong-press reset, plates held together)
  - world-graph validation: broken area, portal and spawn references fail; level files reject unknown puzzle, collider, hidden-area and spawn references and duplicate ids
  - exploration percentage math, aggregation and the empty-area case
  - WorldState JSON round-trip, version and schema rejection, restore into a new runtime
  - encounter advantage rules and the attack cone
  - enemy AI transitions: detection cone, close radius, line of sight, alert -> chase -> contact, lose and return, patrol pauses, stun
  - runtime flows: chest once, collectibles, order puzzle -> gate -> key item -> portal, one-way shortcut, hidden-area discovery with fade, cracked wall, plate / crate puzzle, anchors across areas, state kept across transitions, NPC event, encounters (strike, ambush, neutral, Technique stun), respawn by timer / re-entry / never
- **Playwright walkthrough** at **1600x900** and **1280x720** (`scripts/worldWalkthrough.mjs`, real keys and mouse): opens a chest and checks the reward and that it cannot reopen; fails then solves the order puzzle; discovers the alcove and watches the veil fade; activates an anchor; takes a portal with state kept (items, party leader, visited); solves the plate / crate puzzle; breaks the cracked wall with left clicks; teleports between anchors; enters the Snowfield with the Camp Pass; gets detected, is ambushed from behind, then stuns with E and strikes with left click (checking group and advantage in the overlay); and asserts the exploration percentage rises after each step.
- **Results:** `npm run build` has 0 type errors. `npm test` passes **239/239** in 16 files. `npm run lint` reports 0 problems. `npm run screenshots` produces **71 screenshots** with 0 console errors and 0 layout problems. Phases 1 to 3 are unchanged: their unit tests and walkthrough steps (including the 13-spot camera spin sweep on the extended level) pass.
- **Screenshots** (in `docs/screenshots/`): `08-explore-10-chest`, `-11-puzzle`, `-12-hidden`, `-13-anchors`, `-14-deck`, `-15-plates`, `-16-snowfield`, `-17-encounter`, the same set as `vp-1280x720-explore-*`, and `08-explore-gallery-5-dialogue` for the tightened two-shot.

### 11.4 Known gaps
- **Combat is a placeholder.** An encounter returns to exploration and counts as a victory. Real combat, results and loot arrive in Phase 5 and 7; the encounter event already carries the group and advantage.
- **Items are only granted to `WorldState.items`.** The inventory and economy (Phase 12) take over from `world:itemCollected`. There is no inventory UI yet.
- **Dialogue is a message box.** NPCs emit `world:npcTalked`; branching dialogue and quests are Phases 13 and 14.
- **The anchor list is a simple list.** The real map with markers, filters and regional views is Phase 15.
- **Collision and enemies use axis-aligned geometry.** Enemies avoid walls by sliding, with no navmesh; arbitrary meshes arrive with authored geometry (Phase 15).
- **No autosave.** World progress persists in memory while the app runs; the save system (Phase 21) persists the same JSON.
- **Props have no colliders.** Chests, anchors and crates (other than the pushable crate) do not block the player or camera; the camera fades them when it is close.

## 12. What Phase 5 will add (Combat engine)

- `BattleState`, the action-value timeline, Skill Points, Ultimates, inserted actions and the effect interpreter, fed by the `world:encounterStarted` event (enemy group and advantage), and returning the result that replaces the placeholder overlay.
