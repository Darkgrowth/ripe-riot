# SMART BAIT focused gameplay evidence

Runtime target: `http://127.0.0.1:5243`, isolated production output in `capture/sunpatch-playful-build`. Hardware Chromium runs headlessly with `RIPE_HARDWARE=1`; the original production preview and live player browser are untouched.

Reproduce from the worktree in PowerShell:

```powershell
$env:RIPE_URL='http://127.0.0.1:5243'
$env:RIPE_HARDWARE='1'
node tools/harness/smart-bait-runtime.mjs 2>&1 | Tee-Object -FilePath docs/evidence/smart-bait/runtime.log
```

The final run has 19/19 assertions and no page exceptions. Raw console output is in [runtime.log](runtime.log), measured state and clear-ray diagnostics in [report.json](report.json). Screenshots are [solo](solo-after-throw.png) and [client co-op](coop-client-after-throw.png).

## What the runtime proves

- A real mouse-held/released fruit throw creates exactly one bait event, turns the Snapjaw with the real fruit, and grants that retrievable fruit a 1.5 SMART BAIT multiplier.
- A second throw from the open east approach, followed by real W movement and a real mouse attack, reaches and damages the Snapjaw in its existing baited recovery window. The fruit survives. No recovery extension was needed.
- A real client mouse throw produces one host-authorized event and one client confirmation. The host scores the fruit; the client confirmation does not independently increase its scoring total.
- Disconnecting the host promotes the client with the earned SMART BAIT multiplier intact. A new accepted pickup and real mouse rethrow of that same fruit creates another opening but does not duplicate the fruit reward.

## Fixture setup and limits

Teleporting the player, resetting encounters, spawning an orange, and debug pickup establish focused repeatable fixtures. The migration check also repositions the existing fruit near the promoted player's hands before pickup. Those are fixture operations; all throws, the solo approach, and the solo counterattack use Playwright mouse/keyboard events with synthetic game input disabled. The harness never calls the debug throw or offerBait action. Host diagnostic wrappers only record the actual throw and raycast result, then return their original results.

This is not a full island walk. The normal southern walking line meets an existing low orchard fence around z=16; the measured blocked approach was resolved by using the open east route, with no geometry changes. The additional co-op teammate counterattack fixture was abandoned because positioning a teammate inside aggro range begins a separate normal attack before bait; the solo counterattack and network bait are separate verified claims.

The harness verifies the earned sale multiplier, not an actual sale payout. Occluded throws have blocked-callback unit coverage; there is no controlled real-wall LOS rejection test here. Clear-path raycasts in the successful co-op run use the real physics scene. It does not prove every throw angle or terrain interaction feels good.

## Focused source checks

`node --test tools/harness/bait-authority.test.mjs tools/harness/thrown-fruit-bait.test.mjs` passes 12/12. Coverage includes swept motion, TTL/speed/height/LOS gates, state-change disarming, once-per-flight behavior, warning tracking without timer extension, accepted remote release provenance, duplicate releases, legacy arbitrary-coordinate rejection, host cue validation/deduplication, and unchanged-versus-changed host authority. The last authority regression failed before moving candidate clearing after the actual role-change guard and passed afterward.

Reward snapshots mirror the earned once-per-fruit record after fruit reconciliation. Only the authoritative host earns the reward; clients silently mirror it for host migration. The network cue is presentation only.
