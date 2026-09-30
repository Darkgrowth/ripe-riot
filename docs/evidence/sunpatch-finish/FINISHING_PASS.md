# Sunpatch finishing pass — 2026-09-30

This pass responds to the recorded first-person review in **Analyze Fishing Game**. It preserves the existing Sunpatch expedition and selectively improves the mallet presentation, King Vine camera clearance, and the final HUD sequence.

## Changes

- Rebuilt the voxel mallet's first-person gloves and sleeves around the existing shaft and swing. The baseline authored grip and attack timing are unchanged.
- Added a solid King Vine trunk boundary; after subdual it becomes a low remnant. The active sweep paddle fades when it nears the camera, and its subdued pose folds promptly. The telegraph ring stays visible.
- Limited toast stacking to two. Side-event cards yield to the active King Vine and legendary extraction, while an urgent rush-order timer remains visible. Side events stop during the return-to-dock chapter beat, then resume after settlement; opening the host's local menu cannot cancel another player's event. The extraction banner names the King Melon delivery without presenting the dock settlement as already finished.

## Verification

- `npm run build`: passed. Vite reported its existing large-chunk warning.
- `node --test` on all `tools/harness/*.test.mjs`: 296/296 passed after the multiplayer event fix.
- `npm test` against isolated port 5266: 20/20 gameplay scenarios passed after the multiplayer event fix.
- `node tools/harness/island-multiplayer.mjs` against the same isolated server: 215/215 two-client checks and 12/12 phase fixtures passed after the multiplayer event fix.
- Ordinary-input headless expedition at 1712 × 634 (same aspect as the 3424 × 1268 reference clip): all 26 route beats passed, with no script failure or browser errors. It used title/menu input, walking, aiming, interaction, combat, purchase, physical melon movement, dock settlement, and reload. This run preceded the final shared-event scheduling fix, which was verified by the later tests above. The 281-second scripted route is **not** a human pacing estimate.
- Authored hardware captures at 3424 × 1268: [manifest](finishing-pass/manifest.json) and route frames, including mallet ready/windup/contact/recovery. Selected full expedition frames and the machine-readable [report](expedition-final/report.json) are in `expedition-final/`.

## Visual review

At the recorded ultrawide aspect, the revised mallet grips sit on the shaft without the oversized block palms seen in the original clip. The King Vine remains readable in the [arena](expedition-final/14-king-vine-arena.png) and [subdued](expedition-final/15-king-vine-subdued.png) views; its long paddle no longer covers the whole view at subdual. [Extraction](expedition-final/18-king-melon-extracted.png) clearly precedes [return to dock](expedition-final/19-return-to-dock.png), followed by the [settlement results](expedition-final/20-expedition-results.png) with no side-event card in those captures.

The game still has mixed voxel and older low-poly scenery, sparse stretches, and uneven terrain presentation visible in the route captures. This pass does not establish art approval, human first-session comprehension, 20–30 minute pacing, audio quality, or physical-device performance. Those require the separate playtest and visual work described in `docs/SUNPATCH_PLAYTEST_KIT.md`.
