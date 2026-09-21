# Sunpatch orchard identity proof

This pass responds to the supplied ultrawide video review. It keeps the bright,
low-poly island and confines the tree experiment to four apple/orange trees
within 9 m of (-13, 13). It is a reviewed local proof, not final art for the
whole island. Existing workplace, dock, and shoreline work is documented in
`SUNPATCH_WORKSITES.md` and `SUNPATCH_VISUAL_POLISH.md`.

## Changes

- Pruned, flatter canopy layers expose more sky between trees. Fruiting spurs
  with small leaf blades connect to the existing fruit positions. A quieter
  leaf palette and local ground/foliage values separate the layers. Terrain
  height, vegetation placement, and the plant RNG stream are unchanged.
- Carry gloves have a cupped palm, bent fingers, opposing thumb and broader
  cuff. Grip placement changed; carry framing, true fruit dimensions, carry
  classification and gameplay physics did not.
- The hotbar and carry panel scale with viewport height and sit at bottom
  left, clear of the two-handed fruit. Interaction text scales too; the
  crosshair remains unchanged. Toasts sit above the control cluster. The
  dock welcome sign is smaller and quieter than the shop/readout boards.
- A 2.04 m rope reel with frame, winding and crank sits beside the King Melon
  staging board at (-1.5, -37.5). It uses the existing prop batch and palette,
  adds 1,628 triangles and 18 primitive colliders, and has no interaction or
  new mechanic. The initial location intersected an existing rock and was
  rejected during visual review.

## Reproduced bugs

The black picking polygons were reproduced during a real E-key apple pick.
They were thick Lambert-lit leaf shards: faces turned away from the sun went
almost black. Leaves now have a thin folded mesh and baked light/dark face
tones in a separate unlit instance batch. Impact chips retain their original
lighting/material. The shared particle pool still caps total particles at 480;
mixed chip/leaf effects require at most two draw calls.

SKY PICK checked absolute release elevation (`y > 21`), so normal hill fruit
qualified. It now checks release height above local terrain (or the sea),
strictly greater than 8 m. The +0.35 bonus, event path, award deduplication and
saved history are unchanged. A normal E-key pick of apple 263 at world y=23.46
on the hill became carried with no scoring record. An E-key tree shake at the
same elevation retained CHAIN REACTION but did not earn SKY PICK. Genuine high
release, water floor, exact boundary, deduplication and save compatibility are
covered by 13 offline scoring cases.

## Evidence and checks

The comparison page is `capture/identity-proof/review.html`, regenerated with
`node tools/harness/identity-review.mjs`. Before/after arrival, orchard,
look-up picking and carry views are full browser screenshots including DOM
HUD at 1920x1080 and 3434x1270. Cameras match; wind, particles and celebration
timing can differ. The late-particle baseline already includes the new glove,
so that specific pair is not evidence of the glove change.

Normal keyboard E/Q/W input was used for look-up picking and successive apple,
watermelon and deflated Puff pickup/release while walking. Debug positioning
and spawned fruit were used to set up the short transition test. All three
carried models excluded the equipped tool; release returned each fruit to
the world and restored the tool. Screen-height targets remained 22%, 29.7%
and 26.2%. The final detail stills use the same carry states with settled
framing; they are not recordings of movement smoothness. `qa/motion.json`
retains the input-test state snapshots.

A W-key walk beside the relocated reel moved 4.68 m, from (2,-33) to
(2.001,-37.68), finishing grounded at 5.4 m/s. The final review session recorded
no page errors. These checks do not constitute a full traversal audit.

`node tools/harness/visual-invariants.mjs` passed: all 12 normal/proof tree
shapes retain HEAD attachment points, colliders and heights; 240 seeded plants,
including batch growth, retain IDs, world/local nodes, transforms, collider
data and subsequent RNG state. FX mixing, expiry, reuse, overflow, disable and
disposal checks pass. `node tools/harness/sky-pick-check.mjs` passed 13 cases.

The final build passed (with the existing large-bundle warning). The gameplay
run passed all 3 scenarios and 102 checks: startup 35, carry 41, harvest 26.
Raw build and gameplay logs are in `capture/identity-proof/qa/`.

## Cost and limits

The matched settled 16:9 apple-carry frame changed from 106 draw calls /
787,122 rendered triangles to 111 / 794,582: +5 calls and +7,460 triangles
(about 0.95%). Counts include shadow work and vary with effects/culling.
The proof adds separate plant batches and one leaf material; textures remain
16. No trustworthy before/after FPS benchmark was recorded, so these are
scene-cost numbers rather than a frame-rate claim.

The prior whole-suite run's vinebomb travel-distance failure remains
unresolved (0.54 m despite a 16.18 m/s launch); a fresh progression-only run
passed. This pass does not claim that old failure was fixed or the entire
suite is green. Prior co-op/rope tests are recorded in the workplace delivery;
internet co-op and host migration were not revalidated here. The whole island
still has broad plain slopes, repeated tree forms outside the proof, and
limited distant legendary equipment detail. The original video alone did not
establish faults in net/cannon use, selling, co-op or legendary completion.

The review viewer was checked at 1280 px and 390 px: images loaded, native aspect ratios and keyboard slider controls worked, and neither size had horizontal overflow.
