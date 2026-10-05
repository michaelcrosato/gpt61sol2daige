# Verification record

The evidence here distinguishes tested behavior from operating limits. Source tests are executable; selected captures and benchmark JSON are committed under `docs/evidence/`. Full test traces and generated output stay in ignored local artifact directories.

## Reproduction gates

M01 passes **48 headless tests** and **17 browser scenarios**. Fern 2.0's preceding release had 41 headless tests and 14 browser scenarios, exercising combat, skills, shop purchases, equipment, drops, death, outward progression, guest action authority, shared party XP/gold, personal respawn and exact save/replay continuation. Version 1.1 had 26 headless tests and 10 browser scenarios; its measurements remain labeled below.

```bash
npm ci
npm run check
npm run build
npm run test:e2e
npm run verify:run
npm run physics
npm run bench
# With npm run dev running:
npm run bench:browser
npm run bench:quality
npm run bench:combat
```

The browser suite starts isolated app/signaling processes on ports 5187 and 9018. `BASE_URL` targets an existing app, including production. No simulated WebRTC adapter is used. Chrome runs headlessly with background throttling disabled for multiple test tabs. The eight-client test places most clients in the lab to avoid conflating connection correctness with eight competing renderers on one workstation; one guest renders a 32,768-creature view and also switches to a 512-creature budget without changing the host population. Native fullscreen tests assert `document.fullscreenElement` and the canvas's actual viewport bounds. A separate denial test deliberately rejects the native API to verify the fallback.

The local-signaling test configuration supplies an empty ICE server list so same-machine connections do not depend on external STUN/TURN availability. In CI only, Chromium uses direct host candidates instead of multicast-resolved mDNS names, removing another container-network dependency. It still opens real WebRTC data channels between isolated contexts. Production testing retains browser defaults and the site's public signaling and ICE configuration.

## Version 2.0 adventure evidence

| Requirement | Acceptance evidence |
| --- | --- |
| Fluid hack-and-slash with the original hero | Real-time browser controller fights through Brambleburst using attack/Whorl/movement/flasks; original sprite stays beneath sword and dodge effects |
| Deep skills and equipment | 48-node DOM tree; learning changes derived damage; shop purchase deducts gold, equipping applies stats; headless prerequisite, active-unlock, cleave and respec checks |
| XP, gold, rarity and drops | Browser gains levels and gold, sees a guaranteed rare warden drop, collects gear with actual E input; fourth/eighth boss legendary rewards tested |
| Outward areas, lands and towns | Input-driven run clears areas 1–9, visits Emberrest after 4 and Tideglass Haven after 8, and retains build/loot across transitions |
| Optional named mechanics | Eight distinct authored introductions; an encounter clears with all mechanic cooldowns disabled; delayed Echo/linked-effect state survives save/restore |
| Modular endless continuation | Procedural ninth area clears; browser previews area 10,001; recipe export/validation includes index 1,000,000,000 with bounded coordinates |
| Difficulty/debug controls | Browser slider changes authoritative health tuning; headless checks verify all six multipliers affect stats, motion or incoming damage |
| Monster rigs and procedural effects | Six distinct shared runtime/export rigs; 80 pose frames exported from the example recipe; desktop/mobile screenshots inspected |
| Multiplayer progression | Eight actual clients; guest learns a skill, buys/equips boots, fights, shares earned XP with host, cannot tune the room, and retains its build after host disconnect |
| Recovery and usability | Death preserves build and takes 10% gold; guest respawn leaves others' fight intact; solo menus/atlas pause and retain manual pause; mobile HUD has no horizontal overflow |

`npm run verify:run` uses seed 142 and **2× player damage/health**, with the remaining tuning at defaults. It finishes all nine areas without death, reaches level 19 with 2,505 gold and a full 40-slot satchel. It drives normal combat inputs and legitimate skill/equipment actions; it does not mark areas cleared or award rewards directly. This smoke test establishes reachable progression, not balance across every seed, party or depth. [Raw playthrough](evidence/adventure-playthrough.json).

The separate combat benchmark measures 300 consecutive frames after 60 warmup frames in generated area 9, at 1440×1000, normal 1.8× zoom, with 2,400 ambient creatures simulated. Its input controller attacks, casts Whorl, dashes and heals. It uses 5× player health and 0.1× enemy damage to sustain the encounter; outgoing damage and movement stay at defaults. The measured result was **60.00 FPS**, **16.7 ms p95 frame interval**, **60.00 simulation ticks/s**, **11 peak enemies**, and **5 kills** during the sample. [Raw combat benchmark](evidence/combat-benchmark.json), [combat capture](evidence/adventure-procedural.png). It measures a typical encounter, not the 100-live-enemy ceiling.

Inspected captures: [warden fight](evidence/adventure-boss.png), [48-node tree](evidence/adventure-skills.png), [equipment](evidence/adventure-equipment.png), [new land's town](evidence/adventure-town.png), [mobile game HUD](evidence/adventure-mobile.png). The boss capture uses increased player health for demonstration; the town capture uses the documented area-preview/recall tools. They demonstrate rendering, while the executable tests establish progression.

## Requirement-to-evidence map

| Brief requirement | Implementation | Acceptance evidence |
| --- | --- | --- |
| Ground-up 2D top-down engine | Pure TypeScript simulation, own renderer/physics/world/quest | Source modules plus headless and browser suites |
| Fast, token-efficient agent development | Bounded JSON observations, command discovery, explicit stepping, shared browser/Node API | CLI JSONL example executed and recorded; replay hash matched |
| Massive open-world streaming | Seed/coordinate generation, negative coordinates, 1,024-chunk LRU, bounded render cache | Eviction/regeneration test visits 60 widely separated chunks with an 8-chunk test budget; cache and content checks pass |
| Up to eight online co-op players | Real WebRTC star network with host simulation and input authority | Eight isolated browser contexts; movement, shared beacon, 6,000-entity state, terrain edits, ninth-player rejection, slot replacement and host disconnect |
| Good physics for the game | Spatial broad phase, impulses, unequal masses, restitution, tile/trunk contacts, substeps, wading and forces | Momentum, broad-phase, high-speed wall, gameplay dash/pulse and deterministic simulation tests |
| Thousands of on-screen NPCs | 65,536-capacity typed arrays, culling/LOD, batched pixel rendering | Full-capacity checkpoint and packet tests; 65,536 actually drawn during 300 browser frames |
| Adjustable draw distance and on-screen population | Independent draw-radius, visible-limit and active-population settings | Browser tests change a real cap to 500, narrow/expand draw distance, restore defaults and reload persisted values |
| Proper fullscreen game mode | Native fullscreen plus responsive compact HUD and windowed fallback | Real fullscreen entry/exit, G/Esc, native browser exit, usable dialogs, journal/map/abilities, touch and rotation |
| Higher-capacity saves and network | Atomic IndexedDB saves and protocol-2 packets with per-guest budgets | A distant 65,536-creature world with 2,048 painted tiles saves and restores exactly; legacy saves still load; real co-op transfers 32,768 creatures |
| Close and far zoom | 0.08×–5× camera, detail/overview rendering | Browser controls, far-view entity count and screenshots |
| Modern pixel graphics and smooth animation | Procedural pixel recipes, cached poses, 60 Hz position interpolation | Desktop/mobile visual inspection, atlas/lab captures, browser frame benchmark |
| Procedural graphics and animation tools | Shared runtime/export pixel recipes, palette validation | SVG generation and animation tests; custom sprite recipe exported successfully |
| Procedural sound and music | Pure seeded PCM synthesis, Web Audio, WAV export | Every sound checked for finite, bounded, non-silent samples and correct WAV headers; browser sound toggle exercised |
| Agent level-design tools | JSON terrain brushes, patch files, preview SVG, chunk export | Brush invalidation/checkpoint/replay tests; level/chunk CLI runs; online patch replication |
| Better verification | Versioned saves, deterministic replay, complete checkpoint comparison | Headless repeatability and exact post-restore equality; browser recording replayed by Node |
| Environment reproducibility | Node 24, pinned lockfile, local Chrome, locally bundled assets/fonts | Successful install/typecheck/tests/build and documented commands; no runtime LLM or GPU API |
| Approach/design/time-allocation report | `docs/REPORT.md` and hosted static documentation | Report covers decisions, alternatives, procedural investment, work allocation, measured results and limits |
| Public GitHub repository and Vercel production | Repository and deployment configuration | Final delivery checks inspect GitHub visibility, remote commit, Vercel readiness, public HTTP response and deployed browser behavior |

## Version 2.0 ambient regression measurements

A fresh run of `bench:quality` uses the same 300-frame, 1440×1000, 0.12× game-mode workload as version 1.1, in the safe town with no active combat encounter. This verifies that the new adventure systems preserve the expanded ambient budget; it is separate from the close-up combat sample above.

| Active and visible ambient creatures | Mean FPS | p95 frame interval | Actual simulation ticks/s |
| --- | --- | --- | --- |
| 6,000 | 60.07 | 16.7 ms | 60.07 |
| 16,384 | 60.08 | 16.7 ms | 60.08 |
| 32,768 | 60.12 | 16.7 ms | 60.12 |
| 65,536 | 49.70 | 33.4 ms | 49.70 |

[Raw version 2.0 quality benchmark](evidence/quality-benchmark-v2.json). These are measurements on a shared workstation under the load present at capture time; differences from the older run do not isolate an individual optimization.

## Version 1.1 quality measurements

Each case uses a fresh headless Chrome context, 1440×1000 game mode, 0.12× zoom, 16,384-unit draw distance, and a visible-creature limit equal to the simulated population. All the listed creatures were drawn. Each measurement covers 300 animation frames after the view settles. The same Intel i7-14700F / WSL2 workstation is shared with other work; these are observed values, not universal guarantees.

| Active and visible creatures | Mean FPS | p95 frame interval | Actual simulation ticks/s |
| --- | --- | --- | --- |
| 6,000 | 60.22 | 16.7 ms | 60.22 |
| 16,384 | 60.24 | 16.8 ms | 60.24 |
| 32,768 | 54.34 | 33.3 ms | 54.34 |
| 65,536 | 37.20 | 33.4 ms | 37.20 |

At the largest workloads, rendering and simulation share the main thread, so the fixed-step simulation slows too. The UI remains responsive and reports actual simulation Hz; the benchmark does not disguise a reduced simulation rate as 60 Hz. Headless tests prove determinism at the expanded cap, not a guaranteed real-time rate. [Raw quality benchmark](evidence/quality-benchmark.json), [maximum-population capture](evidence/quality-65536.png), [fullscreen HUD](evidence/game-mode.png), [settings](evidence/quality-settings.png), [mobile game mode](evidence/game-mode-mobile.png), [landscape touch controls](evidence/game-mode-landscape.png).

## Initial-release measurements

CPU workload: seed 142, one moving player, 120 warm-up ticks, 360 measured ticks per population. Node v24.21.0 on Ubuntu/WSL2, Intel i7-14700F, 20 logical cores.

| Active NPCs | Median tick | p95 tick | Mean tick | Full-range snapshot |
| --- | --- | --- | --- | --- |
| 1,000 | 0.418 ms | 0.792 ms | 0.454 ms | 16,523 bytes |
| 2,400 | 0.875 ms | 1.016 ms | 0.898 ms | 38,923 bytes |
| 6,000 | 2.573 ms | 2.931 ms | 2.615 ms | 96,523 bytes |
| 8,192 | 3.757 ms | 5.546 ms | 4.003 ms | 131,595 bytes |

These are retained measurements of version 1.0 on a shared workstation. Full-range snapshots include the metadata for one player and no edited tiles; actual packet size varies with players, camera interest, events and edits. [Raw CPU benchmark](evidence/benchmark.json).

The final 300-frame browser measurement includes both Canvas rendering and live simulation: 1440×1000, 6,000 visible creatures, 0.18× zoom, mean **60.15 FPS**, p95 frame interval **16.7 ms**. The nominal display refresh rate caps this measurement. It is not a minimum FPS guarantee on other machines. [Raw browser benchmark](evidence/browser-benchmark.json). An earlier run with other QA browser sessions still open averaged 54.54 FPS; [that measurement is retained](evidence/browser-benchmark-loaded.json) to show workload variability.

## Fixes exposed by verification

- A browser test initially encountered a different project's dev server on a shared port. The suite now owns dedicated ports and refuses to reuse an existing server.
- Large PeerJS messages arrived as Uint8Array after reassembly rather than ArrayBuffer. The transport now normalizes both forms; a typed-array offset test and the 6,000-entity co-op test exercise that path.
- A synthetic mobile test supplied an inactive pointer ID. It now uses a real pressed pointer and checks for browser errors.
- Replay recording restarts on transition from an online session to solo, and imported browser saves normalize player ownership.
- Detailed terrain uses a working-set cap so wide zooms switch representation before exceeding the terrain image cache.
- Wildlife slots now follow stable party anchors, so explorers traveling far from a stationary host receive their share of the population. A separated-traveler test covers this, including save/restore. A 6,000-NPC dispersed benchmark measured a 4.64 ms p95 tick, 750 creatures near each of eight travelers 10,000 units apart, and 671 chunks inside the 1,024-chunk limit. [Dispersed-world evidence](evidence/dispersed-benchmark.json).
- A broad deployment ignore pattern excluded `public/docs` as well as source documentation. The pattern was removed, and the browser suite now requests every documentation page, its stylesheet and the generated asset manifest so a successful game build cannot conceal missing deliverables.
- Version 1.1's far-view renderer originally made one Canvas call per creature. A reusable RGBA buffer reduced rendering cost substantially at 32k and 65k populations. Nearby sprites retain their existing detail.
- Large checkpoint storage now uses IndexedDB. The test covers a 65,536-creature world at distant coordinates with the full 2,048-tile patch layer, as well as existing localStorage saves.
- High-population region rebalancing now clears derived proximity flags when a slot respawns; the checkpoint test checks exact future state while travelers separate.
- M04's eight-client test lost six guests at 32,768 creatures on main CI and on both commits of its first repair. Local reproduction showed a loaded host processing guest acknowledgements 3–10 s late, so stop-and-wait guests heard nothing for 10 s; per-hello population-sized rebinding and per-guest frame builds amplified the load. A 1 Hz host heartbeat now carries liveness, builds are shared and cost-spaced, and staged receipts stop resends to guests that are still decoding. [Release evidence](evidence/physics-m04-release.json).
- M03 made ambient ownership a per-tick, per-creature pass that rebuilt four area recipes and a full policy object for every creature. A 32,768-creature tick took a median 184 ms in Node, against 7.4 ms before physics on the earlier benchmark machine. Memoized policy resolution, cached area footprints and in-place samples bring 6,000/32,768/65,536 creatures to 18/78/177 ms, with state and save hashes identical to the uncached path. [Tick evidence](evidence/physics-ambient-tick.json).

## Scope limits

The physics tests cover circles, static terrain and the reference game's interactions. They do not establish arbitrary-polygon rigid-body behavior. Eight contexts prove real transport and shared-state operation on the tested host; they are not eight remote households behind different NATs. No cross-region latency or TURN fleet capacity has been measured. Browser audio verification checks activation plus generated PCM correctness; there was no human listening panel. The active NPC pool recycles dormant entities, while terrain and quest/resource edits persist. These limitations are explained in the architecture and design report.

## Join recovery

Transport diagnostics exposed a connected WebRTC peer that had not completed application admission. The game now reconciles already-open native channels with PeerJS, acknowledges client readiness with repeated hello/welcome messages, and makes up to three bounded attempts after a transient initial connection failure. Full rooms, incompatible versions and invalid data still fail explicitly. Generation guards keep canceled attempts from replacing a newer session. A browser test closes the first real native data channel deliberately, then verifies that a fresh real connection joins successfully.

## M01 Rapier foundation evidence

On 2026-10-04, `npm run check` passed all 48 headless tests, `npm run build` produced the production bundle and `npm run test:e2e` passed all 17 browser scenarios. The actual eight-client WebRTC scenario also passed after adding explicit host/guest rejection of playground commands and disabled online playground controls. The intentional failed-module test blocks the Rapier chunk, confirms a visible boot alert and verifies reload recovery. A page-disposal test waits five animation frames after unload and confirms that the disposed simulation is not stepped again.

| M01 acceptance | Evidence |
| --- | --- |
| Actual movement, spin and contacts | `tests/physics.test.ts`, `e2e/physics.spec.ts`, [headless scene](evidence/physics-m01.json), [rendered scene](evidence/physics-m01.png) |
| Swept motion | Pairwise cast predicts the wall at fraction 0.745000064; the real CCD body reaches contact without crossing the wall; trajectory tolerance is one Fern unit around the expected center x=118 |
| Browser/Node initialization | Browser bootstrap, CLI, tests and browser save/reload all await the shared barrier; no browser globals are needed by engine imports |
| Snapshot continuation and replay | JSON round trip preserves stable IDs and solved motion; 120 additional test ticks produce the same poses/hash; CLI recording replays successfully |
| Reset/dispose/failure/cancel | 25 reset/restore loops retain exactly one world and queue; close/reset/dispose return counts to baseline; injected failure/retry and canceled waiters do not allocate worlds; page unload cancels animation |
| Solo boundary and existing multiplayer | Host/join reject an open scene; host/guest lab edits are rejected; protocol 3 rejects physical encoding; ordinary eight-client connections, input, combat, progression and slot release pass |

`node tools/physics.ts` reproduces `examples/physics-playground.jsonl` with seed 142 and no ambient population. Its 150-tick scene records 13 contact starts. The wheel moves from x=-140 to x=60.588676 and rotates to -2.155276 radians; the snapshot/replay checks pass. These observations demonstrate mechanics, not balance or performance. The lab exposes its own 4,096-body/4 MB binary-checkpoint safety limits. Adventure actor physics, regional policies and physical co-op remain future milestones.

The former `fps > 20` browser assertion is removed. Entity coverage, visible drawing, interaction and error assertions remain. Build emits an informational size warning for the embedded-WASM Rapier chunk (approximately 3.40 MB minified, 1.30 MB gzip); no FPS or package-size target gates this milestone. CI, merged commit and affected production verification must be inspected through the milestone PR's final receipt, not inferred from these local results.

## M05 materials and destruction evidence

On 2026-10-05, `npm run check` passed **86 headless tests**, `npm run build` produced the bundle and `npm run test:e2e` passed **E2E_COUNT browser scenarios**, including the preserved eight-client WebRTC stories. `npm run verify:run` cleared all nine areas.

| M05 acceptance | Evidence |
| --- | --- |
| Crate splinters, pylon shatters, stone resists, tree leaves stump + pushable log | `tests/physics-materials.test.ts`; [receipt](evidence/physics-m05.json): crate 30-damage hits leave 25% then break into 4 planks (reward 3); pylon breaks in one 20-damage hit into 5 glass shards; a 15-damage hit on stone is resisted at 100%, a 60-damage hit leaves 73.1%; a tree breaks on the fourth 40-damage hit into a fixed stump and a dynamic log that moves 41.5 units under a push |
| Destruction off / dynamics off | Destruction off keeps 37.5% durability through five 200-damage hits; breaking all 19 area-1 parents while dynamics are off spawns 62 pieces (60 frozen, 2 fixed stumps), all wake with 0 blocked, and no parent is rebuilt |
| No repeated destruction/reward | Real slash input breaks a barrel, then 20 more swings at the site: unique records, unique pieces, gold rises by recorded rewards once; 300 ticks of resting contact add nothing |
| Save/load, recall, late join | Raw and portable restore, agent replay (hash equal), recall to another land and back, and a late-join replica all reproduce the same destroyed records and pieces. In the browser, a real mouse attack breaks a pylon; a connected guest and a late joiner over actual WebRTC see the host's destruction and partial durability (`e2e/physics-materials.spec.ts`) |
| Readable silhouettes and recipe export | [Verdant](evidence/physics-m05-verdant.png), [broken](evidence/physics-m05-broken.png), [Cinderwild](evidence/physics-m05-cinderwild.png), [Pale Orchard](evidence/physics-m05-orchard.png); `actors/recipes` is byte-identical across calls (SHA-256 in the receipt) |
| M04 migration | Real M04 checkpoints from `main` 9bd16f0 (raw and portable, with an archived land) restore with exact legacy crate/wheel bodies and gain M05 scenery once (20 → 84 props per land) |

Scenery rewards raise route gold (area 9: 3,047 against M04's recorded 2,424; level 19 against 18); combat tuning is unchanged. These are mechanics observations, not performance claims.