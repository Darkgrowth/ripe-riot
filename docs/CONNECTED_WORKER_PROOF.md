# Stage 1: connected worker and first-person hands

**Status:** implemented proof, awaiting visual approval. This pass changes the worker body, its two authored hand poses, and their runtime adapters. It does not change Mimic, Snapjaw, other game assets, physics bodies, hitboxes, saves, route layout, or the user's active B preview. Work was captured in a dedicated headless browser on port 5199.

## Matched game-camera views

The 13 core fixture IDs use matching setup, viewports and sequence before and after the asset change. Physics changes the exact camera position during and after a fall, so these are comparable game views rather than pixel-aligned camera poses. Five additional after frames cover the basket, more ultrawide grips and the blue co-op suit. The [before manifest](evidence/connected-worker/before/manifest.json) and [after manifest](evidence/connected-worker/after/manifest.json) record each actual camera position, pose label, viewport, renderer, draw calls and errors. The after manifest also records DPR, interaction and viewmodel state, and CPU frame phases. The fall stills are explicitly debug-triggered physics, while the walking still uses normal movement input.

| View | Before | After |
| --- | --- | --- |
| Worker front | [PNG](evidence/connected-worker/before/remote-front.png) | [PNG](evidence/connected-worker/after/remote-front.png) |
| Worker side | [PNG](evidence/connected-worker/before/remote-side.png) | [PNG](evidence/connected-worker/after/remote-side.png) |
| Worker rear | [PNG](evidence/connected-worker/before/remote-rear.png) | [PNG](evidence/connected-worker/after/remote-rear.png) |
| Walking at game distance | [PNG](evidence/connected-worker/before/remote-walk.png) | [PNG](evidence/connected-worker/after/remote-walk.png) |
| Ragdoll early and mid | [early](evidence/connected-worker/before/ragdoll-early.png), [mid](evidence/connected-worker/before/ragdoll-mid.png) | [early](evidence/connected-worker/after/ragdoll-early.png), [mid](evidence/connected-worker/after/ragdoll-mid.png) |
| Starter mallet | [PNG](evidence/connected-worker/before/mallet.png) | [PNG](evidence/connected-worker/after/mallet.png) |
| Air Cannon | [PNG](evidence/connected-worker/before/aircannon.png) | [PNG](evidence/connected-worker/after/aircannon.png) |
| Small fruit | [PNG](evidence/connected-worker/before/carry-small.png) | [PNG](evidence/connected-worker/after/carry-small.png) |
| Large fruit | [PNG](evidence/connected-worker/before/carry-large.png) | [PNG](evidence/connected-worker/after/carry-large.png) |
| Ultrawide large fruit | [PNG](evidence/connected-worker/before/carry-large-uw.png) | [PNG](evidence/connected-worker/after/carry-large-uw.png) |
| Ultrawide mallet | [PNG](evidence/connected-worker/before/mallet-uw.png) | [PNG](evidence/connected-worker/after/mallet-uw.png) |
| Ultrawide ragdoll | [PNG](evidence/connected-worker/before/ragdoll-mid-uw.png) | [PNG](evidence/connected-worker/after/ragdoll-mid-uw.png) |

Additional after views: [basket](evidence/connected-worker/after/basket.png), [basket ultrawide](evidence/connected-worker/after/basket-uw.png), [Air Cannon ultrawide](evidence/connected-worker/after/aircannon-uw.png), [small fruit ultrawide](evidence/connected-worker/after/carry-small-uw.png), and a [blue co-op suit](evidence/connected-worker/after/remote-blue.png). The worker's editable/exported source was inspected [front](evidence/connected-worker/source-review/front.png), [side](evidence/connected-worker/source-review/side.png), [rear](evidence/connected-worker/source-review/rear.png), [bent](evidence/connected-worker/source-review/bent.png), and with [both glove poses](evidence/connected-worker/source-review/gloves.png). The source hand review is the bare-hand inspection; the current game does not equip an untooled bare-hands state.

## Motion clips

The [motion manifest](evidence/connected-worker/after/motion-manifest.json) marks authored setup and records each frame's gameplay state. These 960×540, 10 fps videos come from actual game canvas frames in headless Chromium. The walk and tool/carry clips are **accelerated sample reels**: 29.25 and 26.25 seconds of game time are encoded into 2.4 and 3.2 seconds of playback. The fall clip spans 2.58 seconds of game time in 3.2 seconds of playback. Playback speed is not a frame-rate measurement. The walk uses normal continuous peer input; its sampled remote travels 7.59 m, with 0.99 rad thigh and 0.84 rad arm angular departures from the opening pose.

- [Normal-input co-op walk](evidence/connected-worker/after/worker-walk.mp4)
- [Physics fall and recovery](evidence/connected-worker/after/worker-fall-recover.mp4)
- [Mallet, Air Cannon, basket and carried fruit](evidence/connected-worker/after/worker-tool-carry.mp4)

## Source and runtime contract

`assets/source/worker.blend` is editable, and `tools/assets/build_worker.py` exports both shipped GLBs from it. Blender source validation found **one topological component** in `WorkerBody` and each of the four `ToolGrip`/`CarryGrip` objects, with no loose geometry. The body has 1,690 vertices and 1,688 faces; the four gloves have 1,252 vertices each. The shoulder, elbow, hip and knee loops all have blended skin weights. The GLB contract checks the 17 named bones, the single skinned body, material roles, vertex color attributes and glove objects.

The six existing Rapier bodies and five joints still own gameplay and camera collisions. A two-bone visual solver bends elbows and knees in active and ragdoll poses. Co-op avatars clone the skinned worker with per-peer palette materials; the body geometry is shared. The four connected hand meshes replace the old separate palm/finger/cuff viewmodel pieces. Tool and carry geometries are per-view clones and are disposed with their viewmodels.

The loader checks required skeleton bones before accepting an asset. A missing or corrupt worker or hand GLB leaves gameplay running with conspicuous diagnostic geometry and a persistent warning. This is an error path, not a substitute for the shipped connected art.

## Verification and limits

- Focused asset, pose and glove tests: **12/12 passed**, including rejection of a parseable worker GLB with a required bone missing.
- Blender source topology: **passed**. TypeScript/Vite production build: **passed**.
- The game suite passed **20/20** scenarios. The focused co-op action suite passed **10/10** checks, the headless worker runtime/fallback probe passed, and `playtest-fixes.mjs` passed at 1920×1080 and 3436×1270, including physical ragdoll camera clearance and recovery.
- The full `multiplayer.mjs` suite still stops at its existing rope rejoin fixture: `mineOnClient` is undefined at line 787. The same failure was recorded before this visual integration; the focused co-op and worker runtime checks above passed. Full multiplayer suite success is therefore **unverified** for this Stage 1 pass.
- The captured renderer was SwiftShader with DPR 1. The 18 after stills report 178–331 draw calls and 927,220–950,166 scene triangles. Recorded `profile.total` values range from 0.6–9.2 ms; these are browser CPU frame-phase measurements, not GPU timings or hardware frame rate. The capture logged no JavaScript errors; SwiftShader emitted readback-stall warnings during screenshots.
- One independent final reviewer inspected the source, matched stills and updated walk clip. The reviewer found no remaining code blocker after the gait and loader fixes; this does not constitute the user's visual approval.
- `startup-check.mjs` reports eight framing assertions against the unchanged starter mallet. Its head occupies 49.5% of frame height against a 24% cap, with additional top/crosshair assertions across aspect ratios. The mallet head occupies the same height in the committed before capture. The new glove geometry stays inside the horizontal frame and more than 0.3 m from the near plane in this check. This is a baseline presentation limit of the unchanged tool body, not an approved new framing target.
- Visual inspection here establishes that the connected body and gloves render in the named views. **Art direction and final visual approval belong to the user.** SwiftShader captures do not establish performance or presentation on the user's hardware.
