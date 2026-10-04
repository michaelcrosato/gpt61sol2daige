# Reactive physics milestone status

Planning baseline: `c47cb119d6f57c70ddf79a4a72db59376d68f1e5` on `main`, Fern 2.0. Planning date: 2026-10-04. The current deliverable adds this plan and execution guidance only.

**Next eligible implementation milestone: M01. No physics implementation milestone has started.** Select the requested implementation model and use a fresh session with [START.md](START.md).

| Milestone | State | Handoff and evidence |
| --- | --- | --- |
| Planning | Prepared; verify containing PR merge through GitHub | [Planning handoff](handoffs/M00.md) |
| M01 | Not started | [Foundation](milestones/M01.md) |
| M02 | Not started | [Regional controls](milestones/M02.md) |
| M03 | Not started | [Actors and world](milestones/M03.md) |
| M04 | Not started | [Saves and co-op](milestones/M04.md) |
| M05 | Not started | [Materials and destruction](milestones/M05.md) |
| M06 | Not started | [Combat and loot](milestones/M06.md) |
| M07 | Not started | [Jointed mechanisms](milestones/M07.md) |
| M08 | Not started | [Material reactions and fields](milestones/M08.md) |
| M09 | Not started | [Physical rigs](milestones/M09.md) |
| M10 | Not started | [Authored world](milestones/M10.md) |
| M11 | Not started | [Procedural world](milestones/M11.md) |
| M12 | Not started | [Release](milestones/M12.md) |

## State conventions

Use `not started`, `in progress`, `implemented; merge verification required`, or `verified and merged`. Never advance a milestone solely because its code exists or a UI switch is present. Record remaining acceptance gaps when incomplete. A fresh session upgrades the previous row to `verified and merged` only after checking actual ancestry, PR state and required evidence; that status update can ride with its own milestone change.

The existing 41 headless and 14 browser scenarios are the known baseline from the preceding release. They are not evidence for planned Rapier features. Preserve their meaningful behavior checks while M01 removes performance as a release gate.
