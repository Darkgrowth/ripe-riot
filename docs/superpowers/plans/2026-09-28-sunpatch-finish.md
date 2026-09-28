# Sunpatch integrated finish

**Goal:** A coherent, enjoyable first-area action-harvest route using the latest combat and voxel work, with honest visual and gameplay evidence.

**Brief:** The user requests completion and polish following Analyze Fishing Game. The latest review rejects floating/crossed mallet forearms, bare orchard branch frameworks, stepped palm trunks, remaining mismatched fruit/bushes/cliffs, and the obsolete mandatory-rope sign. Preserve the current mallet design, continuous ground, authored route, saves, economy, existing enemies, host authority, and optional ropes.

**Base:** `ae693ff` on `codex/sunpatch-voxel-cohesion`, verified descendant of combat-foundation and quality-pass. Original dirty checkout and running previews remain untouched. Work occurs on `codex/sunpatch-finish`.

**Architecture:** Improve existing presentation and progression paths; no new islands, enemy roster, or major subsystem. Keep visual geometry separate from gameplay collision. Lead owns integration, defaults, remaining asset coverage, and evidence. Focused agents own disjoint files.

## Tasks and acceptance

- [x] Grip: inspect the actual GLB and viewmodel through ready, wind-up, contact, recovery, and switching. Give hands separate, plausible shaft grips and forearms which exit the lower camera without exposed square ends. Preserve weapon/head/contact alignment. Owner files: `src/render/Viewmodel.ts`, `src/render/WorkerHands.ts`, `src/player/MalletViewPose.ts`, related grip tests and offline rendering helpers.
- [x] Trees: simplify exposed branch scaffolding and restore asymmetric foliage around substantial branches; taper palm trunks continuously and retain separated broad fronds. Preserve fruit sockets, sway, colliders, routes, and batching. Owner files: `src/art/voxel/VoxelTrees.ts`, targeted tree tests and offline tree render helpers.
- [x] Gameplay: audit the current attack-to-host flow and dock-to-extraction objectives. Fix concrete gaps and stale required-rope copy, preserving once-only rewards, saves, cargo restrictions and enemy differences. Owner files: combat/enemy/boss/progression/UI/landmark text and focused tests; coordinate before touching a file outside this set.
- [x] Cohesion: launch voxel presentation by default with explicit baseline diagnostic opt-out. Audit remaining Sunpatch fruit, bushes, rocks/cliffs and route props; implement obvious holdouts using existing palette and merged/instanced geometry. Lead-owned art integration files.
- [x] Verification: baseline and final offline tests; meaningful regressions for behavior changes; typecheck/build; offline actual-geometry images. The user authorized isolated browser checks and requested ultrawide testing. Used separate headless profiles and servers for real input combat, route, co-op and 3440x1440 gameplay-camera captures.
- [x] Review and delivery: integrate disjoint work, inspect visuals, independent review, fix findings, commit/push coherent verified slices. Deliver one launch path and record remaining manual/art/performance limitations without claiming tests establish fun or approval.

## Review focus

1. Default URL and old saved games must enter the intended voxel art without changing saved economy/progression.
2. Hands must work across screen shapes and swing phases; centroid spacing alone does not prove no floating arm ends.
3. Foliage must frame harvestable fruit without hiding interactions or extending colliders.
4. The first-area goal text must agree with actual unlock gates and optional rope behavior.
5. Existing combat promises must survive: empty swing, contact timing, near/slope targets, obstruction, state cancellation, host duplicate rejection and rewards once.

## Decisions and progress

- The current request authorizes an integrated completion pass; do not impose a new stop between previously planned combat and cohesion stages.
- Read-only ancestry audit: combat-foundation and quality-pass both precede `ae693ff`; no earlier pass is discarded.
- Independent tasks share only public geometry/pose interfaces; lead integrates and commits. Agents do not change the same files or open browsers.


- Integrated verification passed: 189 offline tests, 20 production scenarios, 10 co-op checks, ordinary-input opening loop, typecheck/build and independent review. See docs/evidence/sunpatch-finish/README.md for evidence and precise limits.
- Review correction: anchor crags use one universal rendered/collision surface in both art modes; the new collider parity regression failed before and passed after the fix.
- Gameplay proof is separate from art fixtures. Final screenshots include all mallet phases and the island route at 3440x1440; no user art approval or full manual playthrough is claimed.
