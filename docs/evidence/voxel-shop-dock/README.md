# Merv's shop and dock hub voxel pass

This focused pass extends the opt-in `?voxelPilot=1` art mode from the existing
route into Merv's shop and its immediate dock cargo. It keeps the shop footprint,
counter, sell pad, colliders, buying and selling logic, and Merv's interaction
position. The baseline mode remains available for direct comparison.

## Matched visual review

The `baseline/` and `voxel/` folders contain paired 1920×1080 gameplay-camera
views: `dock-arrival`, `shop-approach`, `shop-front`, `buy-counter`, and
`sell-pad`. The voxel views were inspected at approach and counter distance.
Merv's hat, face, shirt and apron are visible behind the counter; the shop has
broader roof courses, a fitted stone base, voxel produce, sacks and barrels.
Separate signs identify the buy counter and the sell pad. The hanging shop sign
is readable on approach from the dock.

`manifest.json` records renderer counts and errors for every capture. All ten
views had zero page errors and zero pointer-lock calls. The capture script uses
isolated headless Chromium with no mouse click or tab-focus call. Run it against
an isolated server with:

```powershell
$env:RIPE_URL='http://127.0.0.1:5231'
node tools/harness/voxel-shop-review.mjs
```

At the matched dock view, the current baseline submits 937,604 triangles in
262 draw calls; the whole opt-in voxel mode submits 2,437,542 triangles in 247
calls. This comparison includes the already voxelized trees, terrain, fruit,
worker and other route assets. It does not isolate the shop's cost or measure
GPU frame time. The [earlier voxel performance report](../voxel-performance-pass/README.md)
used a different source state and should not be treated as a direct before/after
GPU comparison for this pass.

## Checks

- `npm run build` passed (TypeScript and Vite; existing chunk-size warning).
- `npm test` passed 20/20 gameplay scenarios in baseline mode.
- `RIPE_VOXEL_PILOT=1` with `npm test` passed 20/20 scenarios in voxel mode,
  including the harvest and sale loop.
- `node --test --test-concurrency=1 tools/harness/prop-builder-color.test.mjs tools/harness/detailed-voxel-geometry.test.mjs`
  passed 9/9 tests.
- `node tools/harness/island-characters-offline.mjs` passed 25/25 CPU fixtures.
- `git diff --check` passed.

The screenshots are scripted camera views. A normal-input, jointed gameplay
review of worker ground contact and user approval of the art are still open.
