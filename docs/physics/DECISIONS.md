# Reactive physics decisions

These decisions express the user's requested priorities and the implementation plan. Change one when concrete integration evidence warrants it; include the date, reason, affected contracts and migration consequence. Do not present planned behavior as implemented.

| ID | Decision | Reason |
| --- | --- | --- |
| D01 | Physical interaction breadth and visible results take priority; performance measurements are informational | User explicitly owns performance tradeoffs |
| D02 | Official Rapier2D JavaScript/WASM package behind a local adapter; no initial fork | Delivers collision/joint capabilities while keeping Fern's gameplay inspectable |
| D03 | One authoritative physical owner per body; host simulates shared worlds | Avoids competing integrators and divergent guest worlds |
| D04 | One fixed tick pipeline; zero global gravity; explicit unit conversion | Fits the current top-down game and existing stepping tools |
| D05 | Optional features resolve by land, area and region; runtime overrides have explicit precedence | User requires controllable physics in selected parts of the world |
| D06 | Off preserves current consequences; re-enable never resurrects objects or rewards | Switches must work in a live run |
| D07 | Physics snapshots plus semantic state and stable game IDs | Saves, inspection, migrations and co-op need more than raw engine handles |
| D08 | Same-build reproducibility is useful; cross-device bit identity and scientific precision are not gates | User favors reactions and does not require hardware parity |
| D09 | Existing combat/progression stays gameplay-owned; reactions add physical consequences | Maintains fast attacks, optional mechanics and correct rewards |
| D10 | Cosmetic-only particles do not satisfy destruction, ragdoll or interactive-object milestones | Acceptance must demonstrate actual world state changes |
| D11 | Each milestone is a complete verified slice, pushed and merged before a fresh session | User explicitly requests milestone resets and commit discipline |
| D12 | No claim of self-switching models, self-clearing context or reserving 828K tokens | Those are controlled by the active client; repository handoffs provide continuity |
| D13 | Scenery and creature interaction remains an explicit authored/user choice, without hidden FPS-driven caps | Honors broad physics options without making population benchmarks dictate scope |
| D14 | Functional route protection and essential town services remain reliable | Optional physical mechanics cannot deadlock the run |
| D15 | M01 pins `@dimforge/rapier2d-compat` 0.21.0; async import + `init()` is awaited once, then constructors/steps/commands stay synchronous | Verified installed declarations and browser/Node execution on 2026-10-04; the compatibility package embeds WASM and needs no network at initialization after the bundled module is loaded |
| D16 | M01 saves optional `playground` version-1 state with backend version, units, stable-ID/handle registry, raw snapshot bytes/checksum and contact history; wire protocol stays 3 | Keeps legacy saves readable, verifies same-build continuation, and deliberately rejects physical online scenes until M04; future state formats must migrate this member explicitly |
| D17 | Playground sweep uses pairwise collider shape casts, then a real CCD body; ordinary motion remains Rapier-owned | On 2026-10-04 a world broad-phase query before the first step missed newly created colliders. Pairwise queries correctly predict the wall without advancing a paused scene; trajectory and contact tests verify the actual body separately |

M01 confirms `RigidBodyDesc`, `ColliderDesc`, `applyImpulseAtPoint`, `EventQueue.drainCollisionEvents`, `Collider.castShape`, body CCD, `debugRender`, `takeSnapshot`, `restoreSnapshot` and explicit `free()` lifecycle. M03 must record the final character motor choice. M04 must record actual save/protocol versions and late-join framing. M12 must record what was delivered and every remaining limitation.
