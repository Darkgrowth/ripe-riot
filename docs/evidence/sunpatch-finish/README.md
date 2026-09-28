# Sunpatch integrated polish — 2026-09-28

This build continues `ae693ff` and the existing combat foundation. It makes the
voxel presentation the normal launch path, completes the remaining fruit and
ground-dressing coverage, improves the mallet grip and trees, and repairs the
King Melon completion save. The original dirty `J:\RIPE RIOT` checkout was not
used for edits. Work is on `codex/sunpatch-finish`.

## Player-facing changes

- Two distinct shaft grips and narrower, diagonal forearms extend below the
  ultrawide camera. Ready, wind-up, contact, recovery and switching use the
  existing authoritative swing timing and mallet head.
- Orchard foliage surrounds three main boughs, retaining visible fruit gaps.
  Spreading, upright and windswept variants remain distinct. Palms now have
  continuous faceted curves and separated broad voxel fronds. Fruit sockets,
  trunk colliders and sway are preserved.
- All ten harvestable fruit species use the same voxel family in the world,
  distance batches and carry view. Gum trees, spike shrubs and all 2,287 seeded
  dressing placements now use the intended style across Sunpatch.
- Waterfall/pool rocks use the existing voxel rock family. King Melon anchor
  crags have broad strata with one shared visible and physical surface, identical
  for all peers regardless of diagnostic art settings. Their surface was
  intentionally reshaped; vine endpoints and the route remain in place.
- The objective follows vine cutting, falling and pushing to extraction. Signs
  describe ropes as optional. Completed saves restore the extracted melon,
  cleared vines and displayed payout without awarding money again; older saves
  fall back to the extraction pad.
- Normal URLs launch voxel mode. `?voxelPilot=0` remains a diagnostic baseline.
  Continuous terrain, water, flexible vines and authored character styling are
  retained; this is a selective stylized conversion.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Offline regressions | 189/189 | [Raw log](checks/offline.log) |
| Full production scenarios | 20/20 | [Raw log](checks/scenarios.log) |
| Host/client combat and revive | 10/10 | [Raw log](checks/co-op.log) |
| TypeScript and Vite production build | Passed | [Raw log](checks/build.log) |
| Normal keyboard/mouse opening loop | 9/9 beats; no browser errors or warnings | [Report](normal-input/report.json), [video](normal-input/normal-loop.webm) |
| Final production ultrawide visuals | 13 frames, 3440×1440, no browser errors | [Manifest](final/manifest.json) |
| Rendered hardware spot check | Dock, orchard and ravine; RTX 4070 Ti, 3440×1440 | [Measurements](performance.json) |
| Independent code review | No remaining blockers after crag collision fix | Actual trimesh parity regression included |

The normal-input run walked from the dock, encountered the Mimic warning, took
damage, continued fighting, defeated it with the mallet, picked up the physical
fruit, walked to the real sell pad and sold with E. It ended with 72 health and
$185. It used a fresh isolated profile at 1720×720, with no synthetic input or
teleports. The video predates the final palm shaft and sleeve refinement; the
final art is shown in the production captures below. Finale, optional-rope and
save/reload checks are controlled gameplay scenarios, not a full manual island
playthrough.

The hardware samples use uncapped headless Chromium, normal draws and simulation,
and a GPU synchronization on each sampled frame. The three views recorded
117–186 draw calls, about 3.3 million triangles and 2.6–3.1 ms p95 frame intervals.
These short samples are not a foreground frame-rate guarantee or minimum-spec
certification. The existing Vite large-chunk warning remains.

## Inspected final views

- [Dock and hut approach](final/00-dock.png)
- [Orchard](final/01-orchard.png) and [matching earlier view](before/01-orchard.png)
- [Palm shaft and canopy](final/02-palms.png) and [matching earlier view](before/02-palms.png)
- [Hill](final/04-hill.png), [ravine](final/05-ravine.png),
  [waterfall](final/06-waterfall.png), [grove](final/07-grove.png)
- [Ready grip](final/08-mallet-ready.png), [wind-up](final/09-mallet-windup.png),
  [contact](final/10-mallet-contact.png), [recovery](final/11-mallet-recovery.png),
  [basket switch](final/12-basket-switch.png)
- [All ten fruit meshes](fruit/fruit-family.png)
- Offline exported geometry: [orchard close view](../sunpatch-finish-trees/candidate-final/orchard-close.png),
  [palm close view](../sunpatch-finish-trees/candidate-final/palm-close.png),
  [shrubs](../sunpatch-finish-trees/candidate-final/shrubs-game-distance.png)

Final images were inspected at the normal gameplay camera. Before views used
software rendering; final views used D3D11, so they are visual comparisons, not
pixel-diff tests. Screenshots use fixed camera fixtures; they are separate from
the recorded ordinary-input run. These are implemented candidates, not a claim
of user art approval or human confirmation that the whole island is fun.

## Reproduce

Start an isolated server and set `RIPE_URL` to it. For the final production checks,
build first and use `vite preview` on a separate port.

```powershell
npm run build
node --test --test-concurrency=4 tools/harness/*.test.mjs
$env:RIPE_URL='http://127.0.0.1:5241'
$env:RIPE_HARDWARE='1'
npm test
node tools/harness/action-coop.mjs
node tools/harness/sunpatch-finish-review.mjs final
node tools/harness/sunpatch-performance.mjs
node tools/harness/voxel-clearing-loop.mjs --width 1720 --height 720 --seconds 300 --video --out capture/sunpatch-finish-normal-loop
```

`sunpatch-fruit-review.mjs` uses Vite source imports and therefore needs the dev
server. Large intermediate geometry exports and rejected render iterations stay
local and are ignored; selected final evidence and reproduction helpers are
tracked.
