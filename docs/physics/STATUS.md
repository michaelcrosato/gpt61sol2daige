# Reactive physics milestone status

Planning baseline: `c47cb119d6f57c70ddf79a4a72db59376d68f1e5` on `main`, Fern 2.0. Planning PR [#2](https://github.com/michaelcrosato/gpt61sol2daige/pull/2) is merged at `00ab840c1f1757d554610570145820269be6b2e8`, verified with Git/GitHub on 2026-10-04.

**M01–M12 are verified and merged: the reactive physics plan is complete. M12 merged in PR [#25](https://github.com/michaelcrosato/gpt61sol2daige/pull/25) at `804d788`. Main CI run [37543845815](https://github.com/michaelcrosato/gpt61sol2daige/actions/runs/37543845815) is green on it (190 headless tests, 48 browser scenarios), and Vercel's GitHub deployment record 6897247581 reports its production deployment complete (verified with Git/GitHub on 2026-10-06). See the final verification below. M11 merged in PR [#21](https://github.com/michaelcrosato/gpt61sol2daige/pull/21) at `fa1baac`, with main-CI follow-ups PR [#22](https://github.com/michaelcrosato/gpt61sol2daige/pull/22) at `4317547`, PR [#23](https://github.com/michaelcrosato/gpt61sol2daige/pull/23) at `b0ea666` and PR [#24](https://github.com/michaelcrosato/gpt61sol2daige/pull/24) at `5a73ad4`. Main CI run [37530019535](https://github.com/michaelcrosato/gpt61sol2daige/actions/runs/37530019535) is green on `5a73ad4`, and Vercel's GitHub deployment record for it reports production complete (verified with Git/GitHub on 2026-10-06). M10 merged in PR [#19](https://github.com/michaelcrosato/gpt61sol2daige/pull/19) at `b96bae6` and its main-CI follow-up PR [#20](https://github.com/michaelcrosato/gpt61sol2daige/pull/20) at `03154c8`; main CI run [37439407985](https://github.com/michaelcrosato/gpt61sol2daige/actions/runs/37439407985) is green on `03154c8`, and production deployment `dpl_FMxdAJmLD3T4ugib3xhnPp6mHG8S` is READY for it (verified with Git/GitHub and the Vercel connector on 2026-10-06)..** M01 PR [#3](https://github.com/michaelcrosato/gpt61sol2daige/pull/3) merged at `59c0c2eab2790769210abc76f5e65cdece094523`; M02 PR [#4](https://github.com/michaelcrosato/gpt61sol2daige/pull/4) at `c2ef7e299575e8716a83f616db613d668f0b74b8`; M03 PR [#5](https://github.com/michaelcrosato/gpt61sol2daige/pull/5) at `c3ae7201aafaf5719bcf0a235dcd5fcd1255b75a` (production `dpl_4aFrt4LdJQvo9GUPstUpiDyzZEyX` READY). M04's release completed through PR [#8](https://github.com/michaelcrosato/gpt61sol2daige/pull/8) (carrying PR #7), merged at `3710313cc7cfe63ec8b800e927fcea8a1c896f01`; main CI [37272297248](https://github.com/michaelcrosato/gpt61sol2daige/actions/runs/37272297248) is green on that merge. PR [#9](https://github.com/michaelcrosato/gpt61sol2daige/pull/9) (ambient ownership cost, D31) merged at `9bd16f0631e2f4e30f04f67ad0d6f5e10dcf3e34`; main CI [37283639850](https://github.com/michaelcrosato/gpt61sol2daige/actions/runs/37283639850) is green, and its PR head reports a completed Vercel deployment. Both were verified with GitHub on 2026-10-05. M05 PR [#10](https://github.com/michaelcrosato/gpt61sol2daige/pull/10) merged at `26a9d48de2343ec5205eb2f298b9d92546a6411e`; main CI [37296310916](https://github.com/michaelcrosato/gpt61sol2daige/actions/runs/37296310916) is green on that merge (verified with GitHub on 2026-10-05). M06 PR [#11](https://github.com/michaelcrosato/gpt61sol2daige/pull/11) merged at `dcff3f94e8bbf5dd3cc342bc73892434c232e462`; main CI [37307530480](https://github.com/michaelcrosato/gpt61sol2daige/actions/runs/37307530480) is green on that merge, and its PR head reported a ready Vercel preview (verified with GitHub on 2026-10-05). M07 PR [#12](https://github.com/michaelcrosato/gpt61sol2daige/pull/12) merged at `275da484c006a20502decc695e40cd6b1ee3fcfe`; main CI [37342707382](https://github.com/michaelcrosato/gpt61sol2daige/actions/runs/37342707382) is green on that merge. The D53 direction PR [#13](https://github.com/michaelcrosato/gpt61sol2daige/pull/13) merged at `fcba70a98f7a484aab7d18170dc18b2c423b39f7`; main CI [37354838049](https://github.com/michaelcrosato/gpt61sol2daige/actions/runs/37354838049) is green on that merge. Both were verified with GitHub on 2026-10-05. M08 PR [#14](https://github.com/michaelcrosato/gpt61sol2daige/pull/14) merged at `a53af8d5bfff83e9602b6ebee2913603c1dcba42`. Main CI run [37371489713](https://github.com/michaelcrosato/gpt61sol2daige/actions/runs/37371489713) is green on that merge: the first attempt was cancelled after 15 minutes and the second passed in 13. PR #14's head reported a completed Vercel deployment. All of this was verified with GitHub on 2026-10-05.

Production: on 2026-10-06 the Vercel connector reported production deployments READY for `03154c8` (`dpl_FMxdAJmLD3T4ugib3xhnPp6mHG8S`, M04–M10) and `fa1baac` (`dpl_AHYJaSRkBdxD2rRhbsPnn2GcomEz`, M11). Later the same day the connector refused deployment reads (403 when listing, 404 by URL). `4317547`, `b0ea666`, `5a73ad4` and `804d788` are therefore verified by the Production deployment records that Vercel posts to GitHub when a deployment completes: `5a73ad4` has GitHub deployment 6895069624 and `804d788` (M12) has 6897247581, both with status success. Those records matched the connector's READY deployments for `03154c8` and `fa1baac`. The live page itself still cannot be loaded from the implementing container: egress to `*.vercel.app` is denied (the proxy returns no response), and the connector's protected fetch returns 403.

**Direction from 2026-10-05 ([D53](DECISIONS.md)):** feature-first development. Get each milestone's features in and working even if performance is low; a later stress-test pass decides what to scale back, tune or adjust for multiplayer. Single player comes first. Co-op is planned but experimental and follows single-player needs; multiplayer performance is not benchmarked, tuned or gated, and M08–M12 co-op acceptance is a headless replication/late-join check plus the existing WebRTC smoke scenarios.

M11's and M12's releases are verified (see the M11 release resolution and the final verification below). The user's goal for this session explicitly asked for M11 and the remaining milestones in one run, so M12 follows after M11 is merged and verified rather than in a fresh chat. No client model/context change is claimed here.

| Milestone | State | Handoff and evidence |
| --- | --- | --- |
| Planning | Verified and merged | [Planning handoff](handoffs/M00.md), PR #2 |
| M01 | Verified and merged | [Foundation handoff](handoffs/M01.md), PR #3, [scene evidence](../evidence/physics-m01.json) |
| M02 | Verified and merged | [Regional handoff](handoffs/M02.md), [scene evidence](../evidence/physics-m02.json), [region canvas](../evidence/physics-m02.png) |
| M03 | Verified and merged | [Actors and world](milestones/M03.md), [current handoff](handoffs/M03.md) |
| M04 | Verified and merged (in production since `03154c8`, READY on the Vercel connector) | [Saves and co-op](milestones/M04.md), [handoff](handoffs/M04.md), PR #8 |
| M05 | Verified and merged (in production since `03154c8`, READY on the Vercel connector) | [Materials and destruction](milestones/M05.md), [handoff](handoffs/M05.md), [evidence](../evidence/physics-m05.json), PR #10 |
| M06 | Verified and merged (in production since `03154c8`, READY on the Vercel connector) | [Combat and loot](milestones/M06.md), [handoff](handoffs/M06.md), [evidence](../evidence/physics-m06.json), PR #11 |
| M07 | Verified and merged (in production since `03154c8`, READY on the Vercel connector) | [Jointed mechanisms](milestones/M07.md), [handoff](handoffs/M07.md), [evidence](../evidence/physics-m07.json), PR #12 |
| M08 | Verified and merged (in production since `03154c8`, READY on the Vercel connector) | [Material reactions and fields](milestones/M08.md), [handoff](handoffs/M08.md), [evidence](../evidence/physics-m08.json), PR #14 |
| M09 | Verified and merged (production deployment READY; live page not loadable from the container) | [Physical rigs](milestones/M09.md), [handoff](handoffs/M09.md), [evidence](../evidence/physics-m09.json) |
| M10 | Verified and merged (production deployment READY; live page not loadable from the container) | [Authored world](milestones/M10.md), [handoff](handoffs/M10.md), [evidence](../evidence/physics-m10.json), PRs #19–#20 |
| M11 | Verified and merged (production deployment complete; live page not loadable from the container) | [Procedural world](milestones/M11.md), [handoff](handoffs/M11.md), [evidence](../evidence/physics-m11.json), PRs #21–#24 |
| M12 | Verified and merged (production deployment complete; live page not loadable from the container) | [Release](milestones/M12.md), [handoff](handoffs/M12.md), [showcase](../evidence/physics-m12-showcase.json), [matrix](../evidence/physics-m12-matrix.json), PR #25 |

## State conventions

Use `not started`, `in progress`, `implemented; merge verification required`, or `verified and merged`. Never advance a milestone solely because its code exists or a UI switch is present. Record remaining acceptance gaps when incomplete. A fresh session upgrades the previous row to `verified and merged` only after checking actual ancestry, PR state and required evidence; that status update can ride with its own milestone change.

The pre-physics baseline was 41 headless and 14 browser scenarios. M01 expanded that to 48 and 17; M02 adds eight headless policy scenarios and two browser policy/control scenarios. M03 passes 67 headless and 21 browser scenarios, including its integrated encounter and actual eight-client WebRTC. The existing eight-client WebRTC coverage remains a functional smoke check, not a performance gate ([D53](DECISIONS.md)). FPS remains informational, with no hidden adaptive cutbacks.

Initial M04 local gates passed: 74 headless scenarios, 23 browser scenarios, build and all nine route areas. Its final guest policy inspection also passes targeted actual WebRTC coverage. [Handoff](handoffs/M04.md) records versions, framing, rebuild/recovery and QA tuning. Verify its PR release receipt/main ancestry/production before starting M05; this row is deliberately written before commit/merge.

Release audit: initial M04 PR #6 merged at `ef861e9094202f00ff987642cbc1b244b8ac3e5b`. PR CI passed, but main CI and production eight-player verification exposed high-population transfer/admission failures. M04 remains active until its repair PR and production verification pass. The repair uses lossless gzip, paced chunks, immutable retries and progress-based liveness (room 5 / physical wire 2), plus old co-op solver-flag migration and solved-pose distant teleport saves.

PR #7's CI then failed on both commits ([37250067641](https://github.com/michaelcrosato/gpt61sol2daige/actions/runs/37250067641), [37251631581](https://github.com/michaelcrosato/gpt61sol2daige/actions/runs/37251631581)): at 32,768 creatures a loaded host processed guest acknowledgements seconds late, so six stop-and-wait guests continued solo. The release-completion PR from branch `claude/funny-planck-lkv50c` carries PR #7's commits and supersedes it. It adds a 1 Hz host heartbeat, shared cost-spaced frame builds with admission floors, staged receipts and one-time admission binding ([evidence](../evidence/physics-m04-release.json)). Its local gates pass: 77 headless scenarios, 24 browser scenarios on two consecutive full runs, build and nine route areas. M04 stays `implemented; merge verification required` until that PR's CI, merge, main CI and production receipt are verified.

M04 release resolution: the completion PR #8 passed CI, merged at `3710313`, and main CI passed on the merge. PR #9 then cut per-creature ambient ownership cost 2.4× with identical state hashes ([evidence](../evidence/physics-ambient-tick.json)).

M05 local gates: `npm run check` (**86 headless** scenarios), `npm run build`, `npm run test:e2e` (**26 browser** scenarios, including two new M05 scenarios with real mouse input and actual WebRTC guest/late join) and `npm run verify:run` (nine areas). [Handoff](handoffs/M05.md) records schemas, mutation keys, fracture ownership and reward rules. This row is written before commit/merge; the next session reconciles it from Git/GitHub evidence.

M05 release resolution: PR #10 passed CI, merged at `26a9d48`, and main CI passed on the merge.

M06 local gates: `npm run check` (**98 headless** scenarios), `npm run build`, `npm run test:e2e` (**29 browser** scenarios, including three new M06 scenarios: real V/mouse grab and throw with held mouse and keyboard slash immediacy and loot saves, touch Grab/attack buttons, and an actual WebRTC guest grab/throw through host-validated actions) and `npm run verify:run` (nine areas). [Handoff](handoffs/M06.md) records the interaction schema, attribution, input changes, physical affixes and off-state cases. This row is written before commit/merge; the next session reconciles it from Git/GitHub evidence.

M06 release resolution: PR #11 passed CI, merged at `dcff3f9`, and main CI passed on the merge.

M07 local gates: `npm run check` (**111 headless** scenarios), `npm run build`, `npm run test:e2e` (**32 browser** scenarios, including three new M07 scenarios: real keys pulling the gate, Whorl swinging the chained ball and a slash cutting the vine with a page save/restore; touch Grab cocking and firing the launcher; an actual WebRTC guest throwing a vine pod free and a late joiner seeing every broken link, latch and motor) and `npm run verify:run` (nine areas). [Handoff](handoffs/M07.md) records supported joint types, the stress approximation, assembly recipes and off/portal behavior. This row is written before commit/merge; the next session reconciles it from Git/GitHub evidence.

M07 release resolution: PR #12 passed CI, merged at `275da48`, and main CI passed on the merge.

M08 local gates: `npm run check` (**121 headless** scenarios), `npm run build`, `npm run test:e2e` (**34 browser** scenarios, including two new M08 scenarios: real V/WASD/mouse carrying an oil jar onto a brazier until it bursts into a burning slick that survives a page save/restore, then a real mouse slash on a storm coil whose discharge sets off the powder keg; and a touch Slash on the fan whose gust drives the casks downwind) and `npm run verify:run` (nine areas). [Handoff](handoffs/M08.md) records the rule registry, causal model, paused-timer behavior, field recipes and demonstrated chains. This row is written before commit/merge; the next session reconciles it from Git/GitHub evidence.

M08 release resolution: PR #14 passed CI, merged at `a53af8d`, and main CI passed on the merge (second attempt).

M09 local gates:
- `npm run check`: **134 headless** scenarios.
- `npm run build`.
- `npm run test:e2e`: **38 browser** scenarios, including four new M09 scenarios:
  - real held-mouse and WASD slashes felling all six rigs into ragdolls, Whorl (Q) throwing one, ragdolls switched off through the Agent lab panel so the body settles, and a page save/restore keeping kills single (recorded video);
  - touch: shoving a townsperson who walks back, a touch Slash felling a stalker the same way, and local shake and flash preferences;
  - a frame-by-frame capture of every rig's hit, knockdown, death and rest.
  - a key tap shorter than one frame still casts once (CI exposed lost taps on slow frames; taps are now latched until a tick consumes them).
- `npm run verify:run`: nine areas.

[Handoff](handoffs/M09.md) records the rig contracts, death transfer, recovery rules, controls and animation evidence. CI's job limit rose from 20 to 30 minutes (D53: duration is not a gate). This row is written before commit/merge; the next session reconciles it from Git/GitHub evidence.

M09 release so far: PR #15 passed CI on `369e634` and merged at `d6dc35a`. Main CI on the merge (run 37398675225) then failed one M06 browser check: `physics-combat.spec.ts` gave a held attack 2 s of wall-clock time to slash. In area 1 the browser runs about 80 ticks per 2 s on the local container, equal on M08 and M09, but only 24–31 under 3× CPU throttling. That is close to one slash cooldown (up to 22 ticks) plus input latency, and each poll's full save blocks frames. PR #16 measures the check in simulation time: a new slash (by event id) within 36 ticks of the press, with 15 s of wall-clock allowance. It merged at `9811476`.

Main CI on `9811476` (run 37402810032) then failed the M01 browser-to-Node replay check in `game.spec.ts`, intermittently: about 1 in 8 locally. The only differing value was the lantern's `swingRate` in its last digits. Chromium 141 and Node's V8 12.4 disagree on `Math.sin` for about 3.7% of inputs, and M09's hero recoil was hashed. PR #17 keeps hero recoil and foliage bend (presentation-only, still saved and replicated) out of `stateHash` ([D69](DECISIONS.md)); 42 local attempts then all matched.

M09 release resolution: PR #17 passed CI on `a069ce0` and merged at `cc8a31ee6e18e88c2934d95f0ee7c37cec93e920`; main CI run 37409255181 passed on that commit (check, build and all 38 browser scenarios). A docs-only PR then recorded this resolution; the M10 session should confirm that it merged and that main CI passed on it.

M09 release record: PR #18 merged at `7d1b73c`; main CI run 37412127500 passed on it.

M10 local gates:
- `npm run check`: **149 headless** scenarios. The 15 new ones are in `tests/physics-world.test.ts`.
- `npm run build`.
- `npm run test:e2e`: **41 browser** scenarios, with the existing WebRTC smoke scenarios passing. The three new M10 scenarios in `e2e/physics-world.spec.ts`:
  - the town by real input: lamp swing and settle, bunting, nothing broken, then rest, Rowan's shop and the outward gate;
  - all eight areas' extensions triggered by real slashes, walking, E and Q, each captured;
  - the Bloom Tyrant's locked lash telegraph, a real dash tearing free, and its exposure.
- `npm run verify:run` (reactions on) and `node tools/adventure.ts playthrough 9 --reactions off` both clear nine areas and visit both towns (rest, sell, buy).

[Handoff](handoffs/M10.md) records recipes, warden interactions, route fallback and the on/off runs. This row is written before commit and merge; the next session reconciles it from Git/GitHub evidence.

M10 release so far: PR #19 passed CI on `65d5d62` and merged at `b96bae6`. Production deployment `dpl_AbAR8TVmGaR8Rks36NCJNejF6ZD6` is READY for that commit (Vercel connector); the live page still cannot be loaded from the container. Main CI on the merge (run 37432079490) failed one M09 browser check, intermittently: in `physics-rigs.spec.ts`, Whorl moved the felled warden's ragdoll 0 units, failing 2 of 6 local repeats. The fight sometimes ends inside M10's `calm-1` region north-east of area 1's trailhead, where calm values freeze ragdolls by design. A follow-up PR runs that scenario's fights west of the trailhead, on open ground with no region (6/6 repeats pass). Check that it merged with green main CI before M11.

M10 release resolution: PR #20 passed CI and merged at `03154c8`; main CI run 37439407985 passed on it (check, build and all 41 browser scenarios), and production deployment `dpl_FMxdAJmLD3T4ugib3xhnPp6mHG8S` is READY for that commit.

M11 release so far: PR [#21](https://github.com/michaelcrosato/gpt61sol2daige/pull/21) passed CI on `1af7f7c` and merged at `fa1baac`. Production deployment `dpl_AHYJaSRkBdxD2rRhbsPnn2GcomEz` is READY for that commit (Vercel connector). Main CI on the merge (run 37482376357) failed one M11 browser check, intermittently: the Burning palisade scenario. Repeats found a jar knocked loose and, more often, a jar bursting on the far side of the coals from the fuse, which also fails for a player. A follow-up PR moves the fuse closer (D93) and makes the scenario pick the jar up again and step around obstacles (20 of 20 local repeats). Check that it merged with green main CI before M12's release.

M11 second follow-up: PR [#22](https://github.com/michaelcrosato/gpt61sol2daige/pull/22) passed CI and merged at `4317547`. Main CI on it (run [37508713002](https://github.com/michaelcrosato/gpt61sol2daige/actions/runs/37508713002)) failed one M10 browser check, intermittently: the town scenario's walk to the market basket timed out because its straight-line steering got pinned on the way. Repeats then showed two more failures from the same steering, which only stops after the target and slides on at full speed. Once it slid out of the hearth's reach before E landed. Once it rammed Rowan, and the bump (an M09 shove) carried him out of service reach just as E was pressed. The game behaviour is correct in all three. The scenario's walk now steps around at 90° when it makes no progress for 0.6 s. At the hearth and at Rowan it waits for the traveler to come to rest within reach, stops short of Rowan and presses E when the prompt names him, and presses again if a bump moved him. 24 of 24 local repeats pass. Check that this merged with green main CI before M12's release.

M11 third follow-up: PR [#23](https://github.com/michaelcrosato/gpt61sol2daige/pull/23) passed CI and merged at `b0ea666`; the town scenario passed in main CI. Main CI on `b0ea666` (run [37521522891](https://github.com/michaelcrosato/gpt61sol2daige/actions/runs/37521522891)) then failed one M07 browser check, intermittently (1 of 10 local repeats): in `physics-mechanisms.spec.ts` the WebRTC guest's thrown vine pod did not snap its tether. Brambleburst's waves mobbed the guest at the vine. A monster in the throw's path absorbs the pod (one passing run logged the pod hitting a monster), or a blow knocks the hold loose, before the tether is yanked. The game behaviour is correct. The scenario now clears the waves with the documented QA isolation (`actors monster … clear`), as the M09–M11 scenarios do; 20 of 20 local repeats pass. Check that this merged with green main CI before M12's release.

M11 release resolution: PR [#24](https://github.com/michaelcrosato/gpt61sol2daige/pull/24) passed CI on `cc856ce` and merged at `5a73ad4`. Main CI run [37530019535](https://github.com/michaelcrosato/gpt61sol2daige/actions/runs/37530019535) passed on it: check, build and all 43 browser scenarios. Vercel's GitHub deployment record 6895069624 reports its production deployment complete.

M12 local gates:
- `npm run check`: **190 headless** tests. 30 are new: 4 panel tests and 26 matrix tests.
- `npm run build`.
- `npm run test:e2e`: **48 browser** scenarios. The five new ones:
  - keyboard and mouse: O inspects the hovered crate, and with loose props and destruction off it stays untouched by real slashes;
  - touch: a region takes a preset, moves, grows and resets to authored;
  - the pause menu and Pick on the map: master off, then Undo every live change;
  - real WebRTC: a guest's read-only view, a late joiner and a disconnect;
  - the six-beat showcase.
- Both 12-area routes, rerun on the M12 tree, are byte-identical to M11's.
- `npm run showcase` passes all six beats.

M12 PR [#25](https://github.com/michaelcrosato/gpt61sol2daige/pull/25): its first CI run ([37533302447](https://github.com/michaelcrosato/gpt61sol2daige/actions/runs/37533302447)) failed the M11 Burning palisade browser scenario, intermittently. The fuse burnt but stopped short of the stockade. Diagnostics found fuse brushes already destroyed by `impact` from the traveler before the jar burst. The scenario steered by holding keys between samples, and a page round trip can take 0.4 s while the page renders, so the traveler overshot at walking speed, circled the coals and swung the held jar through the fuse. The game behaviour is correct. The scenario now steps the jar toward the coals in short key pulses and stands still once it touches them, as a player would. The old loop failed 4 of 26 instrumented local repeats; the new one passes 20 of 20, and 10 of 10 under 3× CPU throttling. PR #25 carries the fix.

[Handoff](handoffs/M12.md) records the controls, showcase, matrix and remaining limitations.

M12 release resolution: PR #25 passed CI on `8ccfb9c` (run [37541094306](https://github.com/michaelcrosato/gpt61sol2daige/actions/runs/37541094306)) and merged at `804d788`. Main CI run [37543845815](https://github.com/michaelcrosato/gpt61sol2daige/actions/runs/37543845815) passed on it: check, build and all 48 browser scenarios in 15.1 minutes. Vercel's GitHub deployment record 6897247581 reports its production deployment complete.

## Final verification (2026-10-06)

The [release ledger](../evidence/physics-release-ledger.json) lists every merged PR from the Fern 2.0 baseline (#1) to M12 (#25), read from GitHub, with each merge commit's main CI run.

- **Pull requests:** all 25 are merged and none is open.
- **Main CI per milestone:** every chain ends on a green run:
  - M01–M03: #3–#5;
  - M04: #8, then #9;
  - M05–M08: #10, #11, #12, #14;
  - M09: #17 and #18;
  - M10: #20;
  - M11: #24;
  - M12: #25.
- **Red runs:** those on #6, #15, #16, #19, #21, #22 and #23 were each fixed by the next PR in the same chain, and #7 merged into #8's branch. No main CI failure is left unresolved.
- **Merged main rechecked locally:** at `804d788`, with the working tree equal to `origin/main`:
  - `npm run check` passes 190 of 190 headless tests;
  - `npm run showcase` passes all six beats;
  - both 12-area routes (`npm run verify:run` and `--reactions off`) are byte-identical to the committed route evidence.
- **Production:** the Vercel connector reported READY production deployments for `c3ae720` (M01–M03), `03154c8` (M04–M10) and `fa1baac` (M11). Vercel's GitHub deployment record reports `804d788` (M12) complete, and every milestone's code is an ancestor of it. The live page and the live browser scenarios (`BASE_URL=…`) could not be run from this container (network policy). Running them from a machine that can reach the site is the one check left open.
- **Next work:** the stress-test pass (D53) and anything new the user asks for. A fresh session starts from this file and the [M12 handoff](handoffs/M12.md). No client model or context change is claimed.
