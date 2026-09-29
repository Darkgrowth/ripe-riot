# Sunpatch: bait, openings and the first upgrade — 2026-09-29

Continues `64951d5` on `codex/sunpatch-finish`. The intent is a stronger
fight → physical prize → sale → useful tool loop, with fruit also serving as
a combat distraction. The existing island, voxel assets and finale stay in place.

## Delivered behavior

- An actual held-fruit throw can draw Snapjaw's bite. The host follows a short,
  bounded flight, checks height and solid obstruction, and accepts each throw
  once. Drops and arbitrary network coordinates cannot trigger it. Snapjaw
  tracks that same fruit during its warning, then commits its attack; repeated
  fruit cannot indefinitely restart the warning.
- Successful bait earns **SMART BAIT**, adding 0.5 to that fruit's sale
  multiplier once. The fruit remains recoverable. There is no cash payout until
  sale. Current-host confirmations drive client feedback, and silent earned-ID
  snapshots preserve value and duplicate protection across host migration.
- Nearby visible Mimic, Snapjaw and Spitter encounters give a compact, phase-aware
  cue: danger, distraction or actual attack opening. The cue hides behind solid
  obstruction, when looking away, and during menus or incapacitation. Baited
  Snapjaw's warning ring uses gold.
- The first Mimic victory offers an optional return to sell its prize and try
  the $110 Air Cannon. The primary Snapjaw objective remains. Guidance checks
  current money, ownership and progress; live co-op clients get it too, while
  joining an already-cleared session does not replay it. Purchase hints now
  teach LMB hold/release and RMB self-launch after the equipped toast.
- Shop gates display actual remaining discovery points. Automatic rush orders
  start only when an available player is near the orchard or dock.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Offline regressions | 219/219 | [Raw log](checks/offline.log) |
| Production scenarios | 20/20 | [Raw log](checks/scenarios.log) |
| Host/client combat and revival | 10/10 | [Raw log](checks/co-op.log) |
| TypeScript and production build | Passed | [Raw log](checks/build.log) |
| Ordinary-input opening and upgrade | 12/12 beats; no browser errors | [Report](normal-input/report.json), [video](normal-input/normal-loop.webm) |
| Ultrawide combat cue fixtures | 6/6 views, 3440×1440; no browser errors | [Report](cues/report.json) |
| Physical bait and co-op host migration | 19/19 checks | [Report](../smart-bait/report.json), [scope](../smart-bait/README.md) |
| Independent review | Both findings repaired and reviewed | Client guidance parity; bait value on host migration |

The 1720×720 opening run used only keyboard/mouse actions, with game-state reads
for navigation. It walked from the dock, took and survived a Mimic hit, defeated
it with the starter mallet, carried its physical watermelon to the actual sell
pad, sold with E, opened the shed with E, purchased and fired the Air Cannon.
It finished at 72 health and $75 after the $110 purchase. No teleport, synthetic
input, debug damage or fixture purchase was used in this run.

The final network correction preserves an in-progress throw when the peer list
changes without changing the host. Its regression was reproduced before the fix;
the full offline suite, production build and affected multiplayer runtime checks
were rerun afterward. The unchanged solo scenarios, opening recording and cue
images were captured just before that final network-only correction.

The combat cue images use fixed camera/phase fixtures. Their obstruction check
injects a raycast result to verify UI hiding; it is not a world-collision
playthrough. Bait runtime evidence is recorded separately in
[smart-bait](../smart-bait/). Automated passes establish behavior, not a human
verdict that the whole island is fun. This is a completed gameplay polish pass,
not completion of the entire multi-island game. The existing build chunk warning
remains.

## Inspected views

- [Gold bait warning](cues/02-baited.png) and [open-jaw strike cue](cues/03-opening.png).
- [Mimic defeated during the ordinary-input run](normal-input/05-mimic-defeated.png).
- [Affordable first upgrade and discovery gates](normal-input/09-supply-shed.png).
- [Cannon equipped and control hint](normal-input/10-cannon-in-use.png).

## Reproduce

Use an isolated worktree/port and browser profile. Do not attach to a live game.

```powershell
npm run build -- --outDir capture/sunpatch-playful-build
node node_modules/vite/bin/vite.js preview --outDir capture/sunpatch-playful-build --host 127.0.0.1 --port 5243 --strictPort
$env:RIPE_URL='http://127.0.0.1:5243'
$env:RIPE_HARDWARE='1'
node --test --test-concurrency=4 tools/harness/*.test.mjs
npm test
node tools/harness/action-coop.mjs
node tools/harness/encounter-cue-review.mjs
node tools/harness/smart-bait-runtime.mjs
node tools/harness/voxel-clearing-loop.mjs --width 1720 --height 720 --seconds 300 --video --buy-cannon --out capture/sunpatch-playful/normal-loop
```
