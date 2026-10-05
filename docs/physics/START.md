# Start a Fern physics milestone

Use GPT-6.1 Sol (`gpt-6.1-sol`) at Extra high (`xhigh`) effort in a new chat. The client chooses the actual model; this prompt does not switch models or clear context by itself.

Copy the following prompt into that session:

> Implement the next eligible milestone of Fern's reactive physics plan, and only that milestone. Start with `AGENTS.md`, `docs/physics/README.md`, `docs/physics/STATUS.md`, `docs/physics/HANDOFF.md`, the selected milestone card and the preceding handoff. Confirm the previous milestone is merged into `main` using Git/GitHub evidence. Read only the relevant architecture, policy sections and source files next.
>
> The user prioritizes an ambitious, visibly reactive world. Do not reduce scope to meet an FPS target, add adaptive performance cutbacks, pursue cross-hardware numerical identity, or turn a working interaction into decorative particles. Performance is not a concern in this phase: get the features in and working, reasonably efficient where it is easy; a later stress-test pass decides what to scale back or adjust. Use the plan's per-area/per-region switches and clear off/on semantics. Preserve playable combat, progression and saves. Single player comes first: co-op is experimental, follows single-player needs and only has to keep working at a functional level; do not benchmark or tune its performance.
>
> Complete the milestone's steps and acceptance conditions, including the player-visible demonstration, state ownership, relevant save/network behavior and meaningful verification. Honor the existing permission and environment rules. Record consequential design changes in `docs/physics/DECISIONS.md` with evidence; do not endlessly reopen settled choices.
>
> Update its handoff and status before committing. Immediately push every commit, pass the appropriate checks, merge the milestone PR and verify the affected deployment. Report concrete results and the next card, then stop. A fresh chat must handle the next milestone. If context becomes tight before completion, persist a truthful partial handoff and continue this same milestone in a fresh session; do not mark it complete or quietly omit requirements.

The first implementation session should choose [M01](milestones/M01.md), unless verified repository progress shows it has already been completed.
