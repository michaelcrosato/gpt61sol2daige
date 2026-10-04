# Regional physics policies

The user must be able to choose what reacts, where it reacts and how strongly it reacts. Feature policies affect authoritative behavior. Rendering overlays are separate local preferences.

## M02 delivered contract

The solo lab now implements **world reactions, dynamic props, prop blocking and impulse strength**. The feature table below retains the later implementation targets; those controls are not registered or exposed as working switches yet. Authored lab defaults are land `lab-land` (reactions on), area `playground` (dynamic props/blocking on), and rectangle `quiet-garden` at top-left (-260,-120), 90×100, priority 10 (reactions off). Bodies default to `playground`; an explicit `areaId` binds a recipe to another validated area. Adventure actors and land travel are not migrated in M02.

`PolicyState` version 1 owns `revision`, `masterWorldReactions`, `boundaryMargin`, immutable `authored` layout, editable `profiles` layout and scoped `overrides`. Each land has `{id,values}`, area adds `landId`, region adds `areaId,priority,shape`. IDs use 1–80 letters, digits, underscores or hyphens. References and duplicates are validated across the final transaction. Each scope supports up to 256 profiles and the document up to 768 overrides; the queue and each transaction support up to 256 entries. These are explicit development input bounds, not performance cutbacks.

`values` accepts only three booleans (`worldReactions`, `dynamicProps`, `propBlocking`) and `impulseStrength` (finite 0–10). Omitted fields inherit. Zero strength suppresses commanded prop impulses without freezing dynamics; it does not weaken authored contacts or the fixed-speed CCD launcher. Unknown future capability names are rejected. Default role is `prop` for dynamic bodies and essential `terrain` for fixed bodies; an explicit fixed `prop` can be nonblocking. The `actor` role is a dynamic lab contact traveler, with a recorded ±600 units/s velocity intent. Required terrain contacts remain solid under every optional policy.

Resolve per field: engine defaults → land profile → area profile → containing region profiles → land live override → area live override → containing region live overrides. Higher region priority wins; smaller ID wins ties. Missing fields on the winning region still inherit values from other applicable regions. A broader live override supersedes an authored region value; a more-specific live override supersedes the broader live override. `masterWorldReactions=false` always wins. Inspection returns requested `values`, gated `effective` values and the exact source for each value. World reactions gates dynamic props and prop blocking; their requested values remain inspectable even when gated off.

Regions use the center sampled before each physics step. Circles use center/radius; rectangles use top-left/width/height; polygons are simple, possibly concave, with 3–64 ordered points. Coordinates are finite within ±10,000, circle radii 0.01–10,000, rectangle dimensions 0.01–20,000 and priority an integer -1,000–1,000. Reject degenerate, duplicate-edge or self-intersecting polygons. A signed distance gives inclusive boundaries at margin zero. Default margin 1 (configurable 0–16): enter one unit inside, remain until one unit outside. Membership and the sampled position survive save/restore, even if a moving body has crossed between that sample and the end of the last tick. `policy` point inspection has no previous membership and shows the entry rule.

`configure` contains `expectedRevision` and ordered `edits`. The expected revision is `inspect().policies.nextRevision`, including accepted pending transactions. Validate the whole projected document and every live body's area binding before enqueue. Invalid/stale edits leave applied state, pending queue, bodies and replay unchanged. The next physics tick commits all accepted edits before resolving bodies. Explicit `apply` requires the final queued revision, commits without stepping, and is available in the browser only while paused. Headless callers explicitly control ticks and can use the same operation between steps. Inspection distinguishes applied state/revision from pending transactions and projected `preview`.

Edits upsert land/area/region profiles, merge live `override` values, replace an override with a named `preset`, set master/margin, remove a profile, or reset a scope. `reset` to `inherited` removes only that scope's live override. `reset` to `authored` also restores its original profile, including authored region geometry/priority. Custom profiles have no authored baseline; their values clear while their identity/geometry remains. Master and broader scopes are independent and remain effective after a local reset. The UI queues reset plus override atomically when individual selectors choose inherited fields.

Quiet disables all optional reactions; Reactive restores the implemented defaults; Wild uses the same features with 2.5× commanded prop impulses; Sanctuary keeps movable props with 0.35× impulses and disables optional actor blocking. These names currently describe the M02 capability set only. Individual fields form a custom override; the UI shows each preset's exact values before applying.

Disabling dynamics or world reactions switches affected dynamic props to fixed bodies at their **current** solved pose. Clear linear/angular velocity, forces and torques. Disabled impulses are discarded. Optional prop-blocking changes real Rapier interaction groups: props still contact terrain and other props, while actor contacts require both the prop's and actor's resolved effective permission. Actor/core terrain behavior continues. Re-enable performs pairwise overlap correction in stable ID order before switching back to dynamic, then starts with zero motion. Correction uses up to 32 passes for a valid placement; if unresolved, retain the original frozen pose and expose `reactivationBlocked` with deliberate placement guidance. Correction into another quiet region keeps that body frozen.

`place` explicitly relocates the existing lab body, keeps its angle and consequence fields, clears motion and resolves policies; it lets a frozen prop return from a quiet region without recreating it. Policy edits never respawn the recipe or rebuild the world. `{destroyed,claimed,durability?}` consequence fields are validated and preserved, but M02 does not implement destruction, rewards or material evolution. Their existence is a persistence contract, not a working destruction control.

Playground checkpoint version 2 stores the complete policy document/queue, applied policy samples and provenance, frozen state, motor intent and consequence fields alongside Rapier bytes. Restore validates all of them against the binary registry and keeps the old scene on failure. M01 playground snapshots migrate to version 2; the outer save remains version 1 and network wire remains 3. Collider/region overlays persist separately under device key `fern:physics-overlays:v1` and never enter replay hashes. Host and guest shared lab controls remain unavailable online or while connecting until M04.

Reproduce with `node tools/physics.ts examples/physics-regions.jsonl`. [Scene evidence](../evidence/physics-m02.json), [region canvas](../evidence/physics-m02.png) and the headless/browser scenarios cover crossings, specificity, master-off, invalid/stale edits, paused bounds changes, zero-motion wake, real blocking, presets/resets and persistence. Actual eight-player WebRTC coverage verifies that the solo boundary remains enforced; it does not claim replicated policy behavior before M04.

## Scope and precedence

Resolve values in this order: engine defaults, land profile, area profile, containing named region, then applicable live debug overrides. A more specific live override wins over a broader live override; the session-wide master `worldReactions = false` is an absolute off switch. Within one specificity, use declared priority and stable region ID to break ties. Show the effective value and the source that supplied it.

Support circle, rectangle and authored polygon regions. Membership normally uses the body's center at the start of a tick, with a small configurable boundary margin to avoid rapid toggling on an edge. Large articulated assemblies use their declared root/anchor; one region policy controls the assembly's optional simulation. This avoids leaving half a joint chain frozen across a boundary.

Live edits are queued and applied atomically at the next tick boundary. A command includes scope, ID and expected policy revision. Reject stale or invalid edits without partially changing a scene. During pause, allow a deliberate apply transaction so the user can configure and inspect before resuming. Do not require a restart.

New features register their controls as they become available. M02 establishes the policy system; subsequent milestones add working capabilities. Do not ship switches that claim a reaction is enabled when its implementation does not yet exist.

## Feature controls

| Feature | On behavior | Off behavior | First delivery |
| --- | --- | --- | --- |
| World reactions | Enables optional physical/reactive capabilities according to resolved settings | Suppresses all optional reactions; core movement, essential collision and base combat continue | M02 |
| Dynamic props | Loose objects translate/rotate and respond to contact | Freeze existing props at their current pose as static obstacles where appropriate; discard stored motion | M02 |
| Prop blocking | Optional scenery generates physical actor contacts | Optional scenery does not block actors; weapon queries and material state remain available, and required terrain boundaries remain solid | M02 |
| Crowd contacts | Players and monsters physically separate and push according to their roles | Actors may pass through one another while attacks, targeting and core world collision remain active | M03 |
| Destruction | Material durability can progress to break stages | Preserve current damage/broken state; prevent further environmental destruction | M05 |
| Impact damage | Fast physical impacts can damage permitted targets | Contacts still move objects when enabled, but add no physical collision damage | M06 |
| Projectile world collision | Eligible projectiles strike/ricochet/pierce scenery according to their definition | Projectiles retain base combat target behavior and ignore optional scenery contacts | M06 |
| Environmental forces | Wind, suction, vortex and radial pressure affect permitted bodies | Stop adding field forces; retain existing momentum unless dynamic simulation is also off | M06 and M08 |
| Jointed mechanisms | Hinges, tethers, springs and motors can move | Freeze the assembly in its current valid configuration; retain broken-joint state | M07 |
| Joint breakage | Joint stress or authored damage can break a connection | Preserve existing breaks; prevent new automatic stress breaks | M07 |
| Material reactions | Fire, wetness, oil and electricity evolve and interact | Stop optional material evolution and new material damage; preserve inspectable status and pause its remaining timers | M08 |
| Chain reactions | A material or mechanism event may trigger further eligible events | Allow the initial direct effect, suppress secondary propagation; mark queued propagation ineligible while off | M08 |
| Physical ragdolls | Death transitions to articulated bodies responding to the scene | Use the ordinary authored death pose; an existing ragdoll settles into a non-reactive corpse without resurrecting its actor | M09 |
| Physical loot | Loot has bounce/slide response before collection | Settle loot at a reachable nearby position; keep magnet/pickup and ownership functional | M06 |
| Foliage response | Grass, cloth and flexible plants bend/react to nearby forces | Return toward an authored resting pose; collider state follows the object's actual role | M05 and M09 |
| Ambient creature physics | Eligible ambient creatures participate as physical actors, with optional steering/contact response | Hand each creature back to its ambient behavior at its current position; remove its old physical contacts | M03 |
| Swept collision checks | Apply appropriate CCD/shape-sweep handling to configured objects | Use discrete overlap handling for those optional checks, while retaining essential character obstacle handling | M03 and M06 |

M01 includes a minimal pushable prop to exercise the backend. M02's initial demonstration uses world reactions and dynamic props. The remaining controls become active with their listed systems.

## Transition rules

- Disabling a feature is not a reset. Never repair a tree, refund an attack, recreate loot, restore a broken joint or respawn a dead actor as a side effect.
- Re-enabling starts from the current scene. Frozen dynamic props restart with zero velocity. Revalidate overlaps before waking a body or assembly; use a small separation correction or a visible reset option if placement is invalid.
- Switching off an optional feature cancels or suspends its future work according to the table. Turning it back on must not unleash a backlog of impacts or ignitions from time spent disabled.
- Base combat statuses remain separate from optional environmental material state. For example, the existing Cinderwake ability benefit must still function when environmental fire propagation is off.
- Material breakage checks the target's resolved policy; a projectile crossing a region boundary keeps its identity and authored attack damage. Regional toggles never erase the player's base hit simply because environmental impact damage is off.
- An optional reaction must be permitted at its source and accepted at its target. A burning prop entering a quiet region cannot spread fire into protected town objects. Essential service roles retain their protection regardless of nearby debris.
- Assemblies transfer as a unit where possible. An anchored chain cannot enter a portal until its anchor is released; an unanchored assembly can be translated together with its joints and motion. Portal cooldown prevents immediate re-entry loops.
- On/off state, overrides, remaining suspended timers and policy revision survive save/load and late join. A guest cannot diverge shared physics through a local quality setting.

## Presets

| Preset | Purpose | Behavior |
| --- | --- | --- |
| Quiet | Compare against a restrained world | Optional reactions off; movement, combat and interaction remain usable |
| Reactive | Default authored adventure | Physical props, material reactions, destruction and other implemented systems enabled; protected roles remain protected |
| Wild | Exaggerated interaction playground | Same feature set with stronger impulses, easier breakage and longer-lived debris; no automatic FPS-based downgrades |
| Sanctuary | Town service area | Harmless movable props, cloth/foliage and gentle reactions; no environmental damage to essential NPCs or service access |
| Custom | User-authored behavior | Independent feature values and numeric controls at the selected scope |

These are behavior presets, not graphics quality settings. A land may contain Reactive combat areas, a Sanctuary town and a Quiet test region simultaneously.

## Numeric controls

Expose impact strength, knockback recovery, material durability, joint break threshold, field strength, prop friction/bounce, debris persistence and ragdoll response. Advanced debug controls may expose solver iterations and CCD options once their actual API is verified. Values must be finite and valid for their physical meaning; give zero and off explicit meanings. Defaults should show the feature clearly, with no adaptive performance manager.

Show scope selection, named region bounds, inherited versus overridden values, reset-this-scope, reset-to-authored, preset preview and a short explanation of what freezing changes. The inspector can select a body and display its effective policy, material, last reaction cause and assembly. Wire the same operations into the agent API. Regions are authored with recipes or direct lab commands; a new full scene editor is not required.

## Required switch demonstrations

For every implemented feature: observe its real effect, disable it, repeat the cause and verify suppression, enable it again and verify recovery. Also cross a region boundary in both directions, apply a broader override, save/restore the off state, and observe it from an actual guest. Test the dependency combinations that change meaning, especially master-off with feature-on, joints-off with breakage-on, destruction-off with impact damage on, and reactions-off with base combat still active. Exhaustively testing every possible boolean combination is unnecessary.
