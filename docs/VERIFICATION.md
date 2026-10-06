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

The browser suite starts isolated app/signaling processes on ports 5187 and 9018. `BASE_URL` targets an existing app, including production. No simulated WebRTC adapter is used. Chrome runs headlessly with background throttling disabled for multiple test tabs. The eight-client test places most clients in the lab to avoid conflating connection correctness with eight competing renderers on one workstation; one guest renders the 6,000-creature scene, then switches to a 512-creature budget without changing the host population. Co-op scale is not a performance gate ([D53](physics/DECISIONS.md)); the 32,768-creature room transfer that test used through M07 was removed on 2026-10-05. Native fullscreen tests assert `document.fullscreenElement` and the canvas's actual viewport bounds. A separate denial test deliberately rejects the native API to verify the fallback.

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
| Higher-capacity saves and network | Atomic IndexedDB saves and protocol-2 packets with per-guest budgets | A distant 65,536-creature world with 2,048 painted tiles saves and restores exactly; legacy saves still load; real co-op transfers 6,000 creatures (32,768 through M07) |
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

On 2026-10-05, `npm run check` passed **86 headless tests**, `npm run build` produced the bundle and `npm run test:e2e` passed **26 browser scenarios**, including the preserved eight-client WebRTC stories. `npm run verify:run` cleared all nine areas.

| M05 acceptance | Evidence |
| --- | --- |
| Crate splinters, pylon shatters, stone resists, tree leaves stump + pushable log | `tests/physics-materials.test.ts`; [receipt](evidence/physics-m05.json): crate 30-damage hits leave 25% then break into 4 planks (reward 3); pylon breaks in one 20-damage hit into 5 glass shards; a 15-damage hit on stone is resisted at 100%, a 60-damage hit leaves 73.1%; a tree breaks on the fourth 40-damage hit into a fixed stump and a dynamic log that moves 41.5 units under a push |
| Destruction off / dynamics off | Destruction off keeps 37.5% durability through five 200-damage hits; breaking all 19 area-1 parents while dynamics are off spawns 62 pieces (60 frozen, 2 fixed stumps), all wake with 0 blocked, and no parent is rebuilt |
| No repeated destruction/reward | Real slash input breaks a barrel, then 20 more swings at the site: unique records, unique pieces, gold rises by recorded rewards once; 300 ticks of resting contact add nothing |
| Save/load, recall, late join | Raw and portable restore, agent replay (hash equal), recall to another land and back, and a late-join replica all reproduce the same destroyed records and pieces. In the browser, a real mouse attack breaks a pylon; a connected guest and a late joiner over actual WebRTC see the host's destruction and partial durability (`e2e/physics-materials.spec.ts`) |
| Readable silhouettes and recipe export | [Verdant](evidence/physics-m05-verdant.png), [broken](evidence/physics-m05-broken.png), [Cinderwild](evidence/physics-m05-cinderwild.png), [Pale Orchard](evidence/physics-m05-orchard.png); `actors/recipes` is byte-identical across calls (SHA-256 in the receipt) |
| M04 migration | Real M04 checkpoints from `main` 9bd16f0 (raw and portable, with an archived land) restore with exact legacy crate/wheel bodies and gain M05 scenery once (20 → 84 props per land) |

The first full browser runs exposed a regression: with 2,400 creatures the adventure loop ran at 5–10 FPS and its area could not clear in time. A pre-existing per-tick pose validation deep-cloned every body, and the test controller's `observe()` hashed a full save with its byte array serialized as JSON; M05 multiplied the bodies behind both. After the fix, the Node combat tick median is 16.6 ms against main's 19.5 ms and the pre-fix 32.8 ms, and an idle tick takes 2.1 ms against 3.3 and 12.9 ms. Browser `observe()` takes 28 ms against main's 46 ms, and the adventure controller runs at 12.7–14.3 FPS against main's 10.8–12.8 ([tick evidence](evidence/physics-m05-tick.json)).

Scenery rewards raise route gold (area 9: 3,043 against M04's recorded 2,424; level 19 against 18); combat tuning is unchanged. These are mechanics observations, not performance claims.

## M06 combat forces, projectiles and physical loot evidence

On 2026-10-05, `npm run check` passed **98 headless tests**, `npm run build` produced the bundle and `npm run test:e2e` passed **29 browser scenarios**, including the preserved eight-client WebRTC stories and three new M06 scenarios. `npm run verify:run` cleared all nine areas (level 18, 2,717 gold; [route](evidence/physics-m06-route.jsonl)). The numbers below come from the [receipt](evidence/physics-m06.json) (seed 142, area 1, one stationary monster).

| M06 acceptance | Evidence |
| --- | --- |
| Thrown or Whorl-launched crate damages a monster and rewards the party once | A held crate thrown at a 15 HP monster lands one owned `impact:hit` of 17.41 and kills it. Hero kills go 0 → 1, and two ordinary drops appear. 120 more ticks of contact add no drops or kills. A Whorl-launched crate lands one owned impact (8.29). |
| Unowned rolling object invents no credit | A crate set rolling at 420 units/s with no instigator kills a 1 HP monster. The kill event has owner `""` and text `environment`; hero kills stay 0 and no drops are added. |
| Impact policy | The same owned crate hurts for 18.24 by default, 36.48 at `impactStrength` 2, and 0 with `impactDamage` off. The crate still travels 91 units with impact damage off. |
| Thornlance and enemy shots honor cover/pierce rules | A pot shatters and the lance flies on with 5 pierces left. A crate breaks and costs one pierce (4 left). Stone stops it (`stone:cover`); with one Static Charge ricochet it deflects (`stone:deflect`, vx 470 → −470). An enemy shot behind a crate is stopped as cover (0 hero damage). With `projectileWorld` off the same shot passes the crate and hits (7.89). |
| Each active ability's physical consequence | Peak crate speed within 20 ticks: slash 145 (moves 38.6), Whorl 348 (92.6), dash 324 (92.1). Thornlance and Bloom Nova break the 40-toughness crate into 4 owned pieces at 462 and 449 units/s. Every pushed prop is instigated by the attacker. |
| Grab/throw discoverable on desktop and touch | The real V key, a mouse throw and held mouse and J-key slashes are checked in `e2e/physics-combat.spec.ts`; the touch Grab and attack buttons on a 390×844 viewport; and a WebRTC guest grab/throw through acknowledged host actions with a host distance rejection. Host messages: "Move within 72 units to grab it", "That prop is fixed in place here", "Another traveler is holding that". The holder walks 70 units with the crate carried 24 units ahead; the hold survives restore and ends when the region freezes props. [Prompt](evidence/physics-m06-grab.png), [held](evidence/physics-m06-held.png), [touch](evidence/physics-m06-touch.png). |
| Physical loot settles, collects, saves; off stays collectible | Both drops from a kill get loot bodies and move 44–46 units while settling. Raw restore keeps the same loot bodies, and the magnet collects exactly the dropped 5 gold. With `physicalLoot` off a 7-gold drop has no body and is still collected. An item resting on deep water is moved to reachable ground. [Combat with settling drops](evidence/physics-m06-loot.png). |
| Physical modifiers ride existing systems | Edgecraft (shatter), Ironwood (force) and Static Charge (ricochet) stay among the 48 nodes. 88 of 400 level-20 rolls carry a physical affix, with ricochet on weapons only. Whorl launches the crate at 337 / 405 / 539 units/s with Ironwood at 0 / 1 / 3 ranks. |
| Saves, replay, late join, migration | A pending impact (crate → monster, closing 271, damage 17.41, owner local) saved at a tick boundary lands after restore. Agent replay matches the host hash (`7ae03931`), and a late joiner's combat record equals the host's. A real M05 raw checkpoint (envelope 3 / world 5) restores to envelope 4 / world 6 with its destruction intact. |

The attack registry export hashes to `660eb8bf…` and is byte-identical across calls. In the browser, a held real mouse button and a held J key each produce slash events within two seconds, after a grab and throw. These are mechanics observations, not performance claims.

## M07 jointed mechanisms evidence

On 2026-10-05, `npm run check` passed **111 headless tests**, `npm run build` produced the bundle and `npm run test:e2e` passed **32 browser scenarios**, including the preserved eight-client WebRTC stories and three new M07 scenarios. `npm run verify:run` cleared all nine areas (level 18, 2,676 gold; [route](evidence/physics-m07-route.jsonl)). The numbers below come from the [receipt](evidence/physics-m07.json) (seed 142, area 1, monsters and area mechanics cleared).

| M07 acceptance | Evidence |
| --- | --- |
| A gate swings around its hinge | A 600 impulse swings the leaf to exactly its 1.9 rad limit with the pin gap at 0. It latches open (`gate:latched`, motor target 1.6, saved) and holds 1.62 rad two seconds later. A slow push closes it (`gate:closed`). |
| A tether limits motion | Pulling the vine pod for 40 ticks keeps it at 69.9 of its 70-unit reach with every link intact. A 700 units/s yank loads the tether to 373 (break load 260): the pod rope snaps (cause `strain`) and the pod flies 327 units out. |
| A broken anchor releases with visible inherited motion | The ball swings at 227 units/s, 53 units from its post (reach 58.5). Cutting the anchor leaves it at 220 units/s in the same direction (cosine 1.00); 40 ticks later it is 86 units out. The event is `chain:anchor:cut` owned by the traveler. [Swinging](evidence/physics-m07-chain.png), [freed](evidence/physics-m07-freed.png). |
| Switching joints off | `mechanisms` off freezes all 19 dynamic members of area 1; loose crates keep moving. Poses are bit-identical after an impulse and 30 ticks. A pod cut while frozen becomes a loose prop. On resume, parts wake with at most 1.69 units/s and 0.02 units of displacement; the cut link stays cut. |
| Switching joint breakage off | A 700 units/s yank loads the anchor to 4,275 (break load 2,600) and nothing snaps. A cut is refused (`protectedByPolicy`). With breakage back on, the same yank snaps the anchor and the ball joint. With joints off and breakage on, a cut severs a frozen joint, and the freed ball moves 125 units once mechanisms resume. |
| No half chain across a region boundary | A quiet region over the ball alone leaves the chain moving, because the part follows its post. A quiet region over the post freezes all 5 dynamic members. A checkpoint whose member's policy sample differs from its root is rejected. |
| Required travel stays reachable; shortcuts stay worthwhile | Every mechanism part and companion is at least 95 units from the entry–exit lane and every portal. Of 200 encounter rolls, 1 fell in the gate pen and was moved out: no wave starts penned. Over 20 ticks, a traveler crosses 41.7 units on the causeway and 22.3 wading beside it. A frozen anchored causeway (master off) still gives 41.7. Cutting both lashings emits `bridge:span-lost` and ends the deck. |
| Authored events versus physical-only motion | The launcher is cocked at −10.2 units by a held pull. Released, it fires (`launcher:fired` owned by the traveler) and throws its stone at 388 units/s, instigated by the cocker. Chain, vine and vane move only physically. [Touch cocking](evidence/physics-m07-touch.png). |
| Whorl, pulling, throwing and charges | Whorl sends the ball to 103 units/s, owned by the traveler. A held gate dragged away opens to 1.08 rad and loads its hinge to 1,200 (break load 1,400). A thrown pod snaps the vine (`vine-1:pod:strain`), owned by the thrower. An enemy charge swings the gate to 1.2 rad. |
| Units and portals | A freed chain (ball plus four links) carried through a rift lands with zero offset error and intact joints. An anchored gate releases the hold and stays put. |
| Membership, broken links and motor state survive save/load and late join | An unstepped raw checkpoint round-trips byte for byte. A raw restore matches the host hash after 10 ticks, the agent replay matches (`7669d8d3`) and portable joint state is equal. A late-join replica carries identical joints and mechanism state. Leaving for another land and returning keeps the cut vine link and both motors (gate 1.6, vane −2). In the browser, a guest over actual WebRTC throws the pod free through host actions, and a late joiner sees every broken link, the latch and its motor. |
| M06 migration | A real M06 checkpoint (envelope 4 / world 6, from `main` dcff3f9) restores to envelope 5 / world 7. It gains 24 assemblies once (a second restore adds nothing) and its pre-M07 archived land is untouched until it is entered again; returning adds that land's mechanisms and keeps its destroyed pot. |

[North meadow with a latched gate, the drifting cut causeway, the launcher and the vane](evidence/physics-m07-meadow.png). The registry export hashes to `b0a40cb4…` and is byte-identical across calls. These are mechanics observations, not performance claims.


## M08 material reactions and fields evidence

On 2026-10-05, `npm run check` passed **121 headless tests**, `npm run build` produced the bundle and `npm run test:e2e` passed **34 browser scenarios**, including the preserved WebRTC stories (now functional smoke checks, [D53](physics/DECISIONS.md)) and two new M08 scenarios. `npm run verify:run` cleared all nine areas (level 18, 3,033 gold; [route](evidence/physics-m08-route.jsonl)): reaction-broken scenery pays its rewards. The numbers below come from the [receipt](evidence/physics-m08.json) (seed 142, area 1, monsters and area mechanics cleared unless a scenario places its own).

| M08 acceptance | Evidence |
| --- | --- |
| Ignition and extinguishing | Fire on a crate burns it for 540 ticks: two burn pulses take it to 32.5% durability, and the fire spreads to the three crates and the wheel touching it. A water stimulus puts it out (`extinguish`, 900 wet ticks); 60 ticks later its durability is unchanged. A new flame on the wet crate only steams it (wet 900 → 540, no ignition). |
| Wet and metal conduction | A broken water cask leaves a 46-unit puddle; a monster standing in it is soaked (593 ticks). One slash on the storm coil sends the discharge through both rods, the puddle and the cask pieces (16 arcs, 40 visited keys): the wet monster takes 50 damage and a dry monster away from conductors takes none. The discharge sparks the powder keg, whose blast breaks the second cask. The chain is owned by the striker: conduct → detonate → spill → soak → ignite → steam → extinguish. |
| An explosion moving other objects | A lit keg explodes after its 50-tick fuse. Its pressure throws a 5,000-health monster 20.9 units outward (36 damage) and moves or breaks every dynamic prop within range. A 20-health monster is killed with the igniter's credit. Blast damage breaks the fuse brush, both casks and two fence sections (all credited to the igniter) and the casks spill. |
| A field bending a fight | A struck fan drives a monster that was walking upwind 49 units downwind in one second; with environmental forces off it advances 29 units. The fan blows a water cask 151 units. The authored wind lane spins the meadow vane at 1.52 rad/s against 0.67 calm. A Gravity Knot field pulls a pot 69.2 units toward its centre: 33.3 at field strength 0.5 and 0 at 0. [Touch gust](evidence/physics-m08-touch-gust.png). |
| A reproducible chain of three or more rule types, with causes and attribution | Fire on the first brush segment runs the fuse in 17-tick steps (`spread`, depths 1–4), lights the keg (`detonate:fuse`, depth 5) and explodes at tick 142. The blast spills both casks, whose water soaks and steams the debris and puts out a burning stave. Rules: ignite → spread → detonate → spill → soak → steam → extinguish, depth 6, 37 events. A monster beside the keg dies with the igniter's credit and ten destroyed records name the igniter. Two fresh runs are byte-identical (state hash `89ebdc85`). [Flare](evidence/physics-m08-flare.png), [blast](evidence/physics-m08-blast.png). |
| Propagation off and material reactions off | Chain reactions off: the struck brush burns, its neighbour never catches, and a struck coil's chain visits only the coil. Material reactions off: a burning log's remaining 537 ticks stay 537 for 120 ticks and do no damage, and new stimuli add nothing. A slash still deals 15 and Cinderwake's combat burn still applies. Re-enabling produces 0 extra events. |
| Region policy at source and target | A small region with material reactions off over the third brush segment stops the fuse there: the second segment burns, the third never catches and the keg never lights. |
| Mid-chain save and guests | A checkpoint taken mid-chain (a burning segment, a puddle) restores raw and continues with an identical state hash. Portable restores keep identical reaction state, and the agent replay matches (`a3ffd4b7`). A late-join replica receives byte-identical statuses, surfaces, fields, delayed reactions and chains, and a guest can inspect but not stimulate. Leaving for another land and returning keeps fires burning and puddles in place. In the browser, a burning oil slick survives a page save/restore and keeps burning down. |
| M07 migration | A real M07 checkpoint (envelope 5 / world 7, from `main` `fcba70a`) restores to envelope 6 / world 8 and gains 56 yard props and its wind lanes once. Its archived pre-M08 land is untouched until entered again; returning adds that land's yard and keeps its cut vine link and destroyed pot. |

In the browser, real V/WASD/mouse input carries an oil jar onto the brazier until it bursts into a burning slick, and a real mouse slash on the coil sets off the keg. A touch Slash on the fan drives the casks downwind. [Yard](evidence/physics-m08-yard.png). The registry export hashes to `903ca4539da3e2cd` and is byte-identical across calls.

Feedback-volume note: with a reaction yard beside every clearing, a long fight produces more events. Two M05 browser and headless checks now read the full event ring (or collect events as they happen) instead of the latest 12 or 96 entries; their assertions are unchanged.

Rendering and simulation cost (informational, D53): with no other load, reactions add about 8% to a headless combat tick (median 15.7 ms against 14.5 ms with all three switches off, 2,400 creatures). In the browser, 47 burning bodies add about 7 ms per frame (36 ms against 29). Two pre-existing per-tick and per-frame pose clones were removed: terrain synchronization and the renderer now read positions directly. The full-population browser clear (64.9 s against 64.1 s on `main` in the same container) was given more wall-clock time.

## M09 physical rigs evidence

On 2026-10-05:

- `npm run check` passed **134 headless tests** and `npm run build` produced the bundle.
- `npm run test:e2e` passed **38 browser scenarios**, including four new M09 scenarios and the preserved WebRTC smoke checks ([D53](physics/DECISIONS.md)). The fourth new scenario checks that a key tap shorter than one frame still casts once. CI exposed that race: on its slower frames, an existing Whorl press was lost, and taps are now latched until a tick consumes them. `FERN_VIDEO=1` records the real-input video; recording needs Playwright's ffmpeg, so the default suite runs unrecorded against any Chrome. After the merge, the M06 held-attack check measures responsiveness in simulation time: a new slash within 36 ticks of the press. Its old 2 s wall-clock window was about 25 ticks on a slow runner (local 3× CPU throttling; M08 and M09 run at the same browser tick rate), which main CI missed once. The state hash now leaves out presentation-only hero recoil and foliage bend ([D69](physics/DECISIONS.md)). Main CI's browser-to-Node replay check (M01) had diverged about 1 run in 8, only in the lantern's last digits, because Chromium's and Node's `Math.sin` differ for about 3.7% of inputs. 42 local attempts matched afterwards.
- `npm run verify:run` cleared all nine areas (level 18, 2,659 gold; [route](evidence/physics-m09-route.jsonl)). Staggers and knockdowns now interrupt monster attacks.

The numbers below come from the [receipt](evidence/physics-m09.json) (`node tools/physics-rigs.ts`; seed 142, area 1, other monsters removed).

| M09 acceptance | Evidence |
| --- | --- |
| Six rigs, each with an inspected moving capture of a distinct hit and death response | The [frame-by-frame sheet](evidence/physics-m09-steps.png) (idle, hit, recoil, knockdown, recovered, death, falling, landed, rest; one row per rig) and a [real-input video](evidence/physics-m09-rigs.webm) of held-mouse slashes felling each rig. Peak lean from one 20-damage blow: <ul><li>wraith 0.75 rad (floating sway);</li><li>stalker 0.56;</li><li>crawler 0.32;</li><li>totem 0.29, displaced only 2.4 units against the stalker's 9.8 (rooted);</li><li>brute and warden 0.21.</li></ul> Under sustained 70-damage blows: <ul><li>a wraith goes down after 7, a stalker and a crawler after 8, a brute after 14 and a warden after 23;</li><li>a totem only staggers (30 blows, five staggers) and sheds its crown;</li><li>bosses only stagger.</li></ul> Deaths: <ul><li>stalker, brute and warden topple sideways (fall 1.69 rad);</li><li>the crawler flips onto its back (2.98 rad);</li><li>the wraith's shroud slumps (0.77 rad) and spreads while its glass core rolls loose;</li><li>the totem's trunk is felled while its roots stay a fixed body.</li></ul> Ragdolls have 4–10 jointed bodies, the brute and warden lose 3–4 armor or bark props, and each lands once, 14–30 ticks after death, with `fall:<rig>:<material>`. |
| A dead body reacts to Whorl or a field, then freezes or settles when ragdolls are disabled; saves cannot revive it or repeat its reward | A settled stalker ragdoll is thrown 90.1 units by Whorl and carried 103.7 by a wind lane. With ragdolls off (an area override, or the Agent lab panel in the browser) every jointed body freezes and another Whorl moves it 0. Re-enabling wakes it in place with zero motion, and it reacts again. Raw saves continue with an identical state hash. After restore, 0 monsters are alive, kills stay 1 → 1 and no new drop exists. A page save/restore in the browser keeps kills single. Where ragdolls are already off at death, no bodies are made and the authored fall plays and fades. |
| Limbs stay with their art; interpolation, joint limits and ground contact stay legible | Every part's collider equals its art bounds (all rigs, all four variants, tested). At spawn, each hinge's two anchors coincide, and the root sits where the drawn root was, turned through the fall. After 200 ticks and a Whorl every hinge's gap is 0.000 and its relative angle is within limits (±0.08). The fall is drawn as a rigid rotation that lands on the solved poses. Remains have ground shadows per part, sort as one body at their lowest point and fade before their 45 s expiry. |
| The player responds immediately; NPC services stay usable; desktop and mobile agree; guests receive the same poses and results | With and without a large injected recoil (lean 0.25, lantern 0.9), the wayfarer's trajectory is identical and a reversal is followed at once. In town the traveler shoves Rowan 29.7 units (`npc:bump:rowan`, a startled mark), the shop opens where Rowan stands, and Rowan walks back to within 2.1 units in 4 s. A touch Slash fells a stalker the same way a mouse does. A guest's portable scene holds identical remains bodies and rig state, and `enemyPose` on a decoded header equals the host's. Local camera shake and flashes set to 0 report 0 in `observe().render.feedback`. |

Also covered:

- **Shedding:** brute bark is wood, warden plates are metal and totem crowns are wood, never duplicated at death.
- **Status transfer:** a burning monster's remains keep burning.
- **Expiry:** 2,700 ticks remove the whole assembly, its joints and its record.
- **Foliage:** a wind lane bends a tree canopy, walking through brush bends it, and foliage off returns both to rest and ignores blows.
- **Reaction strength 0:** no recoil or stagger.
- **Master off:** recoil shows, but no stagger, knockdown or shedding.
- **Determinism:** two runs of the same six-rig fight hash equal.
- **M08 migration:** a real M08 checkpoint (envelope 6 / world 8, from `main` `a53af8d`) restores to envelope 7 / world 9 with rigs at rest, and its earlier death makes no remains.

Captures: [Whorl](evidence/physics-m09-whorl.png), [settled with ragdolls off](evidence/physics-m09-settled.png), [town shove](evidence/physics-m09-town-shove.png), [touch stalker](evidence/physics-m09-touch-stalker.png).

## M10 reactive towns and authored areas evidence

On 2026-10-06:

- `npm run check` passed **149 headless tests** (15 new in `tests/physics-world.test.ts`), and `npm run build` produced the bundle.
- `npm run test:e2e` passed **41 browser scenarios**, including the three new M10 scenarios in `e2e/physics-world.spec.ts` and the preserved WebRTC smoke checks ([D53](physics/DECISIONS.md)).
- Both routes cleared all nine areas without a death and visited both towns, where the bot rested, sold spares and bought an upgrade:
  - `npm run verify:run`, reactions on: level 17, 3,599 gold, 5,017 area ticks ([route](evidence/physics-m10-route.jsonl)).
  - `node tools/adventure.ts playthrough 9 --reactions off`, with the session master switch off: level 19, 3,729 gold, 4,818 area ticks ([route](evidence/physics-m10-route-reactions-off.jsonl)).

The numbers below come from the [receipt](evidence/physics-m10.json) (`node tools/physics-world.ts`, seed 142).

| M10 acceptance | Evidence |
| --- | --- |
| Areas 1–8 each show a distinct physical interaction, captured | [Area sheet](evidence/physics-m10-areas.png): each area's extension triggered by real input in the browser (slash, walking across, E, Q). Measured: <ul><li>Brambleburst: 8 owned splinters and a 28.8-unit shove (wild 47.9; calm 8.9, base hit only, 0 hedges);</li><li>Slipstream: lanes carry barrels 92.7 and 95.2 units in 2 s, the calm lane's 0;</li><li>Stormglass: 10 arcs through a wet pack;</li><li>Echo Wells: stones relaunched from 47.3 to 129.6 units/s with cause `echo:whorl`, 0 extra gold;</li><li>Cinderwake: 4/4 stockade boards burnt, calm 0;</li><li>Bloodbloom: 6 vines pull monsters in by 36–72 units;</li><li>Gravity Knots: material and pack travel 132 and 117 units, 9 apart;</li><li>Riftstep: 3/3 freight carried, all surviving the arrival and bursting 91–117 units outward.</li></ul> Area 9 combines echo, gravity and bramble set pieces. |
| Enter the two following towns and keep the build and loot loop | Both routes rest, sell and buy in Emberrest and Tideglass Haven. The town is tactile ([capture](evidence/physics-m10-town.png), [lamp](evidence/physics-m10-town-lamp.png)): a slash swings a lamp 0.35 rad and it settles to 0.000; the bunting travels 5.3 units in 2 s; hard strikes on all ten goods destroy nothing. A browser scenario reaches the hearth, Rowan's shop and the gate by real keys. |
| The route completes with optional reactions off; nothing can block progression or a service | The reactions-off route clears nine areas, so every area clears by kills alone. Headless, with the master off in Cinderwake: no fixed bramble or cinder set piece sits on the entry → centre → outward-gate line, the warden comes when the goal is met, and the outward gate leads on. Under a Reactive town with every good piled on the hearth and Rowan's post, the repel rings clear them within 5 s. Set pieces never spawn overlapping (seeds 142 and 7). |
| Wardens: physical arena interactions with readable telegraphs and dodge windows | All eight telegraph for 64 ticks with the target locked at the start ([telegraph](evidence/physics-m10-warden-telegraph.png)). Each is exposed by its own area's rule (pod, crash, wet shock, echo, douse, lash dash, launched prop, rift arrival), taking 1.5× damage ([exposed](evidence/physics-m10-warden-exposed.png)). |
| Late-join replica agrees with the host's scene and scope labels; WebRTC scenarios pass | Headless: a guest's portable scene holds the same set pieces, restraints and region labels as the host. Raw and portable saves round-trip the showcase state, and a real M09 checkpoint migrates. The existing WebRTC browser scenarios pass. |

Also covered:
- **Calm and wild regions:** the same mechanic plays three ways in one area. Calm keeps world reactions on for ambient selection.
- **Canonical land build:** `settle()` makes a new land's save equal its own restore ([D76](physics/DECISIONS.md)).
- **Hinge motor fix:** a lamp blow now swings it, 22.5 units/s against 3.3 before ([D77](physics/DECISIONS.md)).
- **Main CI follow-up:** after the merge, the M09 ragdoll scenario sometimes felled its warden inside area 1's new `calm-1` region (2 of 6 local repeats), where calm values freeze ragdolls, so Whorl moved it 0. The scenario now fights west of the trailhead on open ground with no region (6/6 repeats pass). The game behaviour was correct.
- **Engine-independent trig in per-tick physics** ([D82](physics/DECISIONS.md)): PR CI's lab replay check diverged once the town had motor-driven joints. Locally, the old trig code diverged in 7 of 12 repeats of that scenario; with `dsin`/`dcos`, 12 of 12 lab repeats and 8 of 8 town replay repeats match. The receipt is byte-identical, the reactions-off route is unchanged, and the reactions-on route differs only in area 9's clear time.

## M11 generated encounters evidence

On 2026-10-06:

- `npm run check` passed **160 headless tests**, 11 of them new: 10 in `tests/physics-encounters.test.ts`, and the D91 regression in `tests/physics-world.test.ts`. `npm run build` produced the bundle.
- `npm run test:e2e` passed **43 browser scenarios**, including the two new M11 scenarios in `e2e/physics-encounters.spec.ts` and the preserved WebRTC smoke checks ([D53](physics/DECISIONS.md)).
- Both routes cleared all twelve areas, four of them generated, without a death. The bot rested, sold spares and bought an upgrade in all three towns.
  - **`npm run verify:run`, reactions on:** level 23, 4,826 gold, 5,350 area ticks ([route](evidence/physics-m11-route.jsonl)).
    - Area 10: walking to the coil and slashing it set off the storm pool: discharge down the rods, then soak, steam and fire chains in the same cluster, with two of its casks broken.
    - Area 12: grabbing an oil jar with V and walking it into the brazier's coals burnt the stockade through (four barricades, five fuse brushes and the cache).
    - Areas 9 and 11 hold only fuse and field combinations (vortex powder, powder trail, rubble maelstrom), which need carried fire or run on their own. They were cleared by combat alone.
  - **`node tools/adventure.ts playthrough 12 --reactions off`**, with the session master switch off: level 24, 4,772 gold, 4,850 area ticks ([route](evidence/physics-m11-route-reactions-off.jsonl)).
    - The same coil slash only drives the field rule.
    - The jar grab is refused ("That prop is fixed in place here").

Main-CI follow-up ([D93](physics/DECISIONS.md)): the Burning palisade's fuse now starts within a slick's reach from almost any side of the coals. The receipt is unchanged, both routes were rerun (numbers above), and the browser scenario passed 20 of 20 local repeats.

Two later main-CI follow-ups changed browser scenarios only. PR #23 made the M10 town scenario rest at the hearth and reach Rowan from a settled stand (24 of 24 repeats). PR #24 cleared Brambleburst's waves in the M07 WebRTC vine scenario (20 of 20 repeats). Main CI then passed on `5a73ad4` (run 37530019535).

The numbers below come from the [receipt](evidence/physics-m11.json) (`node tools/physics-encounters.ts`) and `tests/physics-encounters.test.ts`.

| M11 acceptance | Evidence |
| --- | --- |
| A fixed seed corpus across all five themes and a range of depths (with a large index) shows at least twelve distinct meaningful combinations and several boss assemblies | Seeds 142, 7, 2026 and 31337 × areas 9–25, 33, 101, 4001 and 1,000,001: **84 areas** over glass, dusk, frost, verdant and cinder lands. **All 14 combinations** appear, from 2 (briar blaze) to 28 (rubble maelstrom) times. There are **77 distinct warden assemblies** (rig, armor, composed moves, arena) and all four armor kits. Every area has 0 overlapping bodies, every link within reach and every route open. 99 fallbacks are recorded and none leaves a planned cluster or filler out. Each combination's chain fires in a real simulation: <ul><li>wading crawlers shocked 600 → 577 (coil) and 600 → 569 (pylon);</li><li>a stockade burnt through 155 ticks after a jar met the coals;</li><li>2/2 powder barrels blown by a fuse, together in a vortex and by a launched stone;</li><li>a doused fuse whose last brush stays unburnt;</li><li>4/4 rubble pieces carried by a vortex or a lane;</li><li>a ball shattering glass into a discharge;</li><li>a cargo train through a rift with 3/3 members and both ropes intact.</li></ul> |
| At least three generated areas beyond area eight are completed through normal inputs; one shows a multi-system interaction, one finishes with reactions disabled | Both routes above clear generated areas 9–12 with ordinary inputs and validated actions only. Multi-system interactions started by input:<ul><li>area 10: a coil slash discharges into the pool, and fire, soak and steam follow in the cluster;</li><li>area 12: a jar carried into the brazier lights a slick and a fuse that burn the stockade open.</li></ul> The reactions-off route clears the same four areas. |
| Initial recipes reproduce from seed; saved broken and moved state stays authoritative; invalid references and impossible placements fail validation visibly | Two simulations of seed 142 build identical module bodies in area 9, and a fresh build reproduces the manifest. A broken and a moved piece survive raw and portable saves, restore (equal state hash after 20 more ticks) and travel to the next land and back. A real M10 checkpoint of area 9 keeps its earlier content and its broken crate. `encounters validate` reports `unknown module trebuchet` and a tampered manifest ("does not reproduce"). A rift-freight cluster forced into an area without arches fails as an impossible placement. |
| A generated encounter after save/load and through a late-join replica; no hidden body cap or FPS-driven substitution | The receipt lights a powder trail, saves 30 ticks into the chain and restores: the restored run reaches the same state hash 240 ticks later. A late-join replica receives every generated body, the cluster regions and a warden's armor mounts, and `encounters export` on the guest reads the manifest. Nothing in placement or play depends on frame rate or a body budget. Generated content is a pure function of recipe, palette and terrain. |

Composed wardens (receipt, four armor kits):

- Censer-bearer (2 censers) and Stonehide (2 boulders) take 0.76 of each blow while armored, Glassmantled (3 shards) and Barkbound (3 plates) 0.64.
- A shock cracks every glass shard in one tick; a blast breaks the boulders and knocks the censers loose; fire burns bark plates one by one.
- Stripped of armor, the warden takes the full blow.
- Mount tethers snap under a 900 units/s yank; every mount is released when the warden dies.
- With mechanisms off at its ground, the warden spawns unarmored.

## M12 controls, showcase and release evidence

On 2026-10-06:

- `npm run check` passed **190 headless tests**, 30 of them new: 4 in `tests/physics-controls.test.ts` and 26 in `tests/physics-matrix.test.ts` (24 values, the dependency combinations and a coverage check). `npm run build` produced the bundle.
- `npm run test:e2e` passed **48 browser scenarios** twice, with one worker: in 20.2 minutes, and in 17.8 minutes on the final tree carrying the M11 main-CI follow-ups (PRs #23 and #24). Five are new: four in `e2e/physics-controls.spec.ts` and the showcase in `e2e/showcase.spec.ts`. The existing WebRTC smoke checks also pass ([D53](physics/DECISIONS.md)).
- Both routes were rerun on the M12 tree and are byte-identical to M11's: M12 changes no simulation rule.
  - `npm run verify:run`, reactions on: level 23, 4,826 gold, 5,350 area ticks.
  - `node tools/adventure.ts playthrough 12 --reactions off`: level 24, 4,772 gold, 4,850 area ticks.
  - The committed route files are [physics-m11-route.jsonl](evidence/physics-m11-route.jsonl) and [physics-m11-route-reactions-off.jsonl](evidence/physics-m11-route-reactions-off.jsonl).
- `npm run showcase` passes all six beats ([receipt](evidence/physics-m12-showcase.json)). The browser showcase passed 5 of 5 local runs plus one recorded run.
- The M12 PR also steadies the M11 Burning palisade scenario. In CI its slow key-holding loop circled the coals and smashed fuse brushes with the carried jar, so the fire stopped short of the stockade. It now steps the jar in short key pulses: 20 of 20 local repeats pass, and 10 of 10 under 3× CPU throttling, against 4 failures in 26 instrumented repeats before.

### Functional matrix

| M12 matrix item | Evidence |
| --- | --- |
| Authored outward run | Both routes clear authored areas 1–8 by ordinary inputs and rest, sell and buy in each town. `e2e/adventure.spec.ts` plays the build, combat, loot, outward-travel and resupply loop in the browser. |
| Generated continuation | The same routes continue through generated areas 9–12 and the third town. Area 10's coil slash and area 12's jar-in-the-coals chain are started by input (M11 above). |
| Controls disabled | The reactions-off route clears all twelve areas with the session master off. The matrix switches each of the 24 values off in a region and measures the suppressed effect ([measured](evidence/physics-m12-matrix.json)). The browser scenario turns loose props and destruction off in the panel: a crate struck there stays put and whole. |
| Dependency combinations | One test each, not every permutation: <ul><li>master off with destruction and loose props requested on: the values stay visible, the master wins, and a 5,000 blow neither moves nor breaks the crate;</li><li>base combat without reactions: a monster is still hurt and killed, with credit;</li><li>joints off with breakage on: the chain is frozen, a cut still severs it;</li><li>destruction off with impact damage on: a thrown crate still hurts and stays whole.</li></ul> Region boundaries crossed both ways and broader overrides: `tests/physics-policies.test.ts`. |
| Save during an active reaction | Each matrix case saves its off state and restores it with the effect still suppressed. Mid-chain timers, mid-fall ragdolls and an M11 powder trail saved 30 ticks into its chain resume exactly (`tests/physics-reactions.test.ts`, `tests/physics-rigs.test.ts`, the M11 receipt). |
| Legacy save migration | Real checkpoints from M02, M05, M06, M07, M08, M09 and M10 migrate in their milestones' tests. M12 changes no save, protocol or world version. |
| Scoped overrides | The panel tests edit the area, a calm region (Wild preset, grown, raised, reset to authored), a new custom region and the session master, then undo everything. A browser scenario does the same with touch in the wild ring. |
| Same-build replay and debugging | `e2e/game.spec.ts` replays deterministically in the browser. The panel's inspector reports an object's material, motion, policy source, mechanism, last reaction and last push (headless test and browser pick). |
| Co-op over real WebRTC | `e2e/physics-controls.spec.ts` covers a host and a guest over a real data channel. The guest's panel shows the host's values, read-only. A host edit reaches the guest and a late joiner, and after the guest disconnects the host and the late joiner keep it. `e2e/game.spec.ts` joins eight clients, the party size the game supports, rejects a ninth and releases slots. |

### Milestone experiences

Every milestone's experience is reachable in the game or a deliberate tool:

| Milestone | Where to find it |
| --- | --- |
| M01 Rapier foundation | The Agent lab tab's "Physics lab · developer tools" panel; `physics` agent commands |
| M02 Regional policies | World physics panel scopes and regions; `actors policy` |
| M03 Actors and world | Prop pushes, crowd contacts and dash in every area; creature circles turn on ambient bodies |
| M04 Saves and co-op | Save trail and Load trail in Agent lab, or the `save` and `restore` commands; "Invite a friend" and "Join an expedition" for up to eight travelers |
| M05 Materials and destruction | Breakable scenery everywhere; showcase beat 1 (the pen fence) |
| M06 Combat forces and loot | V to grab and throw; showcase beat 2 (a thrown-crate kill); bouncing loot |
| M07 Jointed mechanisms | Gates, chains, vines, launchers, vanes and causeways; showcase beat 4 (the launcher) |
| M08 Reactions and fields | Fire, water, oil, shock, blasts and wind; showcase beat 5 (oil jar in the coals) |
| M09 Physical rigs | Leaning, stagger, knockdown and ragdoll deaths; showcase beat 3 (Whorl flings the remains) |
| M10 Towns and authored areas | The Sanctuary market and each area's extension; showcase beat 6 (the calm ring switched and reset) |
| M11 Generated encounters | Areas 9 and beyond; `encounters catalog/preview/validate/export` |
| M12 Controls and release | O, the HUD button, the game-mode menu or the pause menu; `npm run showcase` |

### Captures

- [Panel](evidence/physics-m12-panel.png): loose props and destruction off for area 1; the inspector on the crate shows it frozen, with both sources.
- [Touch](evidence/physics-m12-touch.png): the wild ring selected on a phone-sized screen, with its bounds and region tools.
- [Guest](evidence/physics-m12-guest.png): "The host's settings", every control disabled.
- [Showcase sheet](evidence/physics-m12-showcase.png) and [video](evidence/physics-m12-showcase.webm): the six beats in the browser.

### Observations, not gates

- In normal play the controls stay responsive. The browser showcase with video capture in game mode ran at about 29 FPS on this container, so the recorded run uses the default view at 960×600. Per D53 this is reported as information, not as a release gate.
- Production cannot be loaded from the implementing container (its network policy denies `*.vercel.app`; the Vercel connector's protected fetch returns 403). The release is verified as the READY production deployment for the merge commit. The live browser scenarios (`BASE_URL=… npm run test:e2e`) were not run against production.
