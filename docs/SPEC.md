# HONKAI: STAR RAIL — FULL GAME RECREATION / FAN PROJECT

Build a playable fan-made recreation inspired by the gameplay structure and systems of **Honkai: Star Rail**.

The objective is to reproduce the **overall gameplay experience and system architecture** as closely as technically possible while using original/placeholder assets where copyrighted assets cannot be provided.

Do not simplify the project into a basic turn-based RPG demo.

The project should progressively implement the following major systems.

---

## 1. CORE GAMEPLAY

Implement the core loop:

EXPLORE → ENCOUNTER → TURN-BASED COMBAT → REWARDS → CHARACTER PROGRESSION → EQUIPMENT → STORY → NEW AREAS → ENDGAME.

The game should support:

* Third-person exploration
* Interactable environments
* NPCs
* Dialogue
* Quests
* Treasure/collectibles
* Enemy encounters
* Turn-based combat
* Character switching
* Party composition
* Character progression
* Equipment
* World progression
* Story progression
* Endgame content

---

# 2. TURN-BASED COMBAT

Recreate the fundamental combat structure associated with Honkai: Star Rail.

Implement:

* Party-based combat
* Turn order
* Action values
* Speed
* Basic ATK
* Skill
* Ultimate
* Talent/passive mechanics
* Technique
* Skill Point system
* Energy/Ultimate charging
* Enemy targeting
* Ally targeting
* Single-target attacks
* Blast attacks
* AoE attacks
* Follow-up attacks
* Counters
* Shields
* Healing
* Buffs
* Debuffs
* Damage-over-time
* Crowd control
* Enemy toughness
* Weakness types
* Weakness Break
* Break Effect
* Resistance
* Damage calculation
* Critical Hit
* Critical Damage

Combat must be strategic and support complex interactions between characters.

---

# 3. ELEMENT SYSTEM

Implement the game's elemental/weakness structure:

* Physical
* Fire
* Ice
* Lightning
* Wind
* Quantum
* Imaginary

Implement:

* Enemy weaknesses
* Elemental damage
* Toughness reduction
* Weakness Break
* Break effects
* Resistance
* Element-specific status effects

Ensure the system supports different character kits interacting with weaknesses.

---

# 4. CHARACTER SYSTEM

Create a complete character framework.

Every playable character should support:

* Level
* Ascension
* Rarity
* Element
* Path
* Base stats
* Growth stats
* Basic ATK
* Skill
* Ultimate
* Talent
* Technique
* Traces
* Eidolons
* Character-specific mechanics
* Animations
* VFX
* SFX
* Voice hooks

The architecture must allow additional characters to be added without rewriting the combat engine.

---

# 5. PATH SYSTEM

Implement the combat role/path framework:

* Destruction
* Hunt
* Erudition
* Harmony
* Nihility
* Preservation
* Abundance
* Remembrance
* Other applicable paths introduced through future content

Each Path should influence the character's combat identity.

---

# 6. TRACE SYSTEM

Implement a character progression tree containing:

* Major Traces
* Minor stat nodes
* Skill upgrades
* Talent upgrades
* Ultimate upgrades
* Basic ATK upgrades
* Technique upgrades
* Character-specific unlock conditions

Support:

* Level requirements
* Ascension requirements
* Material requirements
* Currency requirements

---

# 7. EIDOLON SYSTEM

Implement character duplicate progression.

Support:

* E1–E6
* Eidolon unlocks
* Character-specific passive modifications
* Stat/skill improvements

---

# 8. LIGHT CONE SYSTEM

Implement Light Cones.

Each Light Cone should have:

* Rarity
* Level
* Ascension
* Path compatibility
* Base stats
* Secondary stats
* Passive ability
* Superimposition
* Enhancement
* Materials
* Equip/unequip

Only characters with the correct Path should be able to use the appropriate Light Cone.

---

# 9. RELIC SYSTEM

Implement a complete relic/artifact system.

Support:

* Relic sets
* Equipment slots
* Main stats
* Substats
* Rarity
* Levels
* Enhancement
* Set bonuses
* Randomized stats
* Relic locking
* Relic comparison
* Relic filtering
* Relic sorting
* Relic salvage

Implement the appropriate relic slots and planar equipment structure.

---

# 10. CHARACTER BUILD SYSTEM

Players should be able to create different builds through:

* Character level
* Traces
* Eidolons
* Light Cones
* Relics
* Planar equipment
* Main stats
* Substats
* Team composition
* Buff/debuff synergy

---

# 11. ENEMY SYSTEM

Implement:

* Normal enemies
* Elite enemies
* Bosses
* Weekly bosses
* Story bosses
* Event enemies

Enemies should support:

* Level
* Stats
* Elements
* Weaknesses
* Toughness
* Skills
* AI
* Buffs
* Debuffs
* Phases
* Summons
* Special mechanics
* Loot tables

---

# 12. BOSS SYSTEM

Create multi-phase boss encounters.

Support:

* Phase transitions
* Unique mechanics
* Special attacks
* Summons
* Environmental mechanics
* Toughness mechanics
* Cinematic attacks
* Enrage mechanics
* Boss-specific UI
* Unique music

Bosses should not simply be enemies with extremely high HP.

---

# 13. EXPLORATION

Implement explorable areas inspired by the structure of Star Rail's worlds.

Support:

* Walking
* Running
* Interacting
* NPC conversations
* Containers
* Treasure
* Puzzles
* Hidden areas
* Enemy encounters
* Quest objectives
* Environmental objects
* Teleport points
* Area transitions

---

# 14. WORLD SYSTEM

Implement multiple interconnected regions.

Each region should support:

* Map
* Subareas
* NPCs
* Enemies
* Quests
* Treasure
* Puzzles
* Shops
* Teleport points
* Story events
* Collectibles

Create the architecture so additional worlds can be added later.

---

# 15. QUEST SYSTEM

Implement:

### Main Missions

### Adventure Missions

### Companion Missions

### Daily Missions

### Event Missions

### Tutorial Missions

Support:

* Objectives
* Quest states
* Prerequisites
* Rewards
* Dialogue
* Markers
* Navigation
* Cutscenes
* Branching states

---

# 16. DIALOGUE SYSTEM

Implement cinematic dialogue:

* Character portraits
* Character expressions
* Dialogue choices
* NPC dialogue
* Quest dialogue
* Camera control
* Voice-over hooks
* Text animation
* Dialogue history
* Skip
* Auto-play
* Fast-forward

---

# 17. MAP

Create an interactive map system.

Support:

* World map
* Region map
* Area map
* Teleport points
* Quest markers
* Treasure markers
* NPC markers
* Shops
* Enemy locations
* Exploration percentage
* Map filters

---

# 18. INVENTORY

Implement:

* Materials
* Consumables
* Quest items
* Relics
* Light Cones
* Character resources
* Currency
* Event items

Support:

* Search
* Filtering
* Sorting
* Locking
* Item details
* Item usage
* Item enhancement

---

# 19. GACHA / WARP SYSTEM

Implement a Warp-style character acquisition system.

Support:

* Character banners
* Light Cone banners
* Limited banners
* Permanent banner
* Pull animations
* Single pull
* Ten pull
* Pity
* Guaranteed mechanics
* Featured character
* Featured Light Cone
* Pull history
* Currency
* Results screen

The probability calculations must be server-authoritative if online functionality exists.

---

# 20. CURRENCY

Implement multiple currencies/resources.

Examples:

* Stellar Jade-style premium currency
* Credits
* Character EXP materials
* Light Cone EXP materials
* Relic EXP materials
* Ascension materials
* Trace materials
* Event currencies

Keep economy calculations centralized.

---

# 21. SIMULATED UNIVERSE / ROGUELIKE MODE

Implement a roguelike combat mode inspired by the game's major roguelike content.

Support:

* Randomized encounters
* Random rewards
* Blessings
* Curios
* Events
* Elite enemies
* Bosses
* Multiple routes
* Temporary upgrades
* Run progression
* Difficulty levels
* Weekly rewards

Architecture should allow additional roguelike modes.

---

# 22. ENDGAME MODES

Implement challenging repeatable modes such as:

* Memory-style stages
* Multi-wave combat
* Boss challenges
* High-difficulty stages
* Timed challenges
* Score-based challenges
* Weekly rotations

Support stars/score/rating and reward tiers.

---

# 23. DAILY SYSTEM

Implement:

* Daily missions
* Daily training
* Login rewards
* Resource farming
* Daily resets
* Weekly resets
* Activity points
* Weekly objectives

---

# 24. EVENTS

Create an event framework supporting:

* Limited-time events
* Event stories
* Event maps
* Event currencies
* Event shops
* Combat events
* Minigames
* Puzzle events
* Challenge stages
* Event rewards

Events must be modular.

---

# 25. ACHIEVEMENTS

Implement:

* Combat achievements
* Exploration achievements
* Character achievements
* Story achievements
* Collection achievements
* Hidden achievements
* Event achievements

Include:

* Progress
* Completion state
* Rewards
* Categories

---

# 26. SOCIAL / ACCOUNT SYSTEM

If online infrastructure is available, implement:

* Account
* Player profile
* Friend system
* Friend list
* Player UID
* Support character
* Player showcase
* Profile customization

---

# 27. UI

Create a polished anime sci-fi RPG interface.

Required screens:

* Main menu
* Character
* Party
* Inventory
* Light Cone
* Relics
* Traces
* Eidolons
* Warp
* Missions
* Map
* Achievements
* Events
* Shop
* Mail
* Friends
* Profile
* Settings
* Combat HUD
* Dialogue
* Tutorial

Use smooth transitions and animated UI.

---

# 28. COMBAT UI

Display:

* Party HP
* Energy
* Skill Points
* Turn order
* Enemy HP
* Toughness
* Weaknesses
* Buffs
* Debuffs
* Action buttons
* Ultimate indicators
* Target selection
* Damage numbers
* Combat messages

---

# 29. CAMERA

Implement:

* Exploration camera
* Combat camera
* Skill camera
* Ultimate camera
* Boss camera
* Dialogue camera
* Cinematic camera

Use smooth transitions.

---

# 30. ANIMATION

Support:

* Exploration
* Idle
* Walking
* Running
* Combat idle
* Basic attack
* Skill
* Ultimate
* Hit reaction
* Knockdown
* Death
* Victory
* Dialogue
* Cinematics

---

# 31. VFX

Implement:

* Elemental effects
* Weakness Break
* Skills
* Ultimates
* Buffs
* Debuffs
* Shields
* Healing
* Damage
* Environment effects
* UI effects

---

# 32. AUDIO

Support:

* Background music
* Combat music
* Boss music
* Character voice
* NPC voice
* Skill SFX
* UI SFX
* Environmental audio
* Footsteps
* Ambient sound

---

# 33. SAVE SYSTEM

Save:

* Character progression
* Inventory
* Equipment
* Currency
* Quest progress
* Exploration
* Achievements
* Settings
* Account progression

---

# 34. SETTINGS

Include:

* Graphics
* Resolution
* Quality
* FPS
* Audio
* Voice
* Subtitles
* Controls
* Key rebinding
* Controller
* Accessibility
* Language
* Camera settings

---

# 35. PERFORMANCE

Optimize for:

* Stable FPS
* Fast loading
* Memory usage
* Asset streaming
* Object pooling
* LOD
* Occlusion
* Efficient UI
* Efficient AI
* VFX optimization

---

# 36. ARCHITECTURE

Use a scalable architecture.

Separate:

* Combat
* Characters
* Enemies
* Skills
* Status effects
* Inventory
* Relics
* Light Cones
* Quest
* Dialogue
* World
* UI
* Audio
* VFX
* Save
* Economy
* Gacha
* Events
* Endgame

Avoid monolithic classes.

Use data-driven systems wherever possible.

---

# 37. DEVELOPMENT ORDER

DO NOT generate the entire game in one response.

Build sequentially:

1. Project architecture
2. Player controller
3. Camera
4. World exploration
5. Combat engine
6. Character framework
7. Enemy framework
8. Weakness system
9. Character progression
10. Light Cones
11. Relics
12. Inventory
13. Quest system
14. Dialogue
15. World/map
16. UI
17. Gacha/Warp
18. Events
19. Roguelike mode
20. Endgame
21. Save system
22. Audio
23. VFX
24. Optimization
25. QA
26. Final polish

---

# 38. DEVELOPMENT RULE

For every phase:

1. Explain the architecture.
2. Identify dependencies.
3. Implement the system.
4. Test it.
5. Fix errors.
6. Refactor.
7. Verify that existing systems still work.
8. Only then move to the next phase.

Never replace working systems with temporary hacks.

Never create duplicate implementations.

Never hardcode data that should be configurable.

---

# 39. FIRST ACTION

Before writing gameplay code:

1. Analyze this entire specification.
2. Select the appropriate engine.
3. Explain the technology stack.
4. Create the project architecture.
5. Create the folder structure.
6. Define the core data models.
7. Define system dependencies.
8. Create the development roadmap.

Then implement **Phase 1 only**.

Do not proceed to later phases until Phase 1 has been validated.

The final result should progressively become a highly detailed playable recreation/fan project of the overall Honkai: Star Rail gameplay structure rather than a small proof-of-concept.
