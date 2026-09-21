# Sunpatch visual polish — 20 September 2026

The dock → Merv's Supply → Old Orchard route keeps the existing low-poly
direction, terrain, spawn, gameplay, fruit attachments and progression.
Geometry is authored in TypeScript; no generated mesh assets or Blender scene
replacement is involved.

## Changes

- Dock: staggered board joints, nail heads, sparse grain and a rectangular
  vegetation exclusion covering the full deck.
- Shop: terracotta courses, teal counter boards/shutters, weighing scale,
  orange medallion, and correctly positioned harvest cart with visible wheels.
- Orchard: wide entrance lintel, painted sign, bunting, flower colonies,
  varied canopy masses/branches and a grounded barrow wheel.
- Water: crossing lagoon ripples, thin shore arcs, corrected wave axes and
  waterfall geometry that follows the exposed bank into the pool.
- Hillsides: decorative companion rocks sample their actual world positions.

## Review inventory

| Claim | Check |
|---|---|
| Arrival is readable; dock is clear | Matched spawn/dock captures; walk off deck |
| Shop keeps its usable counter and pad | Matched shop and close-up captures; pick/carry/sell/open shop |
| Orchard stays traversable and harvestable | Matched orchard capture; walk through entrance; normal fruit pickup |
| Waterfall reaches the pool | Matched lagoon capture plus side-view inspection |
| King Melon stays visible | Matching ravine view; existing legendary scenario |
| No invalid geometry or gameplay regression | Geometry audit, startup, gameplay suite, multiplayer, build |
| Review artifact works | Switch views and comparison slider; 1280px and 390px layouts |

Exploratory cases: walk around the outside of the orchard entrance; inspect
the fall obliquely from both banks. Also inspect the shop counter at arm's
length and return to the dock after carrying fruit.

## Reproduce the review

Start Vite on the desired port and set `RIPE_URL` for the harness. Capture a
baseline before editing, then the final state with the same route cameras:

```powershell
$env:RIPE_URL='http://127.0.0.1:5188'
node tools/harness/route.mjs --tag polish-before
node tools/harness/route.mjs --tag polish-after
node tools/harness/polish-review.mjs
```

The local viewer is `capture/polish-qa/review.html`; the static comparison is
`capture/polish-qa/comparison.png`. Raw logs are in `capture/polish-qa/`.
The capture directory is intentionally ignored by Git. Preserve the baseline
captures when reviewing this pass rather than overwriting them with the new art.

All six apple/orange tree variants retain identical attachment coordinates,
collider descriptors and height contracts, checked before/after by the tree
author. New landmark decorations add no colliders. Game-camera screenshots
are the visual evidence; triangle counts alone are not an acceptance test.

## Results

- TypeScript and production build pass (existing Vite large-chunk warning).
- Gameplay: **10/10 scenarios, 322 checks**. After this run, two final
  noncolliding roof/waterfall alignment adjustments were made; final build,
  geometry, startup, multiplayer and visual checks cover those adjustments.
- Local two-client multiplayer: **127/127**, no client console errors.
- Startup and geometry harnesses pass. Additional full-scene inspection found
  no nonfinite attributes in 82 unique geometries; all 378 waterfall vertices
  above water remain outside the terrain (minimum clearance about 0.85 m).
- Six matched 1280×720 gameplay views and three close-ups inspected, plus the
  waterfall from both banks. Comparison viewer checked at 1280px and 390px.
- Keyboard/mouse: walk off dock and through entrance, pick/carry/sell an apple,
  open/close shop, then exploration of orchard shoulders, jump, crouch and look.
  Debug positioning was used between sites; this is not a full human playthrough.
- Arrival frame: **110 → 111 draws**, **745,706 → 778,228 rendered triangles**
  including shadow passes, about +4.4%. No new gameplay collision objects.

Hardware FPS, internet multiplayer, host migration and a complete fresh-save
King Melon playthrough were not revalidated in this visual pass. The existing
first-person hands and distant ravine art remain candidates for further polish.
