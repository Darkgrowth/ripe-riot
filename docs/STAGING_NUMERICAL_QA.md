# Isolated numerical validation

Run harnesses from `J:\RIPE-RIOT-staging\sunpatch-alive` against the built preview on port 5193. Port 5188 belongs to the user's live play session and the staging driver rejects it. Do not rebuild `dist` during a run. Test pages are separate headless Chromium pages; they do not attach to the user's browser.

```powershell
$env:RIPE_URL='http://127.0.0.1:5193'
$env:RIPE_HARDWARE='0'
node tools/harness/island-multiplayer.mjs
node tools/harness/run-tests.mjs
node tools/harness/multiplayer.mjs
node tools/harness/migration.mjs
```

The numerical scenario, multiplayer, migration and rope probe harnesses explicitly pass `drawFrames:false`. The driver suppresses only `game.renderer.render` after boot. Real requestAnimationFrame scheduling, fixed steps, physics, camera, frameUpdate, UI, event handling and networking continue. Second clients inherit the setting. The startup scenario explicitly draws the current frame before each of its three pixel assertions. Visual, audio and capture harnesses retain normal rendering by default.

These results demonstrate numerical gameplay and transport behavior. They are **not visual acceptance or frame-rate/performance evidence**. Rendering suppression avoids unnecessary software rasterization while the user plays.

Legacy isolated physics fixtures explicitly disable automatic director and gull activity. The island event scenario enables the systems it exercises. Island multiplayer keeps both available and resets/enables each fixture deliberately. Runtime defaults are unchanged.

`island-multiplayer.mjs` exercises twelve phase fixtures using actual BroadcastChannel snapshots, client requests and clean host disconnection: client-only first harvest/gather, windfall and coconut warning/active/result, rush-order progress/paid result, gull before/after peck, and remote blast reaction. It checks target IDs, cursor/latches, actual body reconstruction, node sequence, no duplicate money/release, a real client pickup/sale, duplicate intents/sales, and rejection of forged sale-event packets. Its JSON report is `capture/alive/qa/island-multiplayer.json`.

Use `node tools/harness/island-multiplayer.mjs --remote-blast-only` to check only the accepted/rejected remote blast reaction and scared-state migration. This targeted run writes `capture/alive/qa/island-remote-blast.json`, preserving the main transport report.

## Completed validation, 2026-09-20

- Island transport: 202/202 checks across the original eleven fixtures, including accepted client pickup, rejected forged sales, actual client sale and every director/gull migration boundary. Report: `capture/alive/qa/island-multiplayer.json`; raw log: `capture/staging-qa/island-multiplayer-preview.log`.
- Legacy multiplayer: 127/127. Raw log: `capture/staging-qa/legacy-multiplayer-preview.log`.
- Final behavior build `index-BwVxCU4B.js`: 11/11 gameplay scenarios, 378 reported checks; 163/163 migration checks across three loose-fruit passes plus the legendary; 14/14 targeted remote-blast checks. Raw logs: `capture/staging-qa/final-gameplay.log`, `final-migration.log`, and `final-remote-blast.log`. Blast report: `capture/alive/qa/island-remote-blast.json`.
- Final geometry build `index-WKB43PD8.js`: 4/4 continuous anchor supports, 64/64 side rays, all 97 scene geometries finite, and successful ordinary rope capture/pin/release. Report: `capture/area-design/qa/worksites.json`; raw log: `capture/staging-qa/final-worksites.log`. Known software ReadPixels stall warnings were retained; no console errors occurred.
- Final geometry approach walks: 3/3 passed using ordinary capsule movement/input. Remaining distance to the authored destinations: shop service lane 0.119 m, Hill Farm shelter 0.265 m, Palm Beach shelter 0.007 m. Report: `capture/alive/qa/worksite-routes.json`; raw log: `capture/staging-qa/final-worksite-routes.log`.

The final geometry-only build changed decorative crates and matching placements, so the affected support/approach checks were repeated without rerunning unaffected transport/gameplay suites. The first full-suite attempts exposed test isolation/timing defects: the island fixture's granted net leaked into the purchase scenario, and an immediate debug-look read raced the next frame's pitch clamp. Initial tool inventory is now restored between scenarios; the clamp assertions wait one real frame. The subsequent complete gameplay run passed. Earlier failed logs are retained in `capture/staging-qa`.

## Normal-input follow-up

The first recording exposed a genuine same-press interaction bug: Interaction sold the basket before Shop tested whether it was empty, so that same E press also opened the shop. Shop now respects the selected sell action. The harvest scenario now drives the actual input edge for selling and verifies both that the shop stays closed and that a separate press opens it. Targeted harvest: 28/28, `capture/staging-qa/final-sale-input.log`. This adds two checks beyond the previous full-suite checkpoint; do not rewrite that historical 378-check result as a new full run.

Final build `index-CuK91byB.js` includes this fix and spatial crate-impact audio. Eight crate-contact checks and existing audio graph checks passed; TypeScript and production build passed. Build log: `capture/staging-qa/final-build.log`. These changes do not change terrain, routes, fruit authority or migration logic.
