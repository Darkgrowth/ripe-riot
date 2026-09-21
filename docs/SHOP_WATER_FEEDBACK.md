# Shop, rails, water and gull feedback

This follow-up is built separately in `dist-feedback` and served on port 5194. The user's running production preview on 5193 and original project on 5188 were not navigated, reloaded or rebuilt.

## Changes

- Removed the full-width porch boards beneath the sell pad. Their top faces were exactly coplanar with the pad base (local y=.10), causing competing surfaces visible through plank seams. Side walkways now have their own matching collision. Painted border corners use butt joints instead of overlapping top faces. This fixes a confirmed overlap, not a claim that every reported hardware flicker is resolved.
- All 46 orchard rails now have oriented cuboid collision matching their visible timber. Existing gate opening remains open.
- Removed thresholded repeating bright wave crests and depth-contour arcs from the ocean. Soft irregular ripples and shoreline foam remain. Matching screenshots show the road-dash appearance removed.
- Gull watches players, hops, preens and occasionally takes a short inspection lap. It retreats from nearby players and still nudges eligible unattended loose apples/oranges. Existing ownership exclusions, host authority, pickup priority and 45-second interference cooldown remain. This is a more visible resident, not proof that its existing one-peck interaction is a strong comedy feature.
- Refined decorative fruit and sack silhouettes around close-up work areas; added tied sack mouths. This is a limited asset pass, not a completed island-wide art redesign.

## Evidence

- Typecheck and isolated production build passed: `index-B-Hoz8oZ.js`.
- Production browser: 92/92 rail rays from both sides of all 46 rails. No application/shader errors; software ReadPixels warnings only.
- Five actual capsule approaches passed: shop service lane, orchard main path, orchard gate, hill worksite, beach shelter.
- Character CPU checks: 25/25, including inspection lap migration, client inactivity, pickup priority and protected fruit exclusions.
- Inspected shop, water and gull pose screenshots in `capture/shop-water-feedback`. Before/after shop/water views use matching cameras; water time differs. Gull screenshots inspect poses, not an uninterrupted natural interaction.
- First shader compilation failure was corrected; its full report remains in `shader-first-failure.json`.

Pending: hardware confirmation at the user's exact flicker location, new gull behavior in a normal multiplayer session, full regression suites after these particular changes, and broader close-up art approval. Existing earlier regression results do not cover this build. Music was not changed in this follow-up.
