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

Simulation runs at 60 fixed ticks per second. Browser frame deltas feed an accumulator; at most five ticks run per frame, with a maximum accepted frame delta of 100 ms. Overload slows simulation rather than inventing a variable timestep. Frame interpolation is presentation-only. Node tools advance an explicit tick count. Float64 positions preserve precision over large travel distances. Velocities live in Float32 arrays. Determinism is verified in the supported Node/Chrome environment; bit-identical trigonometry across unrelated JavaScript engines is not promised.

## Streaming and lifetime

Terrain is a pure function of seed and tile coordinates, with a small validated patch layer. Request order cannot change content. The simulation's LRU retains at most 1,024 chunks; each chunk contains three 256-byte arrays for terrain, decoration and variant. That is 768 KiB of raw tile data at capacity, excluding map/object overhead. Drawing retains at most 96 256×256 terrain canvases (24 MiB of uncompressed RGBA pixels, excluding browser overhead). If too many chunks would be visible for that cache, rendering selects a coarse terrain representation instead of thrashing it.

NPC storage is a fixed pool of 8,192 slots. Positions, previous positions, velocities, species, attunement and generation use typed arrays. Each creature slot has a stable party anchor. A creature more than 2,200 units from its assigned traveler becomes eligible to recycle around that traveler; the work is staggered over 60 ticks. Its generation increments and its placement is deterministically regenerated. This is active-world population streaming, not a persistent biography for every creature in the coordinate space.

Collected crystal coordinates, lit beacons and terrain patches survive unloading and checkpointing. The edited-tile layer has an explicit 2,048-tile limit. There is no global ever-growing cache of terrain or sprite objects.

## Physics and creature behavior

The spatial hash uses fixed head/next/cell arrays and 24-unit cells. Neighbor queries verify cell coordinates after hashing, preventing collisions in the hash table from returning unrelated or duplicate cells. NPC pairs resolve in stable ID order. Circle contact response includes inverse-mass separation and an impulse with restitution. Players also collide with one another. Creature encounters are intentionally non-blocking for travelers; pulses provide the physical interaction with wildlife.

Static collision handles deep-water tile rectangles, tree trunks and rocks. Motion is subdivided according to distance and radius, so a fast dash cannot skip a one-tile wall. Shallow water reduces player speed. Dash consumes spirit and has a cooldown; spirit regenerates. Pulse applies radial forces and attunes nearby wisps once per active lifetime.

Creatures near any player steer and resolve static contacts at 60 Hz. Far creatures perform those expensive decisions at 15 Hz, while their positions still integrate at 60 Hz. Pairwise creature contacts remain active. Wisp drift, beetle wandering and deer avoidance use deterministic functions of tick, seed and ID. No decision reads real time.

## Rendering and assets

Canvas 2D draws cached terrain, then sorts visible props/creatures/players by their ground y-coordinate. Tree canopies fade when they obscure the local traveler. High-detail sprites come from rectangle recipes, with eight generated poses and species-specific walk/bob motion. At distant zoom levels, creatures become readable colored marks. Zoom spans 0.08× to 5× (62.5:1). The minimap and atlas sample the same world function; they do not maintain a second map model.

`spritePixels()` supplies both the Canvas sprite cache and the SVG exporter. Custom palettes and recipes are validated. `synthesize()` supplies both browser audio buffers and PCM WAV export. Audio includes seeded noise, pitched pulses, a rising beacon chord and an eight-second ambient harmonic/arpeggio loop. Audio timing, fog/motes and lighting never alter simulation state. Fonts are the only third-party visual assets, bundled with their OFL licenses.

## Online co-op

One browser owns simulation. Up to seven browsers connect to it through PeerJS/WebRTC data channels. PeerJS Cloud is the default rendezvous service; `tools/signal.ts` provides a self-hosted alternative. The same build supports optional ICE configuration. There is no Vercel function pretending to maintain a persistent WebSocket process.

Guests send input at approximately 30 Hz. The host clamps input, enforces monotonically increasing sequence numbers, limits acceptance rate, and clears stale input after 300 ms. Guests do not supply authoritative positions, shard counts or quest completion. The host sends snapshots at approximately 10 Hz and skips sending when a data channel is congested. The current camera determines interest radius, clamped to 400–15,000 units.

Each visible NPC costs 16 bytes: ID, species, attunement, relative float positions and quantized velocities. JSON metadata contains players, seed/tick, quest, nearby collected resources, patches and recent effects. Relative float encoding retains subpixel detail far from the origin. Total packet size, counts, values and enum ranges are validated before state mutation. Both ArrayBuffer and reassembled Uint8Array delivery are supported and regression-tested.

Guests interpolate snapshots. They do not run a competing simulation or deterministic network lockstep. The host's open, active tab is a requirement; host loss ends the shared room, resets input and leaves guests with a solo copy. There is no automatic host migration, anti-cheat guarantee or server-side account ownership. NAT/firewall reachability may require a TURN relay. The default is suitable for invited cooperative play, with stronger deployment requirements documented separately from local verification.

## Agent contracts

Agents can inspect state without a screenshot, advance time without waiting, author terrain without a GUI and compare deterministic results without guessing. Every accepted mutating command can be recorded. Replays contain an initial versioned checkpoint and an ordered command list; adjacent idle simulation steps are coalesced. A final checksum verifies the result. Checksums are non-cryptographic and quantize numbers to a thousandth; exact checkpoint continuation also has a full-state equality test.

Solo browser recording covers gameplay inputs and simulation advancement. Online recording is disabled because guest input arrives asynchronously through a different authority. When the session becomes solo, recording starts from the received checkpoint. CLI checkpoints preserve all players; browser loads choose one local traveler and resume solo. The browser lab is a QA console, not an editor that future agents must operate.
