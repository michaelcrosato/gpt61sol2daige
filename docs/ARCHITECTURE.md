# Architecture

Fern is a single TypeScript repository with a browser-independent simulation. There is no imported game engine, scene editor, rendering framework, physics library, artwork pack or audio pack.

```text
JSONL / browser commands ─── AgentRuntime ─── Simulation (60 Hz)
                                                │
                           World generation ────┤
                           Spatial hash/physics ┤
                           Quest and players ───┤
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
| `src/engine/simulation.ts` | Fixed-step state, NPC arrays, players, shared quest, checkpoints | Browser or transport |
| `src/engine/agent.ts` | Validated commands, observation and replay | Browser or filesystem |
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

Static collision handles deep-water tile rectangles, tree trunks and rocks. Motion is subdivided according to distance and radius, so a fast dash cannot skip a one-tile wall. Shallow water reduces player speed. Dash consumes spirit and has a cooldown; spirit regenerates. Pulse applies radial forces and attunes nearby wisps once per active lifetime.

Creatures within 420 units of a player retain full-rate steering and contacts. Far steering runs every fourth tick. Above 8,192 total creatures, distant static and creature contacts run every eighth tick; below that threshold, static contacts run every fourth tick and creature contacts run every tick. All positions integrate each fixed tick. Thus distant contact frequency is nominally 7.5 Hz at large populations, while nearby gameplay retains 60 Hz physics when the machine sustains the target tick rate. Wisp drift, beetle wandering and deer avoidance use deterministic functions of tick, seed and ID. No simulation decision reads real time.

## Rendering and assets

Canvas 2D draws cached terrain, then sorts visible props/creatures/players by their ground y-coordinate. Tree canopies fade when they obscure the local traveler. High-detail sprites come from rectangle recipes, with eight generated poses and species-specific walk/bob motion. At distant zoom levels, creatures become readable colored marks. Zoom spans 0.08× to 5× (62.5:1). The minimap and atlas sample the same world function; they do not maintain a second map model.

`spritePixels()` supplies both the Canvas sprite cache and the SVG exporter. Custom palettes and recipes are validated. `synthesize()` supplies both browser audio buffers and PCM WAV export. Audio includes seeded noise, pitched pulses, a rising beacon chord and an eight-second ambient harmonic/arpeggio loop. Audio timing, fog/motes and lighting never alter simulation state. Fonts are the only third-party visual assets, bundled with their OFL licenses.

Presentation settings independently bound the circular draw radius (256–16,384 units) and visible creatures (0–65,536). `EntityVisibility` intersects camera bounds and distance, then uses stable distance bands to prioritize nearer entities under a cap. Travelers and landmarks are outside the creature budget. Terrain beyond the radius is covered by fog. Overview terrain is cached until its sampled bounds or world revision changes. Distant creatures rasterize into one reusable RGBA image and composite once per frame; this replaces up to 65,536 separate Canvas calls. Near views still draw the original animated sprites.

`GameDisplay` requests native fullscreen on the document root, preserving dialogs in the fullscreen top layer. CSS removes workspace navigation, the editor sidebar and footer, and supplies compact game controls, performance readout, map and abilities. Native fullscreen exits, Escape and the explicit exit button restore the workspace. A rejected or unsupported request retains usable window-filling game mode. The responsive HUD supports touch and short landscape viewports. Quality preferences use a small validated localStorage record. World checkpoints use atomic IndexedDB transactions so large worlds with edits do not compete with that string-storage quota; legacy version-1 localStorage saves remain readable.

## Online co-op

One browser owns simulation. Up to seven browsers connect to it through PeerJS/WebRTC data channels. PeerJS Cloud is the default rendezvous service; `tools/signal.ts` provides a self-hosted alternative. The same build supports optional ICE configuration. There is no Vercel function pretending to maintain a persistent WebSocket process.

Guests send input at approximately 30 Hz. The host clamps input, enforces monotonically increasing sequence numbers, limits acceptance rate, and clears stale input after 300 ms. Guests do not supply authoritative positions, shard counts or quest completion. The host sends snapshots at approximately 10 Hz and skips sending when a data channel is congested. Each guest supplies a bounded camera center, radius (256–16,384) and creature limit (0–65,536), so network interest matches local view settings. Changing guest quality cannot alter the host's population or another guest's budget.

Each visible NPC costs 16 bytes: ID, species, attunement, relative float positions and quantized velocities. JSON metadata contains players, seed/tick, quest, nearby collected resources, patches and recent effects. Relative float encoding retains subpixel detail far from the origin. Total packet size, counts, values and enum ranges are validated before state mutation. Both ArrayBuffer and reassembled Uint8Array delivery are supported and regression-tested.

The 1.1 release uses wire protocol 2: up to 65,536 records plus at most 100,000 metadata bytes (1,148,584 total bytes). The 16-bit ID field includes slot 65,535. Full-capacity packets and small camera budgets are both tested. Incompatible older clients must refresh before joining; checkpoint format remains version 1. Engine replays should be run against the engine revision that recorded them, especially across changes to population scheduling.

Guests interpolate snapshots. They do not run a competing simulation or deterministic network lockstep. The host's open, active tab is a requirement; host loss ends the shared room, resets input and leaves guests with a solo copy. There is no automatic host migration, anti-cheat guarantee or server-side account ownership. NAT/firewall reachability may require a TURN relay. The default is suitable for invited cooperative play, with stronger deployment requirements documented separately from local verification.

## Agent contracts

Agents can inspect state without a screenshot, advance time without waiting, author terrain without a GUI and compare deterministic results without guessing. Every accepted mutating command can be recorded. Replays contain an initial versioned checkpoint and an ordered command list; adjacent idle simulation steps are coalesced. A final checksum verifies the result. Checksums are non-cryptographic and quantize numbers to a thousandth; exact checkpoint continuation also has a full-state equality test.

Solo browser recording covers gameplay inputs and simulation advancement. Online recording is disabled because guest input arrives asynchronously through a different authority. When the session becomes solo, recording starts from the received checkpoint. CLI checkpoints preserve all players; browser loads choose one local traveler and resume solo. The browser lab is a QA console, not an editor that future agents must operate.

### Join lifecycle

A guest requests a welcome until the first valid world snapshot is received. The host admits an already-open native channel idempotently and rate-limits repeated welcome responses. A transient failure during admission recreates the connection, with handshake timeouts of 6, 10 and 22 seconds across at most three attempts. Explicit full-room/version rejection and invalid snapshots are not retried. Generation and request identifiers prevent callbacks from canceled attempts from mutating a new session. The native connection still carries every byte; no test substitutes a fake transport.
