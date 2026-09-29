# Sunpatch Expedition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. The lead owns integration and commits.

**Goal:** Make Sunpatch a complete action-harvesting expedition from arrival to a saved dock settlement.

**Architecture:** Extend the existing systems with authored site stages and a small chapter shell. Keep host authority in MultiplayerAuthority, local recovery in PlayerVitals, and chapter persistence in Progression/SaveSystem. New views consume these states instead of inventing rewards.

**Tech Stack:** TypeScript, Three.js, Rapier, Vite, Playwright, Node tests.

**Spec:** `docs/superpowers/specs/2026-09-29-sunpatch-expedition-design.md`

## Global Constraints

- Continue d5ae411 in the attached sunpatch-finish worktree; do not merge main.
- Preserve the live 5243 preview, original dirty checkout, saves, current art and mallet.
- No permanent island timer, new enemy roster, mandatory purchase or required rope.
- Separate replay slots; diagnostic fresh runs must not write the legacy auto slot.
- All reward/site mutations are authoritative and deduplicated.

## Review Focus

- An old save with cleared milestones must not restore payable living enemies.
- One physical blast affecting several crop nodes must not skip a warning stage.
- A host migration during a harvest must preserve release/consumed state.
- Menus opened during danger must handle solo pause and co-op local input correctly.
- Starting a new expedition or refreshing a results screen must not replace an old save or duplicate payout.

### Task 1: Authored harvest sites and dependable ranged encounters

**Files:** `src/enemies/{HarvestSites,EncounterModel,EncounterSystem,EncounterVisuals}.ts`, `src/fruit/FruitSystem.ts`, `src/interaction/InteractionSystem.ts`; focused site/projectile tests.

**Interfaces:** `FruitSystem.beforeHarvest(plantId, cause): boolean` gates mutation once per deliberate action; `EncounterSystem.siteState()/applySiteState(state)` replicate site stages; `restoreCleared(kinds)` silently restores old victories. Add serializable site/reward ledger. Lead wires net snapshots, typed `harvest:site` events and FruitAuthority claim refusal when detach remains blocked.

- [x] Add failing tests for warning/second-action activation, safe ordinary fruit, once-only release, save/migration and leash.
- [x] Implement the three existing-enemy sites, visible temptation and restrained warning feedback.
- [x] Add failing obstruction/reflection tests; implement swept solid blocking before target contact and reflected seed travel.
- [x] Verify focused tests and typecheck; inspect rendered sites and audit authority/serialization.

### Task 2: Chapter shell, saved ending and separate replay

**Files:** `src/save/SaveSystem.ts`, `src/systems/Progression.ts`, new `src/ui/ExpeditionShell.ts` and its stylesheet, necessary existing HUD/character/dock copy; save/chapter tests.

**Interfaces:** Save options select slot/load/persistence before init. Progression exposes `chapterState: active|return|settled`, an idempotent dock settlement and results data. DOM actions use `data-expedition-action=continue|new-replay|resume|continue-exploring`. Lead registers the shell and supplies build ID before boot. Coordinate silent `restoreCleared` with Task 1.

- [x] Pin legacy auto preservation, fresh non-persistence, separate replay/continue and completed-save migration with failing tests.
- [x] Implement title/pause/control/result flow, King Melon mission introduction and honest return objective.
- [x] Add an explicit dock settlement interaction, visible dock completion and saved results with no second payout.
- [x] Verify solo pause, co-op menu behavior, reload/results and ultrawide presentation.

### Task 3: Recovery and shared integration (lead)

**Files:** `src/player/PlayerVitals.ts`, new `src/player/DockRecovery.ts` if needed, `src/main.ts`, `src/core/GameEvents.ts`, `src/net/{MultiplayerAuthority,FruitAuthority}.ts`, `vite.config.ts`; focused tests.

**Interfaces:** `PlayerVitals.recoveryGraceRemaining` is two seconds after revive/checkpoint. Encounter damage/aggro excludes protected players while attack validation retains their actor identity; host derives remote grace from downed-to-active transitions. Gate defeat payment against saved cleared milestones before emitting the normal completion event.

- [x] Add failing grace/retry tests and implement clear, fair recovery with safe dock healing.
- [x] Wire site snapshots, harvest denial, persistent defeats, chapter state and modal input ownership.
- [x] Supply a visible build ID; preserve both existing production outputs and normal diagnostic fixtures.
- [x] Run affected regressions and verify recovery/ownership on real host/client transport.

### Task 4: Complete expedition acceptance and delivery

**Files:** `src/systems/LegendaryHarvest.ts`, new `tools/harness/sunpatch-expedition-playthrough.mjs`, scenario coverage and `docs/evidence/sunpatch-expedition/`.

- [x] Pin the measured unreachable-vine problem, then add visible ground tie-offs with real aim/range/LOS, preserving the existing anchor constraints and optional ropes.
- [x] Extend the real-input opening controller through the three sites, King Vine, vine cutting, extraction and dock settlement. Reads may guide navigation; game-state writes may not resolve the run.
- [x] Record a fresh isolated ultrawide run and inspect major encounter/ending frames.
- [x] Run the offline suite, production scenarios, save/replay/menu tests and affected co-op checks; fix reproduced failures.
- [x] Independently review the integrated branch, update this ledger, commit and push coherent verified changes. Report bot acceptance separately from first-time human pacing.

## Execution ledger

- Design adopted from the user's referenced latest chat; no repeated design permission needed.
- Existing worktree verified clean at d5ae411 and reused; 5243 serves a preserved static output.
- Inspection identified missing defeated-enemy restore and unsafe `?fresh` auto-save behavior; both belong to this milestone.
- Ruling: add ground-reachable, visibly connected vine cutting points — sampled vine clearance is 9.95–10.71 m while E reach is 7 m. Hidden ladder/self-launch requirements violate the direct introductory finale; existing anchors/drop/rope physics remain.
- Ownership: integration_review implements harvest sites and encounters; gameplay_finish implements chapter shell/persistence; playful_review implements reachable finale and full normal-input acceptance; lead implements recovery and shared integration.
- Runtime discovered the painted orchard-to-farm path had a 60.95-degree lip, above the 53-degree controller limit. A bounded grade follows the same path between the existing 7.5 m orchard and 21 m farm; its walking corridor now measures at most 40.14 degrees. Physical traversal and later return remain part of ordinary-input acceptance.
- Integration fixtures: 260 offline checks pass; 17 real-transport co-op checks pass including consumed prizes, remote dock settlement, no second payout and migration. Focused shell checks pass title/pause/controls/sound/replay/original/results with no page exceptions. Full ordinary-input expedition acceptance is still running.

- Final route review: the painted return path had 60.90 and 67.57 degree lips. Grading its existing centerline and joining the western ravine walkout produces a <=45.24 degree collision corridor across +/-1 m. Original melon anchor feet are pinned to the measured baseline, and drop/landing heights remain exact. The western walkout's steep outer edge is inherited; its central +/-0.6 m corridor remains below48 degrees.
- King Vine is grounded at the existing worksite (-20,-35), with a ground root joining the cutting ties. Actual starter-mallet access was verified. A solo target-filter regression now keeps downed or briefly recovering players out of new attacks.
- Ordinary-input attempts are retained: hill access, original unreachable guardian and a stationary boss controller were exposed and repaired at the appropriate layer. No fixture victory is presented as full ordinary-input acceptance.
- Sequential slow cuts exposed a real ridge landing with no reliable walking access. The marked farm recovery route now has actual collision slopes <=44.37 degrees across +/-1.35 m. A visible physical timber receiver catches the melon inside the unchanged payout bounds; continuous settled contact is required, and submerged failure regrows after 25 game seconds without another guardian fight.
- Attempt 7 completed all 26 ordinary-input beats in 309.53 seconds, including physical extraction, walking home, explicit E settlement and reload with no duplicate payment. The earned results/dock were inspected at 3440 x 1440. No game state was written to win the run. A later label-only adjustment was separately verified at close range. Human first-time pacing remains unmeasured.
- Final validation: 279/279 offline regressions, 20/20 production scenarios, 20/20 real-transport co-op checks, 11/11 authored harvest runtime checks and title/pause/controls/sound/separate-save fixtures passed. Production build/typecheck passed. The later label placement change passed all four runtime reach/LOS checks and visual inspection. Independent integration review found no concrete blocker; original checkout and 5243 preview remain preserved.
