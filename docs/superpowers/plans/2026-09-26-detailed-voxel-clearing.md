# Detailed Voxel Clearing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the first fully playable detailed-voxel orchard clearing in the existing RIPE RIOT game, with a worker, first-person hands/tools, fruit, orchard presentation and Mimic that form one coherent visual language.

**Architecture:** Keep existing Three.js/Rapier gameplay and introduce an opt-in `voxelPilot=1` presentation path. Version the worker/hand GLBs, batch voxel surface geometry for fruit, trees, tools and Mimic, and layer orchard art on the current terrain height without changing collision or route coordinates. Integrate in the existing system constructors and prove a normal-input combat-to-delivery loop.

**Tech Stack:** TypeScript, Three.js r169, Blender 5.2 Python, Vite, Rapier, Node test runner, headless Playwright.

**Spec:** [Detailed voxel visual overhaul](../../DETAILED_VOXEL_OVERHAUL.md)

## Global Constraints

- Default game visuals and `mimicCompare=A/B` remain available; the pilot activates only through `voxelPilot=1` in normal gameplay.
- Keep combat, fruit ownership, economy, progression, saves, networking, input, carrying and existing physics behavior.
- No one-Mesh-per-voxel, mining, block placement, arbitrary terrain destruction or physics per voxel.
- Main paths remain walkable and visible terrain follows `Terrain.height`; meaningful colliders stay aligned.
- Use the finer rounded first voxel study as a starting visual language, not the coarse square-tree second study.
- Keep the dirty `J:\RIPE RIOT` checkout and the active 5197/5199/5201 previews untouched. Use this isolated worktree and a new dedicated QA port.
- Visual approval requires gameplay-scale stills and continuous motion, in addition to passing automated checks.

## Review Focus

- A saved game must still load with and without `voxelPilot=1`, without changing the save schema or stored art flag.
- Co-op peers must use the same 17-bone worker contract and team suit colors; no missing or floating pieces through walk and ragdoll.
- Orchard fruit must stay attached through plant sway and remain pickable with unchanged collision and attachment data.
- Hands, Mallet, Air Cannon, fruit carry and warning signs must remain readable at 1920×1080 and 3434×1270.
- Mimic warning, committed attack, knockback, recovery, reward pickup and delivery must remain observable with normal controls.

## File Map

- `src/art/voxel/VisualMode.ts`: query parsing and the opt-in mode type.
- `tools/assets/build_voxel_worker.py`, `assets/source/voxel-worker.blend`, `public/models/voxel-worker*.glb`: versioned editable worker/hand assets.
- `src/art/voxel/VoxelSurface.ts`, `VoxelFruit.ts`, `VoxelTrees.ts`: batched geometry and orchard art geometry contracts.
- `src/art/voxel/VoxelTools.ts`: Mallet and Air Cannon body geometry for first-person presentation.
- `src/art/voxel/VoxelClearingTerrain.ts`: visual-only orchard ground treatment conformed to the existing terrain.
- `src/enemies/VoxelMimicGeometry.ts`: finer stepped rind and threat anatomy; `MimicRig.ts` keeps the animation controller.
- Existing `main.ts`, `Sunpatch.ts`, `FruitRenderer.ts`, `Plants.ts`, `Viewmodel.ts`, `ViewmodelSystem.ts`, `EncounterSystem.ts`: narrow mode wiring; no new gameplay authority.
- `tools/harness/*voxel*`: focused contracts and normal-input route evidence; `docs/evidence/detailed-voxel-clearing/`: screenshots, videos, manifests.

## Task 1 — Mode boundary and unchanged default

**Interfaces:** `selectVisualMode(search: string, comparison: boolean): 'baseline' | 'voxel'` in `VisualMode.ts`; `?voxelPilot=1` selects voxel only when no A/B comparison is active.

- [ ] Write `voxel-visual-mode.test.mjs`: default and A/B stay baseline; `?voxelPilot=1` selects voxel; unknown values do not.
- [ ] Run it red, implement the selector, then run green.
- [ ] Parse mode in `main.ts` without altering the save schema or normal bootstrap order; keep mode-specific asset/system wiring in the tasks that provide those assets.
- [ ] Build and run one baseline boot smoke and one pilot-query boot smoke; commit.

## Task 2 — Animated worker and first-person grips

**Interfaces:** new `/models/voxel-worker.glb` and `/models/voxel-worker-hands.glb` satisfy existing `WorkerAsset.ts` and `WorkerHands.ts` contracts. The body has a single skinned `WorkerBody`, 17 named bones and team-palette UV roles; each ToolGrip/CarryGrip is a connected fitted glove mesh.

- [ ] Add source/build script and new outputs without overwriting the current GLBs. Author roughly 40–48 vertical modeling units with clear head/cap/face, fitted clothing, gloves, boots and pack.
- [ ] Run the current worker/hand contract tests against both default and voxel GLBs; add a voxel-specific test for topology, height, bone names and four glove poses.
- [ ] Inspect source front/side/rear and bent limb views; fix missing underarms, gaps, poor weights or intersections before integration.
- [ ] Switch `main.ts` preload URL only in pilot mode; capture normal co-op walk, ragdoll and first-person hands on the new port; commit.

## Task 3 — Fruit and orchard trees

**Interfaces:** `voxelFruitGeometry(species: string): THREE.BufferGeometry` is unit diameter with vertex colors; `voxelPlantShape(type, variant, harvestCrown): PlantShape` preserves attachment, sway and collider metadata.

- [ ] Add focused tests for apple/orange/watermelon silhouettes, unit geometry, color, batched faces, `swayWeight`, unchanged attach coordinates and collider scale; run red/green.
- [ ] Build rounded stepped fruit and irregular tree crowns with restrained color patches.
- [ ] Add pilot geometry selection to `FruitRenderer.ts` and `Plants.ts`; keep normal instancing, wind and fruit interaction intact.
- [ ] Prove orchard fruit remains attached during sway, can be picked and sold, and draw objects remain batched; commit.

## Task 4 — Mallet, Air Cannon and orchard ground

**Interfaces:** `voxelToolParts(toolId: 'hand' | 'aircannon')` supplies merged vertex-colored geometry and existing hold point; `buildVoxelClearingTerrain(terrain: Terrain)` returns one visual mesh conformed to `Terrain.height` around the orchard.

- [ ] Add tests for tool bounds/grip positions and terrain visual-vs-physics height gap; run red/green.
- [ ] Sculpt batched tool bodies with readable handle, head, barrel, pressure chamber and gauge. Use the versioned voxel hand poses through the existing viewmodel.
- [ ] Add a quiet, layered orchard path/grass/shore treatment and authored voxel props at the clearing; keep path clearance and delivery interaction positions.
- [ ] Capture first-person Mallet/Air Cannon/carry and route views at standard and ultrawide sizes; fix clipping or path/collider mismatch; commit.

## Task 5 — Detailed Mimic on the existing fight

**Interfaces:** add `MimicStyle='voxel'`, consuming `VoxelMimicGeometry.ts`; do not modify encounter state, hitboxes, damage, reward or animation timings.

- [ ] Add geometry tests for stepped-round rind, visible mouth split, teeth, eyes, crown stem and connected/supporting roots; run red/green.
- [ ] Integrate the new geometry with the existing `MimicRig` warning, lunge, hit and recovery poses.
- [ ] Run focused Mimic model/gameplay tests and record matched warning, attack, hit, recovery and defeat views in normal play; commit.

## Task 6 — Complete clearing acceptance

**Interfaces:** normal `?voxelPilot=1` game path, not a static proof or A/B fixture. The player walks into the orchard, takes one hit, recovers, defeats Mimic, secures the physical prize, and sells at an active delivery point.

- [ ] Run build, affected asset/unit/game/co-op/route checks; distinguish baseline failures from regressions.
- [ ] Run the normal-input full loop at 1920×1080 and 3434×1270, saving screenshots, continuous video, camera/renderer metrics and browser logs.
- [ ] Review worker/tree/fruit/Mimic close-up and at real first-person play distance; inspect animation and clear telegraphs through the full loop.
- [ ] Run one independent final reviewer, fix actionable findings, update the spec/evidence/status, commit and push the verified milestone. Stop expansion until the user judges the visual standard.

## Later stages

After the clearing is visually accepted, derive the reusable asset conventions (Stage 2), convert the rest of Sunpatch in coherent areas (Stage 3), then verify a fresh-save opening, multiplayer and hardware performance (Stage 4) as specified in the overhaul document. These stages use their own area plans and evidence; the clearing's implementation does not silently claim they are complete.
