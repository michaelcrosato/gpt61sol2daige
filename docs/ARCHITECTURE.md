# Architecture

Fern is a single TypeScript repository with a browser-independent simulation. Its solo physics playground uses the official Rapier2D JavaScript/WASM package behind a local adapter. There is no imported game engine, scene editor, rendering framework, artwork pack or audio pack. Adventure actors and ambient wildlife retain the existing solver until their physics milestones.

```text
JSONL / browser commands ─── AgentRuntime ─── Simulation (60 Hz)
                                                │
                           World generation ────┤
                           Spatial hash/physics ┤
                           Quest and players ───┤
                           Adventure/builds ────┤
                                                │
                      checkpoints/replays ◄─────┼────► binary network snapshots
                                                │
                                Canvas 2D ◄─────┴────► procedural Web Audio
```

## Ownership and modules

| Module | Owns | Must not depend on |
| --- | --- | --- |
| `src/engine/math.ts` | Integer coordinate hashes, smooth noise, checksums | DOM, network, wall-clock randomness |
| `src/engine/world.ts` | Seeded terrain, tile patches, bounded chunk cache | Camera, renderer, mutable RNG |
| `src/engine/physics.ts` | Spatial buckets, circle impulses, static contacts, swept substeps | Game UI or audio |
| `src/physics/bootstrap.ts` | Shared async Rapier initialization, readiness and caller cancellation | DOM, network |
| `src/physics/runtime.ts` | Rapier world/queue, stable body IDs, solved transforms, contacts and validated playground snapshots | DOM, renderer, transport |
| `src/physics/policies.ts` | Validated land/area/region profiles, revisions, transaction queue, resolution and provenance | DOM, Rapier handles, transport |
| `src/app/physics-ui.ts` | Solo lab controls and real body/collider drawing | Ownership of Rapier handles |
| `src/engine/simulation.ts` | Fixed-step state, NPC arrays, players, shared quest, checkpoints | Browser or transport |
| `src/engine/agent.ts` | Validated commands, observation and replay | Browser or filesystem |
| `src/game/content.ts`, `skills.ts`, `loot.ts` | Area recipes, modular registries, skill gates and item rolls | DOM, transport, mutable RNG |
| `src/game/adventure.ts`, `validation.ts` | Combat, AI, mechanics, progression, town services and bounded state validation | Browser, rendering or wall clock |
| `src/net/protocol.ts` | Bounded packet validation and binary snapshots | PeerJS, DOM |
| `src/net/coop.ts` | Connection lifecycle, host authority, input and snapshot delivery | World generation decisions |
| `src/render/` | Camera, interpolation, culling, terrain caches, procedural sprites | Simulation ownership |
| `src/audio/` | Pure sample synthesis and browser playback adapter | Simulation timing decisions |
| `src/main.ts` | Input, UI, frame accumulator and adapters | New physics rules |
| `tools/` | JSONL entry point, reproducible asset exporters, benchmarks | Hidden editor state |

## Coordinate and time model

One world unit is one base-art pixel. Tiles are 16 units and chunks are 16×16 tiles. Collision and simulation coordinates use world units. Tile brush coordinates explicitly use tiles, so `tx:10` starts at world x=160. The nominal world square spans ±16,000,000 units; bodies are clamped slightly inside that bound. Chunk coordinates use mathematical floor, including negative positions.

Simulation targets 60 fixed ticks per second. Browser frame deltas feed an accumulator capped at five ticks, with a maximum accepted frame delta of 100 ms. A measured 12 ms stepping budget chooses one to five ticks per frame, keeping controls responsive under heavy populations. Overload slows simulation rather than inventing a variable timestep or accumulating an unbounded backlog; settings and benchmarks expose actual simulation ticks/second as well as rendered FPS. Frame interpolation is presentation-only. Node tools advance an explicit tick count. Float64 positions preserve precision over large travel distances. Velocities live in Float32 arrays. Determinism is verified in the supported Node/Chrome environment; bit-identical trigonometry across unrelated JavaScript engines is not promised.

## Streaming and lifetime

Terrain is a pure function of seed and tile coordinates, with a small validated patch layer. Request order cannot change content. The simulation's LRU retains at most 1,024 chunks; each chunk contains three 256-byte arrays for terrain, decoration and variant. That is 768 KiB of raw tile data at capacity, excluding map/object overhead. Drawing retains at most 96 256×256 terrain canvases (24 MiB of uncompressed RGBA pixels, excluding browser overhead). If too many chunks would be visible for that cache, rendering selects a coarse terrain representation instead of thrashing it.

NPC storage is a fixed pool of 65,536 slots. Positions, previous positions, velocities, species, attunement and generation use typed arrays. Each creature slot has a stable party anchor. Populations above 8,192 per occupied party region expand their spawn radius with the square root of population, avoiding an ever-denser physics hotspot. Nearby travelers share a region for density budgeting; additions distribute across party anchors. Recycling distance is the larger of 2,200 units or 1.7× the spawn radius, with work staggered over 60 ticks. Generation increments and placement is deterministic. This is active-world population streaming, not a persistent biography for every creature in the coordinate space.

Collected crystal coordinates, lit beacons and terrain patches survive unloading and checkpointing. The edited-tile layer has an explicit 2,048-tile limit. There is no global ever-growing cache of terrain or sprite objects.

## Physics and creature behavior

The spatial hash uses fixed head/next/cell arrays, 24-unit cells, and a power-of-two bucket count scaled to capacity (131,072 buckets for 65,536 slots). Neighbor queries verify cell coordinates after hashing, preventing collisions in the hash table from returning unrelated or duplicate cells. Contact traversal follows deterministic ID and distance-tier rules. Circle response includes inverse-mass separation and an impulse with restitution. Players also collide with one another. Creature encounters are intentionally non-blocking for travelers; pulses provide the physical interaction with wildlife.

Static collision handles deep-water tile rectangles, tree trunks and rocks. Motion is subdivided according to distance and radius, so a fast dash cannot skip a one-tile wall. Shallow water reduces player speed. Dash consumes spirit and has a cooldown; spirit regenerates. Pulse applies radial forces and attunes nearby wisps once per active lifetime. Combat adds separate enemy/player and enemy/enemy contacts, stagger, knockback and dodge invulnerability; ambient wildlife remains non-blocking.

Creatures within 420 units of a player retain full-rate steering and contacts. Far steering runs every fourth tick. Above 8,192 total creatures, distant static and creature contacts run every eighth tick; below that threshold, static contacts run every fourth tick and creature contacts run every tick. All positions integrate each fixed tick. Thus distant contact frequency is nominally 7.5 Hz at large populations, while nearby gameplay retains 60 Hz physics when the machine sustains the target tick rate. Wisp drift, beetle wandering and deer avoidance use deterministic functions of tick, seed and ID. No simulation decision reads real time.

## Adventure and modular content

`Simulation.adventure` owns the complete run and advances after player movement on the same fixed tick. Its state includes every hero's XP, level, gold, skill ranks, equipment, inventory, timed buffs, health, flasks and cooldowns; it also includes all encounter actors, projectiles, loot, mechanics, delayed effects and event counters. Saves and replay hashes cover these fields. Skill points plus allocated ranks must equal level plus two. Derived stats recompute from base growth, skill ranks, equipped affixes, legendary powers, timed buffs and live tuning.

The first eight recipes introduce one named mechanic each. Subsequent recipes combine a signature mechanic with secondary mechanics and explicit effect links. No gate requires a mechanic activation: regular kills summon the warden and its death unlocks travel. Six AI behaviors choose pursuit, charging, ranged fire, orbiting, summoning or guarding, with telegraphed windups and per-enemy seeded parameters. Bosses add rotating attacks and a half-health phase change. Melee has a three-hit combo; Whorl, Thornlance and Bloom Nova have independent costs/cooldowns. Echo effects preserve the original ability and aim across checkpoint continuation.

Each land contains a town and four connected encounter clearings. Generated layout rules alter terrain/obstacles while retaining entrances and exits. All four clearings stay stable while traveling in that land. Completing its fourth area opens the next town; the new land changes seed and returns actors to local coordinates. There is no ever-growing scene graph. Positive safe-integer area indices select recipes; power grows linearly early and logarithmically later. The generator has no authored ending, but finite numeric ranges and finite registries, rather than a claim of mathematically infinite unique content.

Combat holds at most 100 live enemies (plus brief fading corpses), 180 projectiles, 150 drops, 96 recent events, 256 delayed effects and 40 items per hero. The skill tree has 48 nodes and repeatable mastery; hero/item levels are capped at one million. XP/gold magnet toward players; equipment pickup requires interaction, ahead of nearby optional mechanics or portals. Town services restore resources, sell deterministic stock, buy spare gear and refund skill ranks for gold. Death retains the build and charges 10% gold. A solo/all-dead party returns to town; a fallen guest with living teammates revives individually at the trailhead.

Solo modal dialogs and the atlas pause fixed stepping without clearing a separately requested lab pause. Online menus leave the host clock running. Recall requires 150 uninterrupted ticks; movement and incoming damage cancel it. Difficulty and the six damage/health/speed multipliers are validated authoritative actions, so headless tests and browser controls tune the same system.

## Rendering and assets

`monsterPixels()` shares six articulated skeletons between runtime and SVG export. Seeded proportions, five theme palettes, five poses and sixteen frames per pose produce readable silhouettes without independent opaque art files. Windups lift limbs before their corresponding damage frame; attack, hurt, walk and idle use different geometry. Boss scaling, glowing cores, death collapse, shadows, slash arcs, elemental effects and additive light share the same colors. The original wayfarer sprite remains intact beneath its sword, dodge trail and damage feedback. Town NPCs combine the existing humanoid recipe with role-specific props and gestures.

The monster image cache holds at most 512 canvases. Combat event effects derive from authoritative ticks while their smooth interpolation remains presentation-only. Ambient wildlife inside a live encounter's clearing is hidden to preserve visual clarity. Combatants, projectiles, loot and mechanics sit outside the ambient view cap. Sound adds slash, impact, hurt and level cues with a 24-voice cap, per-effect rate limits and a compressor.

Canvas 2D draws cached terrain, then sorts visible props/creatures/players by their ground y-coordinate. Tree canopies fade when they obscure the local traveler. High-detail sprites come from rectangle recipes, with eight generated poses and species-specific walk/bob motion. At distant zoom levels, creatures become readable colored marks. Zoom spans 0.08× to 5× (62.5:1). The minimap and atlas sample the same world function; they do not maintain a second map model.

`spritePixels()` supplies both the Canvas sprite cache and the SVG exporter. Custom palettes and recipes are validated. `synthesize()` supplies both browser audio buffers and PCM WAV export. Audio includes seeded noise, pitched pulses, a rising beacon chord and an eight-second ambient harmonic/arpeggio loop. Audio timing, fog/motes and lighting never alter simulation state. Fonts are the only third-party visual assets, bundled with their OFL licenses.

Presentation settings independently bound the circular draw radius (256–16,384 units) and visible creatures (0–65,536). `EntityVisibility` intersects camera bounds and distance, then uses stable distance bands to prioritize nearer entities under a cap. Travelers and landmarks are outside the creature budget. Terrain beyond the radius is covered by fog. Overview terrain is cached until its sampled bounds or world revision changes. Distant creatures rasterize into one reusable RGBA image and composite once per frame; this replaces up to 65,536 separate Canvas calls. Near views still draw the original animated sprites.

`GameDisplay` requests native fullscreen on the document root, preserving dialogs in the fullscreen top layer. CSS removes workspace navigation, the editor sidebar and footer, and supplies compact game controls, performance readout, map and abilities. Native fullscreen exits, Escape and the explicit exit button restore the workspace. A rejected or unsupported request retains usable window-filling game mode. The responsive HUD supports touch and short landscape viewports. Quality preferences use a small validated localStorage record. World checkpoints use atomic IndexedDB transactions so large worlds with edits do not compete with that string-storage quota; legacy version-1 localStorage saves remain readable.

## Online co-op

One browser owns simulation. Up to seven browsers connect to it through PeerJS/WebRTC data channels. PeerJS Cloud is the default rendezvous service; `tools/signal.ts` provides a self-hosted alternative. The same build supports optional ICE configuration. There is no Vercel function pretending to maintain a persistent WebSocket process.

Guests send input at approximately 30 Hz. The host clamps input, enforces monotonically increasing sequence numbers, limits acceptance rate, and clears stale input after 300 ms. Guests do not supply authoritative positions, shard counts or quest completion. The host sends snapshots at approximately 10 Hz and skips sending when a data channel is congested. Each guest supplies a bounded camera center, radius (256–16,384) and creature limit (0–65,536), so network interest matches local view settings. Changing guest quality cannot alter the host's population or another guest's budget.

Each visible NPC costs 16 bytes: ID, species, attunement, relative float positions and quantized velocities. JSON metadata contains players, seed/tick, quest, nearby collected resources, patches and recent effects. Relative float encoding retains subpixel detail far from the origin. Total packet size, counts, values and enum ranges are validated before state mutation. Both ArrayBuffer and reassembled Uint8Array delivery are supported and regression-tested.

The 2.0 release uses wire protocol 3: up to 65,536 ambient records plus at most 512,000 metadata bytes (1,560,584 total bytes). Adventure state includes combatants, mechanics, progression and the receiving player's full inventory; other inventories include only equipped items. All builds, enum values, numeric fields and collection limits are checked before mutation. The 16-bit ambient ID field includes slot 65,535. Full-capacity packets and small camera budgets are both tested. Incompatible older clients must refresh before joining; checkpoint format remains version 1 with a versioned adventure member. Older checkpoints without that member receive a fresh adventure profile. Replays belong to the engine revision that recorded them.

Reliable adventure RPCs carry monotonically increasing action sequences. The host supplies player identity, validates skill prerequisites, stock, gold and item ownership, and acknowledges success or errors. Only the leader may change shared travel, difficulty or the run. Guest movement, aim and combat buttons still use the ordinary input stream. XP/gold pickups reward each party member with their own modifiers; gear belongs to its collector. Joining initializes a catch-up build for that room; no account persistence is implied. Disconnect rekeys the local hero and owned effects for solo continuation. Enemy/projectile/player interpolation uses prior snapshot positions, but a changed run or portal transition snaps all actors to their new land.

Guests interpolate snapshots. They do not run a competing simulation or deterministic network lockstep. The host's open, active tab is a requirement; host loss ends the shared room, resets input and leaves guests with a solo copy. There is no automatic host migration, anti-cheat guarantee or server-side account ownership. NAT/firewall reachability may require a TURN relay. The default is suitable for invited cooperative play, with stronger deployment requirements documented separately from local verification.

## Agent contracts

Agents can inspect state without a screenshot, advance time without waiting, author terrain without a GUI and compare deterministic results without guessing. Every accepted mutating command can be recorded. Replays contain an initial versioned checkpoint and an ordered command list; adjacent idle simulation steps are coalesced. A final checksum verifies the result. Checksums are non-cryptographic and quantize numbers to a thousandth; exact checkpoint continuation also has a full-state equality test.

Solo browser recording covers gameplay inputs and simulation advancement. Online recording is disabled because guest input arrives asynchronously through a different authority. When the session becomes solo, recording starts from the received checkpoint. CLI checkpoints preserve all players; browser loads choose one local traveler and resume solo. The browser lab is a QA console, not an editor that future agents must operate.

### Join lifecycle

A guest requests a welcome until the first valid world snapshot is received. The host admits an already-open native channel idempotently and rate-limits repeated welcome responses. A transient failure during admission recreates the connection, with handshake timeouts of 6, 10 and 22 seconds across at most three attempts. Explicit full-room/version rejection and invalid snapshots are not retried. Generation and request identifiers prevent callbacks from canceled attempts from mutating a new session. The native connection still carries every byte; no test substitutes a fake transport.

## M01 physics foundation

Await `initializePhysics()` from `src/physics/bootstrap.ts` before constructing, restoring or replaying a `Simulation`. Browser boot, all direct Node tool entry points, headless tests and browser replay tests use this explicit barrier. Importing engine modules still requires no DOM, GPU or network. The compatibility package embeds WASM; initialization does not fetch a separate WASM URL. Failed browser boot displays an error with reload guidance. Canceling one initialization waiter does not cancel another; no world exists until a ready caller explicitly opens a scene.

`Simulation.playground` is null by default. `physics/reset` is the temporary development selector that opens its ten-body recipe. Rapier exclusively owns those poses, with zero global gravity, 16 Fern units per physics unit and one synchronous 1/60-second step per simulation tick. Commands apply between ticks; impulses take effect on the next solve. No legacy integration writes playground bodies. `physics/close`, reset, restore, failed replay and browser replacement dispose the superseded world and event queue. `Simulation.dispose()` is idempotent. Caller-owned simulations returned by `replay()` must be disposed by the caller.

Version-1 game checkpoints optionally contain a `playground` member: M01 wrote version 1; M02 writes version 2 and imports M01 snapshots. It preserves pinned backend version, unit scale, tick, stable body IDs with body/collider handles, recipes, snapshot bytes/checksum and bounded contact history. Version 2 also preserves policy documents, queued edits and applied body state. Restore validates lengths, byte values, identity uniqueness, registry/world correspondence, shapes, body properties and finite solved state; rejected restores preserve the current simulation. Same-build tests compare full solved continuation and replay hashes. Raw backend snapshots are version-specific and are not a cross-version migration format. The development lab explicitly limits command/checkpoint bodies to 4,096 and binary snapshots to 4 MB; this is neither an ambient physics budget nor an adaptive cutoff.

The Canvas playground draws solved positions/angles and Rapier's collider lines, with contact impact audio through the existing synth. It is solo-only until M04. Opening a room while a scene exists is rejected before altering the scene; opening a scene during an online or connecting room is also rejected. Protocol 3 rejects playground encoding instead of silently sending incomplete physical state. Eight actual browser clients continue to exercise the ordinary adventure protocol.

## M02 regional policies

`src/physics/policies.ts` owns a validated version-1 policy document with authored/current land, area and region profiles, live overrides, master switch, boundary margin, applied revision and a revision-reserving queue. `PhysicsWorld` validates transactions against every body's area binding, commits them before each step, and resolves the center sampled at that boundary. Explicit paused apply commits without stepping. Profiles resolve before live overrides; specificity, region priority and stable ID determine per-value provenance. Master-off gates optional features absolutely. See [exact semantics](physics/POLICIES.md#m02-delivered-contract).

Only world reactions, dynamic props, prop blocking and commanded impulse strength are implemented controls. Prop freezing changes Rapier body type to fixed at the current pose, discarding velocity, force and torque. Waking performs stable pairwise separation before switching to dynamic, with zero motion. Unresolved placement remains visibly frozen. Real interaction groups preserve essential terrain/prop contacts and independently toggle prop-to-actor contacts. A dynamic lab contact traveler demonstrates this behavior; it is separate from the adventure motor, which remains M03.

Playground version-2 snapshots retain complete policies/pending transactions, tick-start membership/position samples, applied values/provenance, frozen and blocked state, lab drive intent and validated consequence fields. Binary restore verifies body type, contact groups and zero frozen motion, plus resolver consistency at the saved sample. It does not resample an end-of-tick region crossing before the next boundary. Invalid loads retain the existing simulation. `{destroyed,claimed,durability?}` fields survive controls without claiming an implemented destruction system.

The lab UI and agent use the same configure/apply/place/drive operations. Only collider/region overlays persist in localStorage; policies live in simulation checkpoints and replay hashes. The solo-only transport boundary and network wire 3 remain unchanged. M04 must implement authorized shared physics, not infer it from disabled controls or room counts.
