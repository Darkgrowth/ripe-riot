# Sunpatch harvest hero assets — 20 September 2026

This continues the orchard, glove and HUD proof in `IDENTITY_PROOF.md`.
The design reference remains chunky cartoon 3D: rounded, recognizable fruit
and exaggerated harvesting equipment. This pass changes the ordinary
watermelon and first-person air cannon. It does not finish the entire island.

## Result

The watermelon has a rounder silhouette, six broad winding rind bands,
a subtle field spot, a five-lobed calyx, bent stem, small stem curl and
underside blossom scar. Its body diameter and vertical envelope are retained.
The other nine species are byte-identical to the pre-pass geometry; the
separate King Melon model is unchanged. The carry fixture is still 22 kg,
0.8 m diameter, with a 29.7% screen-height target and the existing cupped gloves.

The air cannon now reads as a pressure vessel: teal enamel, cream straps and
bolted breech, brass reservoir, curved hose, open red bell mouth and rubber
grips. Fixed parts remain one merged mesh. One additional child mesh animates
the dial from the actual tool charge, using the same material. Both geometries
are disposed by the existing viewmodel lifecycle. Only the cannon receives
the small framing adjustment; other tool geometry and framing are preserved.
No tool power, fruit physics, progression or authority logic changed.

## Visual and input evidence

`capture/harvest-hero/review.html` contains full-DOM before/after comparisons
at 1920×1080 and 3434×1270. Regenerate it with
`node tools/harness/harvest-hero-review.mjs`. The source backups in
`capture/harvest-hero/source-before/` are the exact pre-pass files, including
the earlier approved glove work. Cameras match at (-12.14, 7.52, 16.4),
yaw -0.14, pitch 0.08. Wind and idle animation timing can differ.

The QA inventory covers the cannon silhouette, gauge readability and direction,
watermelon silhouette/stripes/stem, HUD clearance, charge/release, cancellation
by tool switching, and carrying/dropping while the cannon is selected.
Wide and ultrawide gameplay captures were inspected. The final input review
recorded no page errors. Debug position/fruit setup was followed by real mouse
and keyboard actions:

- Holding LMB reached charge 1 and dial rotation -1.1; releasing fired at
  power 1 and reset charge to 0 / rotation +1.1.
- Switching to the hand during charging, releasing, and returning to the
  cannon canceled the charge without another shot.
- Picking up a watermelon hid the cannon. Q dropped the fruit, restored the
  tool, and retained the idle gauge state.

Raw state snapshots are in `qa/dial-input.json` and `qa/transitions.json`.
Matching comparison captures were then made in a fresh world so the firing
test's displaced fruit do not contaminate the before/after orchard views.

## Final validation

- `startup-check.mjs`: passed; cannon height 30.1% against the existing 32%
  cap, right edge 86.8%, nearest vertex 0.345 m. Other tools and supported
  aspect-ratio checks passed.
- `carry-check.mjs`: passed all class, tool-hiding, inflation, oversized-fruit
  refusal/shove and highlighting checks. Ordinary watermelon measured 29%
  visible frame height; its target remains 29.7%.
- `run-tests.mjs tools carry`: 2/2 scenarios, 78 checks passed (carry 41,
  tools 37), including cannon fruit impulse, recoil and self-launch.
- `npm run build`: passed TypeScript and Vite production build. The existing
  large-bundle warning remains.
- `git diff --check`: passed.
- The review page loaded all images at desktop 1280 px and mobile 390 px,
  had no horizontal overflow, and responded to keyboard slider input.
- The independent offline audit verified the inward bore normals, gauge
  endpoint clamping, geometry disposal, and unchanged other tool/fruit meshes.
  Full evidence is in `capture/harvest-hero/qa/offline-audit.md`.

Raw logs and state snapshots are retained in `capture/harvest-hero/qa/`.

## Cost and limits

The cannon changes from 4,260 triangles in one mesh to 6,760 across two meshes
(including gloves). The animated needle adds one draw call while equipped.
The watermelon changes from 680 to 1,736 triangles in its existing batch.
The matched ultrawide watermelon-carry frame changes from 797,596 to 819,772
rendered triangles (+22,176, about 2.8%); draw calls stay 113 and textures 16.
These counts include shadow rendering. They are scene-cost evidence, not a
before/after frame-rate benchmark.

The prior whole-suite vinebomb travel-distance failure remains unresolved;
the earlier fresh progression-only run passed. This asset pass does not claim
that failure fixed, or revalidate host migration/internet multiplayer. Broad
plain slopes, repeated trees outside the orchard proof and distant legendary
equipment remain future environment work.
