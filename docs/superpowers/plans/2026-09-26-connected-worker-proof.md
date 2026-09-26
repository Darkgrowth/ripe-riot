# Connected Worker and Hands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a visually connected, articulated co-op worker and first-person hands as the first proof of RIPE RIOT's connected-asset direction.

**Architecture:** An editable Blender source exports a skinned worker GLB and connected glove meshes. A loaded template is cloned for co-op avatars and local ragdoll presentation; the existing six Rapier bodies remain collision proxies and feed a more detailed visual skeleton through a pose adapter. First-person tool and carry hands use authored connected geometry in the existing viewmodel framing.

**Tech Stack:** Blender 5.2 LTS Python and glTF exporter; Three.js 0.169 `GLTFLoader`, `SkeletonUtils`, `SkinnedMesh`; Vite/TypeScript; Rapier; Node test runner and existing Playwright harness.

**Spec:** `docs/superpowers/specs/2026-09-26-connected-character-assets-design.md`

## Global Constraints

- This plan covers **Stage 1 only**: the connected worker and first-person hands. Stop for the user's visual approval before changing the Mimic or other enemies.
- Organic surfaces that should flow together must have a modeled junction and deform together. Merging disconnected primitives, hidden overlaps, and a continuous shell that still bends like six stiff pieces fail the goal.
- Helmets, backpacks, boots, glove cuffs, and tools may have fitted, intentional seams. Keep A polygonal as a working direction and B as comparison evidence.
- Preserve the six Rapier bodies, five joints, collision behavior, camera anchor, recovery, co-op state, suit presets, gameplay hitboxes, real saves, and the active B preview.
- Work only in the isolated `codex/connected-character-assets` worktree. Commit and push each coherent verified task. Do not use headed browser QA or change a server the user is playing on.
- Exported models must have committed editable `.blend` source and a reproducible exporter. Blender 5.2's GLB exporter and this project's Three.js loader were smoke-tested together on 26 September; a skinned-worker contract test is still required.

## File map

| File | Responsibility |
| --- | --- |
| `tools/harness/worker-review.mjs` | Reproducible hidden-browser before/after co-op, ragdoll, tool, and carry capture at matched cameras. |
| `tools/assets/build_worker.py`, `assets/source/worker.blend` | Author and preserve editable worker body, skeleton, accessories, and two glove poses per hand. The script exports from one source. |
| `public/models/worker.glb`, `public/models/worker-hands.glb` | Shipped model data; no runtime construction from the old body and hand primitives. |
| `tools/assets/validate_worker.py`, `tools/harness/worker-asset.test.mjs` | Source topology, skin weights, named bones, GLB parse, and shape contract. |
| `src/player/WorkerAsset.ts` | Load templates once, clone skeletons, apply per-avatar palette, report missing asset, own shared resources. |
| `src/player/WorkerPose.ts` | Pure two-bone arm/leg targeting and pose conversion; smooth elbows, knees, wrists, ankles, neck. |
| `src/player/PlayerRig.ts` | Public visual rig facade and suit presets; instance lifecycle. |
| `src/player/PlayerRagdoll.ts`, `src/net/MultiplayerAuthority.ts`, `src/main.ts` | Feed visual pose from physics or network; preload assets before synchronous system init. |
| `src/render/WorkerHands.ts`, `src/render/Viewmodel.ts` | Clone connected tool/carry glove geometry and fit it to existing tool positions. |
| `src/player/CarryViewmodel.ts`, `src/player/ViewmodelSystem.ts` | Keep carry and tool visibility, framing, disposal and pose ownership correct. |
| `tools/harness/worker-pose.test.mjs`, `tools/harness/multiplayer.mjs`, `tools/harness/playtest-fixes.mjs`, `tools/harness/startup-check.mjs` | Focused pose, visible remote, camera clearance, and first-person framing checks. |
| `docs/CONNECTED_WORKER_PROOF.md`, `docs/evidence/connected-worker/` | Matched visual evidence, source/render metrics, test results, and remaining visual risks. |

## Review Focus

1. **Missing or corrupt GLB:** gameplay should still boot with an obvious diagnostic fallback; normal release checks must fail if fallback was used (Task 4).
2. **Repeated peer join/leave with different suit colors:** each avatar keeps its own material colors and releases per-instance resources without disposing shared geometry (Task 4).
3. **Extreme ragdoll orientations or targets beyond limb reach:** elbows/knees remain finite, bend in stable directions, and the camera anchor remains tied to the physical head (Tasks 3–4).
4. **Small/large/portrait viewports, tool swaps and expanding carried fruit:** gloves remain attached to tool or fruit, the crosshair stays clear, and no geometry clips the near plane (Task 5).
5. **Source/export drift:** connected source components, skeleton names and weighted GLB content are checked together, not inferred from an image (Task 2).

---

### Task 1: Matched baseline capture

**Files:** Create `tools/harness/worker-review.mjs`; create baseline captures in `docs/evidence/connected-worker/before/`.

**Interfaces:** Uses `tools/harness/driver.mjs` with `RIPE_URL` set to a dedicated server from this worktree. Produces named camera/pose fixtures reused after the asset change. Never touches the user's preview tab.

- [ ] **Step 1: Prepare only this worktree.** Run `npm ci` from the committed lockfile, then start a dedicated Vite server on a verified free port and set `RIPE_URL` to that server in the test shell. Do not reuse the existing B preview server.
- [ ] **Step 2: Write a failing fixture check.** `worker-review.mjs --check-fixtures` must require front/side/rear remote views, a normal-distance moving view, early and mid ragdoll views, mallet and Air Cannon views, and small/large fruit carry views at 1920×1080; include a 3434×1270 framing set. Check files and viewport metadata, not aesthetic quality.
- [ ] **Step 3: Run the check before capture.** `node tools/harness/worker-review.mjs --check-fixtures` must fail because the named baseline files are absent.
- [ ] **Step 4: Implement the hidden-browser fixture.** Use the existing driver and normal game cameras; label any debug-forced pose. Record exact viewport, position, yaw, time/phase and console errors in a manifest. Never point `RIPE_URL` at port 5197 or an active play session.
- [ ] **Step 5: Capture the old worker.** Run `node tools/harness/worker-review.mjs --before` before replacing code, in an isolated browser context.
- [ ] **Step 6: Verify the baseline.** Run `node tools/harness/worker-review.mjs --check-fixtures`, inspect images at gameplay size, and run `git diff --check`; expected: all named views present, no malformed captures or whitespace errors.
- [ ] **Step 7: Commit and push** the harness and baseline evidence.

### Task 2: Editable connected worker and glove source

**Files:** Create `tools/assets/build_worker.py`, `tools/assets/validate_worker.py`, `assets/source/worker.blend`, `public/models/worker.glb`, `public/models/worker-hands.glb`, `tools/harness/worker-asset.test.mjs`.

**Interfaces:** `build_worker.py` saves one editable source and exports both GLBs. `worker.glb` contains `WorkerBody` as one connected skinned mesh with named bones `Pelvis`, `Spine`, `Chest`, `Neck`, `Head`, `UpperArm_L/R`, `Forearm_L/R`, `Hand_L/R`, `Thigh_L/R`, `Shin_L/R`, `Foot_L/R`. `worker-hands.glb` contains `ToolGrip_L/R` and `CarryGrip_L/R`, each one connected palm/fingers/thumb/wrist component. Accessories and palette material slots are named to match `RigColors`.

- [ ] **Step 1: Write asset contract checks.** `worker-asset.test.mjs` parses both GLBs with `GLTFLoader`, requires one `SkinnedMesh` named `WorkerBody`, the listed bones and skin attributes, all four connected glove objects with position/normal/color attributes for the existing viewmodel merge, suit material roles, and a worker height compatible with the current 1.82 m avatar. `validate_worker.py` checks one topological component for `WorkerBody` and each glove, nonzero normalized weights at shoulder/elbow/hip/knee loops, no loose vertices, and distinct accessory attachment points.
- [ ] **Step 2: Run tests to confirm absence.** `node --test tools/harness/worker-asset.test.mjs` must fail on the missing GLBs.
- [ ] **Step 3: Author/export in Blender.** Before rigging, read `C:/Users/benma/.codex/local3d/SKILL.md` in full as required by the user's AGENTS instructions, including its portability notes. Model joined low-poly surface loops through torso/shoulders/neck/hips and along limbs, sculpt a readable face/silhouette, bind gradient weights around joints, fit helmet/pack/gloves/boots, and make distinct tool and cupped carry hand poses. Save the `.blend`; export the two GLBs using the verified Blender 5.2 workflow. The user does not need to model anything.
- [ ] **Step 4: Run source topology validation.** Run Blender background validation with `tools/assets/validate_worker.py`; expected: one body component, one component per glove, and valid weights.
- [ ] **Step 5: Run GLB contract tests.** `node --test tools/harness/worker-asset.test.mjs`; expected: every required bone, material role, and hand mesh present.
- [ ] **Step 6: Inspect the model.** Inspect source and exported GLB in an isolated viewer from front, side, rear, and bent poses; revise the source and rerun Steps 4–6 until visible junctions hold.
- [ ] **Step 7: Commit and push** source, exports, builder and checks.

### Task 3: Worker loading and pose library

**Files:** Create `src/player/WorkerAsset.ts`, `src/player/WorkerPose.ts`, `tools/harness/worker-pose.test.mjs`; add focused runtime checks to `tools/harness/worker-asset.test.mjs`. Do not switch the live `PlayerRig` yet.

**Interfaces:** `loadWorkerAsset(url: string): Promise<void>` caches one parsed template; `cloneWorkerVisual(colors: RigColors): { root: THREE.Group; body: THREE.SkinnedMesh; dispose(): void }` uses `SkeletonUtils.clone`, clones palette materials per avatar, and shares immutable geometry. `solveTwoBone(root: THREE.Vector3, target: THREE.Vector3, pole: THREE.Vector3, upperLength: number, lowerLength: number)` in `WorkerPose.ts` returns a finite elbow/knee and clamped target in the chain plane. `RigColors` remains exported by `PlayerRig.ts`.

- [ ] **Step 1: Write failing library tests.** Check reachable wrist/ankle targets, clamped unreachable targets, stable bend direction at near-straight and folded poses, independent palette materials for two cloned visuals, rest height and visible skinned body, and release of per-instance materials without disposal of shared geometry.
- [ ] **Step 2: Run focused tests red.** `node --test tools/harness/worker-pose.test.mjs tools/harness/worker-asset.test.mjs` must fail on the missing APIs.
- [ ] **Step 3: Implement the libraries.** Parse the worker GLB once, clone the skeleton and per-instance colors, keep immutable geometry shared, and implement stable two-bone targeting for arms and legs. Leave the current runtime avatar in place until Task 4, so this task is independently testable.
- [ ] **Step 4: Run focused tests.** `node --test tools/harness/worker-pose.test.mjs tools/harness/worker-asset.test.mjs`; expected: pass.
- [ ] **Step 5: Run the build.** `npm run build`; expected: TypeScript and Vite exit 0.
- [ ] **Step 6: Commit and push** the asset loader and pose math.

### Task 4: Integrate active, ragdoll and co-op poses

**Files:** Modify `src/player/PlayerRig.ts`, `src/player/PlayerRagdoll.ts`, `src/net/MultiplayerAuthority.ts`, `src/main.ts`, `tools/harness/multiplayer.mjs`, `tools/harness/playtest-fixes.mjs`; add cases to `tools/harness/worker-pose.test.mjs`.

**Interfaces:** `makePlayerRig(overrides?: Partial<RigColors>): PlayerRig` returns `{ root: THREE.Group, body: THREE.SkinnedMesh | null, source, setVisible, poseActive, posePhysics, dispose }`, where `source` is `'glb' | 'fallback'` and `body` is null only for the diagnostic fallback. `poseActive(input: { position: THREE.Vector3; yaw: number; height: number; time: number; moving: boolean; down: boolean; carrying: boolean; busy: boolean }): void`; `posePhysics(bodies: Record<RigPartName, { position: THREE.Vector3; quaternion: THREE.Quaternion }>): void`. `RigPartName` remains torso/head/armL/armR/legL/legR. `PlayerRagdoll.frameUpdate()` maps the six body world transforms into `posePhysics`; the physical head still drives the camera anchor. For each ragdoll arm, shoulder is the torso transform of `RIG_JOINTS.armL/R` and wrist target is the arm body center plus its local downward 0.26 m offset. For each leg, hip is the torso transform of `RIG_JOINTS.legL/R` and ankle target is leg center plus its local downward 0.28 m offset. Two-bone chains place elbows/knees between those anchors with stable outward/forward poles. `MultiplayerAuthority.poseRig()` calls `poseActive` from existing remote state without packet changes; keep the prior 8 rad/s walk cycle as timing reference, adding actual knee and elbow flex.

- [ ] **Step 1: Write failing adapter checks.** Ragdoll pose tests cover arbitrary tilted torso, crossed/far limb targets, finite joint transforms and head-anchor match; active pose tests require shoulder, elbow, hip and knee motion rather than only whole-limb rotation. In `multiplayer.mjs`, replace the six visible render-parts assertion with a skinned-body/bone visibility assertion that checks the remote rig during a fall. In `playtest-fixes.mjs`, check camera clearance against physical body/collider centers and review the rendered visual; do not weaken its clearance threshold without evidence. Test that a missing/corrupt GLB produces a visible diagnostic rig while gameplay boots, and that ordinary startup rejects `source === 'fallback'`.
- [ ] **Step 2: Run focused checks red.** Run `node --test tools/harness/worker-pose.test.mjs` and the affected browser checks on a dedicated hidden session; record actual failures before changing adapters.
- [ ] **Step 3: Connect the adapters.** Preload worker GLB before `game.initSystems()`. Build a diagnostic fallback if load fails, with a surfaced error and no gameplay dependency on that mesh. Replace six visible rigid segments with the cloned skinned visual. Remove visual-mesh ownership from `Part`; keep all Rapier body/collider/joint values. Feed active and physics poses through the new rig and keep recovery/network messages unchanged. Handle peer join/leave and independent suit colors with per-instance materials.
- [ ] **Step 4: Run focused tests.** `node --test tools/harness/worker-pose.test.mjs tools/harness/worker-asset.test.mjs`; expected: pass, including normal asset and fallback cases.
- [ ] **Step 5: Run co-op and camera checks.** `node tools/harness/multiplayer.mjs` and `node tools/harness/playtest-fixes.mjs` on the dedicated session at 16:9 and ultrawide; expected: pass with physical clearance preserved.
- [ ] **Step 6: Run the build.** `npm run build`; expected: TypeScript and Vite exit 0.
- [ ] **Step 7: Inspect movement.** Review walking, falling and recovering avatars plus both peer suits at the matched game camera; fix and repeat affected checks if needed.
- [ ] **Step 8: Commit and push** only when this combined runtime change works.

### Task 5: Connected first-person hands in tool and carry views

**Files:** Create `src/render/WorkerHands.ts`, `tools/harness/worker-hands.test.mjs`; modify `src/render/Viewmodel.ts`, `src/player/CarryViewmodel.ts`, `src/player/ViewmodelSystem.ts`, `src/main.ts`; update `tools/harness/startup-check.mjs` only where its geometry probe needs the new mesh structure.

**Interfaces:** `loadWorkerHands(url: string): Promise<void>` loads the four glove templates before system init. `toolHand(side: 'L' | 'R', position: THREE.Vector3, roll: number): THREE.BufferGeometry` returns a transformed geometry clone for the existing `assemble` path. `gripHand(material: THREE.Material, inward: 1 | -1): THREE.Mesh` retains the public carry interface but uses the corresponding connected cupped mesh. Every returned per-view geometry is owned and disposed by its viewmodel; templates live until game disposal.

- [ ] **Step 1: Write failing glove tests.** Check each tool ID gets connected hand geometry at its existing grip, left/right orientation is correct, both carry hands cup fruit, source geometry is not mutated by a second tool, and repeated swaps do not leak per-instance geometry.
- [ ] **Step 2: Run focused tests red.** `node --test tools/harness/worker-hands.test.mjs` must fail on the missing loader and hand API.
- [ ] **Step 3: Replace primitive hands.** Remove `hand()` and the padded-piece `gripHand()` construction while keeping tool bodies, hold points, scene separation, stow timing, and the existing carry proxy. Load gloves once and keep first-person tool/carry presentation independent of third-person physics.
- [ ] **Step 4: Run glove tests.** `node --test tools/harness/worker-hands.test.mjs`; expected: pass.
- [ ] **Step 5: Run framing checks.** `node tools/harness/startup-check.mjs` in a hidden isolated browser at standard and ultrawide viewports; expected: no frame overflow or near-plane clipping.
- [ ] **Step 6: Inspect tool and carry grips.** Review mallet, Air Cannon, basket, bare hands, and small/large fruit at 16:9 and ultrawide; fix clipping or detached-looking poses and rerun affected checks.
- [ ] **Step 7: Commit and push** the connected viewmodel hands.

### Task 6: Integrated visual proof and handoff

**Files:** Complete `tools/harness/worker-review.mjs`, `docs/evidence/connected-worker/after/`, `docs/CONNECTED_WORKER_PROOF.md`; adjust only affected code from concrete failures.

**Interfaces:** Reuse Task 1 fixture IDs and cameras. The report links matching before/after images and short normal-control movement, tool/carry and ragdoll/recovery clips. It marks authored/debug poses separately from normal-input demonstrations and records renderer, viewport, DPR, draw calls, frame timings and browser errors.

- [ ] **Step 1: Capture after states.** Run `node tools/harness/worker-review.mjs --after` on a dedicated hidden session. Collect front/side/rear and gameplay-scale co-op views, walk, both tool grips, carry classes, knockdown and recovery at the same fixtures. Inspect every frame at native gameplay scale and fix visible assembly, collapse, gaps, clipping or unclear movement.
- [ ] **Step 2: Run focused asset and pose tests.** `node --test tools/harness/worker-asset.test.mjs tools/harness/worker-pose.test.mjs tools/harness/worker-hands.test.mjs`; expected: pass.
- [ ] **Step 3: Run the game suite.** `npm test`; expected: pass, or report a confirmed unrelated baseline failure separately.
- [ ] **Step 4: Run co-op checks.** `node tools/harness/multiplayer.mjs` and `node tools/harness/action-coop.mjs`; expected: pass.
- [ ] **Step 5: Run presentation checks.** `node tools/harness/startup-check.mjs` and affected `playtest-fixes.mjs` cases; expected: pass.
- [ ] **Step 6: Run build and diff checks.** `npm run build` and `git diff --check`; expected: both exit 0. Repeat only checks affected by later fixes.
- [ ] **Step 7: Record evidence honestly.** Write `docs/CONNECTED_WORKER_PROOF.md` with linked matched captures, source-topology result, test counts, render metrics and exact remaining limitations. Software rendering does not establish actual hardware frame rate. Do not claim art approval before the user sees the proof.
- [ ] **Step 8: Commit and push.** Verify the worktree and remote commit match. Present gameplay captures and source to the user for visual approval of the worker proof before touching the Mimic, Snapjaw or other assets.
