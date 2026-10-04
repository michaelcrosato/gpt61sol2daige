# Fern: building a world engine for coding agents

## Version 2.0: The Unfurling Wilds

Fern now has a complete outward-growing action-RPG loop: leave a town, fight packs and a warden, collect XP/gold/equipment, develop a build, and cross four areas into another land's town. The original wayfarer and woodland palette remain the visual anchor. The new brief is preserved in `ARPG-BRIEF.txt`.

The main investment was the shared content and state model. `Adventure` runs inside the existing fixed-step engine, so the browser, co-op host, headless agent and replay all execute identical combat rules. Area recipes compose mechanics, layouts, palettes and behavior archetypes. Skills and equipment feed derived stats rather than displaying unconnected numbers. The full run, including pending echoes and timed buffs, survives checkpoints. Eight authored mechanic introductions establish the vocabulary; generated encounters then combine it without requiring a separate procedural game mode.

Combat emphasizes fast choices and readable consequences: a directional three-hit slash, Whorl, unlockable Thornlance and Bloom Nova, sustained dodges, telegraphed monster attacks, stagger, knockback and flasks. Six articulated pixel rigs share five themed palettes and reusable animation poses. Bosses add their own attack sequencing and phase change. Directional sword animation, impact flashes, damage text, projected danger, additive lighting and layered synthesized sounds connect input to visible feedback. The town's three NPCs have distinct services, props and gestures, with no lengthy story gate.

The 48-node tree supports four interwoven build themes through rank investment and prerequisites, including actual active unlocks and combat-changing keystones. Loot has four slots, four rarities, seeded affixes and four legendary powers. A compact comparison panel, town respec, bulk sale of low-rarity spares and refill services keep the progression loop usable. Player death preserves investment while taking gold; co-op awards shared XP/gold and lets an individual rejoin living teammates without resetting their fight.

Optional mechanics are advantages, not mandatory puzzles. A combat-only test clears an area while every mechanic is unavailable. Another controller completes all eight introductions, visits the two subsequent towns, and clears a ninth procedural encounter using ordinary inputs. Its documented 2× player damage/health setting verifies progression, not final balance; a separate test clears the first area at default tuning. Six individual multipliers and an overall difficulty control make continued playtesting quick. The generator has no authored ending, while safe numeric ranges, bounded actors and per-land coordinates make its operational limits explicit.

Verification covered 41 headless cases and 14 browser scenarios, including actual eight-client WebRTC actions, shared rewards, guest ownership, death recovery, menu pause semantics, native fullscreen, mobile controls and large saves. The initial 300-frame combat sample at normal close zoom measured **60.00 FPS and 60.00 simulation ticks/s**, with 11 peak active enemies and 2,400 ambient creatures simulated. These are observations on this workstation, not guarantees for arbitrary builds or devices. [Verification and reproducible evidence](VERIFICATION.md) document the workload and earlier releases separately.

Work was concentrated on four connected layers: deterministic combat/progression, reusable content/rigs, the playable UI and controls, and complete browser/network verification. The engine's existing world streaming, asset recipes and replay tools paid off: new enemies and encounters could be tested through the same input API and exported without introducing editor-only state. The next substantive design work is player-driven balance and more authored content using these registries, rather than replacing the underlying architecture.

## Version 1.1: more room to explore

The follow-up adds persistent settings for draw distance, visible creatures and active world population, together with a proper fullscreen game mode. The engine capacity is now **65,536 creatures**, eight times the original limit. View settings are independent: decreasing the number drawn does not remove creatures from the simulation, and a co-op guest's settings do not change the shared population.

The performance work focused on the measured bottleneck. At distant zooms, tens of thousands of individual Canvas drawing calls were expensive. The renderer now plots those creatures into one reusable pixel buffer and composites it once, while caching the coarse terrain view. Near-camera sprites keep their original appearance. Large populations expand across a wider area, the spatial hash scales with capacity, and distant contacts use a lower update frequency while nearby physics retains full fidelity. A bounded frame budget prevents an overloaded simulation from trapping the interface in catch-up work.

The 300-frame game-mode benchmark measured about **60 FPS with 16,384 visible creatures**, **54 FPS with 32,768**, and **37 FPS with 65,536** on this machine. At the highest settings the fixed-step simulation also slows; both the benchmark and settings expose its actual tick rate. These limits give the user room to tune, rather than promising the same performance on every device. [The verification record](VERIFICATION.md) contains exact values and captures.

Fullscreen uses the browser's actual API. The workspace navigation, development sidebar and footer give way to a compact HUD, with map, journal, sound, settings, abilities and save/load still available. Esc, G, an exit button and browser-initiated fullscreen exits all restore the workspace. Where native fullscreen is unavailable, the same layout fills the window. Portrait and landscape touch layouts are tested. Quality preferences remain small localStorage records, while larger game saves use IndexedDB and preserve compatibility with earlier saves.

This extension was implemented in the engine, renderer and packet validation as well as the controls. Protocol 2 can carry the expanded entity range and honors each guest's camera and budget. Tests cover full-capacity checkpoints, slot 65,535 in binary packets, guest authority, settings persistence, actual native fullscreen, denial/fallback behavior and large saved worlds. The original design rationale below remains relevant; its benchmark paragraphs describe the initial release.

## The result

The result is a working engine and a playable cooperative exploration game, not an editor mockup. Fern generates a large forest from a seed, streams terrain with bounded caches, simulates thousands of creatures, renders close-up pixel art and distant landscapes, synthesizes its own soundtrack, and connects up to eight travelers through a shared host-authoritative world. Agents can drive that same simulation through JSON, without opening the game.

The central design decision was to make the world easy to reproduce, inspect and change. Visual quality still matters: a human needs to be able to judge the game. But a human-oriented scene editor would have put the main source of truth behind a workflow our intended developer never needs. In Fern, the source of truth is code, validated recipes, seed coordinates, checkpoints and input history.

The detailed acceptance record is in [VERIFICATION.md](VERIFICATION.md). The accompanying evidence includes screenshots and raw benchmark measurements, so the performance statements here can be checked rather than taken on confidence.

## What “built for agents” changes

An agent's expensive operations include reading large amounts of context, inferring hidden state, manipulating a visual editor and waiting to reproduce a bug. Reducing those costs matters more than minimizing the number of lines written on day one.

Fern therefore exposes four short paths. `describe` reports the command vocabulary. `observe` returns a compact summary rather than thousands of entities. `inspect` asks for a bounded local region. `step` advances explicit ticks without real-time waiting. A complete checkpoint is available when needed, but is not the default response.

Every simulation feature fits into a repeatable loop: choose a seed, apply commands, advance time, inspect the result, and replay it. The same command interpreter operates in Node and in the browser lab. This reduces the chance that a test tool accidentally verifies a different implementation from the one players use.

The early investment in checkpoints and replay paid for itself during browser work. A browser gameplay recording can be replayed in Node, and a restored simulation is checked for an identical future checkpoint. A visible failure no longer has to be described as “something went wrong around the trees.” It can become a small file with a precise starting state and a sequence of actions.

## Why this technology stack

I selected TypeScript, Node 24, Canvas 2D and Web Audio because they are directly executable and observable in this workstation. TypeScript provides explicit contracts without forcing a separate runtime language for tools. Node imports the simulation and asset generators without a DOM. Chrome supplies a real rendering/input/audio/network environment that Playwright can inspect headlessly.

Canvas 2D is a deliberate rendering budget decision. Cached terrain images, sprite atlases, culling, y-sorting and distance-based representations are sufficient for this top-down world. A GPU API would add another implementation and verification boundary before the basic requirements demanded it. The measurements give a concrete baseline for deciding later when that trade becomes worthwhile.

| Option considered | What it would offer | Why it was not the starting point |
| --- | --- | --- |
| Godot or another established engine | Mature editor, asset import, broad physics and tooling | The brief requested a ground-up agent-first engine; editor resources and engine-specific APIs would become additional state and context |
| Native Rust/C++ with SDL | Tight memory control and a strong CPU performance ceiling | More bindings, build steps and a separate automation bridge before a complete observable game loop |
| WebGL/WebGPU renderer | Larger GPU-driven draw budgets and advanced effects | More work around shaders, adapters and readback; current Canvas measurements already cover the requested visible scale |
| A server-only multiplayer design | Persistent authority and a host-independent session | Requires a continuously running service and operational ownership; invited co-op can be validated with a browser host first |
| TypeScript + Canvas 2D | One source tree for simulation, tools, assets and browser QA | Chosen; the cost is that rendering and simulation still share the browser's main thread |

These are engineering judgments, not claims that the other approaches cannot work. The module boundaries leave room for a new renderer or a dedicated simulation process later. Vercel hosting sits outside those boundaries: it serves the ordinary static build and did not require changes to the core technology or simulation model.

## Procedural systems received the upfront investment

Terrain generation uses stateless integer coordinate hashing and smooth noise. A chunk requested tomorrow has the same contents as one requested today, and loading a neighboring chunk first makes no difference. That property enables eviction, parallel exploration by different travelers, deterministic testing and distant map inspection with very little stored data.

The world spans a bounded square of 32 million world units per side. With 16-unit tiles, that represents four trillion addressable tile positions; it does not allocate four trillion objects. Only 1,024 simulation chunks are resident. The renderer maintains a separate bounded image cache and switches to coarse terrain when the detailed working set would exceed that cache.

Procedural graphics are also shared code, not a collection of opaque outputs. A sprite recipe yields colored pixel rectangles. The renderer turns them into cached Canvas sprites; the asset tool exports matching SVG frames. A palette or silhouette change therefore reaches both outputs. Tree layers, deer legs, cloaks, wisps, crystals, stones, flowers, campsite props, particles and lighting are all generated in code.

The audio path follows the same principle. A pure synthesizer produces deterministic PCM samples. The browser plays those samples through Web Audio, and the asset CLI exports WAV files from the same function. Pulse, dash, collection, beacon and footstep sounds have separate envelopes; an ambient score combines a sustained harmonic bed with a seeded arpeggio. There is no recorded-music dependency and no runtime generative-AI bill.

For level design, agents can paint bounded rectangular tile regions through JSON or provide a level recipe. The patch layer changes terrain, decoration and collision together, invalidates the appropriate generated caches, survives checkpointing and synchronizes to guests. This is a useful authoring primitive even though the initial game could have shipped with seeded terrain alone.

## How the simulation reaches thousands of creatures

The engine uses typed arrays for the hot entity state and a fixed spatial hash for neighbor queries. That avoids allocating an object graph for every creature on every tick. Nearby creatures receive full-rate steering and static collision work; distant ones receive those decisions at 15 Hz while their positions continue to integrate at 60 Hz. Pairwise contacts still run in stable ID order.

Rendering has its own level of detail. A traveler at close zoom sees animated sprites and canopy layering. At far zoom, the same live creatures become small colored marks. That distinction is necessary: thousands of full-size silhouettes would be both expensive and unreadable when the entire region occupies one screen.

A headless CPU benchmark measured a 2.93 ms p95 tick for 6,000 NPCs and 5.55 ms for 8,192 NPCs on the supplied Intel i7-14700F workstation. This is simulation time, not a claim about every machine's frame rate. A separate browser benchmark measured 300 consecutive frames at 1440×1000, with all 6,000 creatures visible at 0.18× zoom, averaging 60.2 FPS with a 16.7 ms p95 frame interval after closing the earlier QA browser sessions. The workstation is shared: a preceding run with those sessions open averaged 54.5 FPS, and that evidence is retained too. These are observed results rather than guaranteed budgets. See the committed JSON for methodology and exact values.

There are limits behind those numbers. Active NPCs recycle when far from their assigned traveler; they do not retain a lifetime history throughout the whole coordinate space. Detailed terrain rendering is bounded by cache capacity. Eight people zoomed out over thousands of creatures put more pressure on the host's upload bandwidth than people exploring a close-up scene. These are explicit operating characteristics that an agent can measure and reason about.

The final audit also tested travelers separating across the world. I changed population ownership so each slot follows a stable party anchor; a traveler no longer depends on the host leaving the starting area before encountering wildlife. With eight travelers 10,000 units apart, a 6,000-creature run placed 750 near each traveler and measured a 4.64 ms p95 tick. A 1,024-chunk cache accommodates those separate regions while remaining bounded.

## Physics and smoothness

The physics implementation concentrates on top-down movement: circle contacts, inverse masses, restitution, separation, tile/trunk collision, wading, dash movement and pulse forces. High-speed motion uses conservative substeps. One regression test launches a body at 4,000 units per second toward a one-tile wall and confirms it does not tunnel through. Another checks momentum under an unequal-mass elastic collision.

The physics tick is fixed; rendering interpolates positions independently. Camera movement and zoom are smoothed. Procedural animation poses are cached, and sprite movement does not depend on frame rate. This gives agents a stable simulation to test while humans see continuous motion.

This is not yet a general-purpose rigid-body library. There are no arbitrary convex polygons, joints or stacked-box constraints. For the actual exploration game, specialized circle and terrain physics cover the required interactions with considerably less code and a smaller failure surface.

## Online co-op and the bug that justified real testing

The host owns movement, NPCs, shard collection, beacons and level edits. Guests send input; the host sends compact snapshots over WebRTC. The initial implementation connected eight clients successfully, but stopped updating when the entity snapshot grew. A room counter alone would have hidden this failure.

The actual cause was the transport's large-message path: small PeerJS messages arrived as ArrayBuffer, while reassembled messages arrived as Uint8Array. Normalizing those forms fixed the failure, and a dedicated regression test now protects it. The expanded browser test keeps eight isolated contexts connected, moves a guest, lights a shared beacon, expands the world to 6,000 NPCs, verifies a guest receives them, applies synchronized terrain edits, rejects a ninth traveler and fills the released slot after someone leaves.

This verifies real WebRTC connections and real shared state. It does not demonstrate arbitrary cross-country latency, every corporate firewall or every NAT pairing. The default rendezvous service is PeerJS Cloud. Self-hosted signaling is included, and TURN configuration is supported when a network needs a relay. Host migration, competitive anti-cheat and persistent dedicated authority remain architectural extensions, not hidden claims of this version.

## How I allocated the work

I organized the work around dependency and evidence rather than around the most visible screen first.

| Stage | Main investment | Reason |
| --- | --- | --- |
| Foundation | Deterministic world, entity layout, collision and complete checkpoint state | Everything else needs a stable, testable world |
| Agent access and content | Commands, observation, replay, shared sprite/audio recipes, level brushes | Reduces the cost of building and verifying later features |
| Playable integration | Exploration loop, responsive UI, atlas, controls, sound, multiplayer | Makes the engine's claims observable in a real game |
| Verification and delivery | Physics/replay tests, visual checks, eight-client tests, benchmarks, documentation, public repository and deployment | Turns a plausible implementation into a reviewable deliverable |

The biggest deliberate upfront costs were the reusable generators and the agent control surface. A small hand-painted scene would have been faster initially, but would not advance the requested engine. I also reserved substantial integration time for networking and browser checks; that is where the transport-format failure and a synthetic touch-test issue surfaced. The latter was corrected to use an actual active pointer rather than a fabricated pointer ID.

The final artifacts include the source, pinned dependencies, exported procedural assets, recipe examples, agent instructions, local reproduction commands, benchmark scripts and an acceptance record. Future agents can start from those files rather than reconstruct the design from this conversation.

## What I would invest in next

The next rendering or networking change should follow measured workload. A worker-hosted simulation would protect responsiveness when the main thread is busy. A dedicated Node authority with the existing protocol would remove the requirement to keep a host tab active. Persistent chunk event journals would allow named NPCs and richer world changes to survive far-distance recycling. A declarative behavior graph could give agents more expressive creatures without touching hot-loop code.

I would add those systems against small acceptance scenarios and replay fixtures. The engine's value is that new work can be checked at its boundaries: a recipe becomes visible content, a command becomes a state change, a checkpoint reproduces a problem, and a packet becomes the same shared world in another browser. That is the foundation for faster, more token-efficient development and consistently higher-quality output.

Technical references used for transport/build integration: [PeerJS API](https://peerjs.com/docs/), [PeerServer Cloud](https://peerjs.com/server/cloud), [PeerJS network limitations](https://peerjs.com/client/faq), [Vite guide](https://vite.dev/guide/), and [Vercel deployment documentation](https://vercel.com/docs/deployments). All engine behavior and performance claims are supported by this repository's implementation and verification artifacts.
