# Sunpatch workplaces and ravine supports

Continuation of the first-area visual pass, 20 September 2026.

The island now has three distinct destinations along its harvesting loop:

- **Hill Farm:** a teal-and-cream sorting shelter with open trays, a slatted
  bench, rope coil and barrel. Its open side faces the approach. Timber feet
  follow the terrain rather than changing the hill or its route.
- **Palm Beach:** a coral-and-cream shade, resting bench and drying net rack.
  The narrow shoreline remains open in front of it.
- **King Melon ravine:** a preparation board and rope supplies before the
  descent. Four continuous faceted crags meet the existing vine endpoints.
  The previous shrinking boulder stacks stopped well below those endpoints.

The crags use identical indexed geometry for rendering and static trimesh
collision. Melon position, radius, mass, anchors, vines, extraction pad and
encounter rules are unchanged. Other solid props have matching simple
colliders; small decorative details join the existing merged prop batch.
Three sign faces are separate meshes. Vegetation is removed only within
worksite footprints, after sampling, so other seeded dressing stays in place.

Worker gloves now have chamfered silhouettes, leather panels, stitching and
rolled cuffs. Tool geometry, carry anchors, animation transforms and camera
framing are preserved.

## Visual review

Open `capture/area-design/review.html` through the dev server. The six matched
1280×720 views use the normal player camera. Additional close views cover the
hill shelter, beach shade and ravine preparation board. The before/after
environment captures both contain the new gloves; use the previous
`capture/route/polish-after` captures as the glove reference.

Regenerate the viewer with `node tools/harness/area-review.mjs`. The optional
`--sheet` flag launches Chromium to make a contact sheet. Do not run visual
capture browsers alongside the gameplay harness on this machine.

## Verification

Raw results are written to `capture/area-design/qa/`. The worksite harness
checks the four caps and 64 side rays against their actual support colliders,
finite geometry attributes, and a normal rope-gun shot at the melon followed
by a secondary-button pin into a crag. It uses debug positioning to reach the
test site, not a debug-created tether.

- Final TypeScript/production build passed (existing Vite large-chunk warning).
- Startup and carry-camera harnesses passed, including multiple aspect ratios
  and all carried-fruit classes. Carry contact sheet visually inspected.
- Local two-client multiplayer passed **127/127**, with no client console
  errors. Internet play and host migration were not revalidated.
- All four support caps and 64 side rays hit the expected crag collider.
  Ordinary rope-gun fire and secondary-button pin produced one legendary
  tether attached to a crag, with no rope left in the player's hands.
- 85 unique world geometries had finite attributes. The arrival frame measured
  114 draw calls and 787,478 rendered triangles, including shadows, versus
  111 and 778,228 at the end of the previous pass: +3 calls and about +1.2%.
  Hardware FPS was not benchmarked.
- The full gameplay run passed 9/10 scenarios, including the legendary
  encounter. Its progression scenario failed the vinebomb travel-distance
  check (0.54 m versus >10 m), despite a successful 16.18 m/s launch. A fresh
  progression-only run passed. This sequence-specific failure remains
  unresolved; do not report the full suite as green. Preserve both raw logs.
  The full run preceded the final hill-shelter relocation; the worksite and
  camera checks use the relocated version.
- Final keyboard check carried a 22 kg watermelon 15.4 m along the hill path
  past the previous obstructed shoulder. A separate shoreline walk passed the
  beach shade by 5.2 m. Both finished grounded with no runtime errors. Debug
  positioning and fruit spawning were used to set up these short checks.
- Six matching final player-camera views and three close views were captured.
  Shelter tree clearance, ground contact, sign supports and fabric seams were
  visually inspected. A final decorative brace rotation was corrected after
  the automated runs; it adds no collision and the final build passed.
- The comparison viewer loaded its images and slider correctly at 1280 px and
  390 px, with no horizontal overflow.

This is an authored visual continuation of Sunpatch, not a claim that the
entire first chapter has reached final art. The cave grove remains unchanged.
