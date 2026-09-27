# Voxel route performance baseline

These are **before** measurements for the opt-in `?voxelPilot=1` art pass, paired
against the same game with the baseline art mode. They used an isolated Vite
server and headless full Chromium on ANGLE/NVIDIA GeForce RTX 4070 Ti/D3D11.
They did not touch the user's active game window. Both modes used DPR 1,
antialiasing, a 2048×2048 soft sun shadow map, and the same viewport per pair.

## Reproduce

From this checkout, start an otherwise idle isolated server:

```powershell
npm run dev -- --host 127.0.0.1 --port 5218 --strictPort
```

Then, in a second shell:

```powershell
$env:RIPE_URL='http://127.0.0.1:5218'
node tools/harness/voxel-performance.mjs --seconds 8 --warmup-seconds 30 --out docs/evidence/voxel-performance-pass/before
node tools/harness/voxel-performance.mjs --width 1920 --height 1080 --seconds 5 --warmup-seconds 30 --out docs/evidence/voxel-performance-pass/before-1080
node tools/harness/voxel-performance.mjs --width 1920 --height 1080 --seconds 5 --warmup-seconds 30 --gpu-timer --out docs/evidence/voxel-performance-pass/before-gpu-1080
```

The first command uses the default 1280×720 viewport. Each JSON report records
the source commit, browser version, ANGLE renderer, WebGL settings, exact route,
percentile summaries and sample counts, encounter events, errors, and scene
geometry inventory weighted by instance count. Per-frame raw arrays are omitted
from committed reports; add `--raw` (or set `RIPE_PERF_RAW=1`) to retain them in
a local diagnostic run. The scene inventory includes off-screen meshes; only
the renderer counters represent submitted draw calls/triangles.

At measurement time the checkout was based on `e60728c` with uncommitted
ground-contact changes in `PlayerRig.ts`, `PlayerRagdoll.ts`, and
`MultiplayerAuthority.ts`. Those changes were in place before all three clean
runs; their tracked `src/` diff SHA-256 was
`7e1eda456eed8eed557372af86b0634c29247121869a8226fa385a2835303720`.
Future before/after comparisons should hold that source state fixed apart
from the optimization being measured.

## What was measured

The route moves a detached gameplay camera along the same dock-to-orchard
coordinates in both modes. It is a **scripted camera motion**, not a
normal-input route. The encounter phase teleports the player to the Mimic's
trigger area and lets the active fight run; both modes recorded Mimic attacks.
The co-op phase adds a second worker in a small same-origin browser tab, which
continues rendering while the host tab is measured. The host tab is foreground
within headless Chromium. The worker screenshots are in each report folder.

| 1280×720 phase | Baseline p95 rAF | Voxel p95 rAF | Baseline triangles | Voxel triangles |
| --- | ---: | ---: | ---: | ---: |
| Dock | 5.6 ms | 5.7 ms | 937,604 | 2,358,308 |
| Scripted route | 5.7 ms | 5.7 ms | 931,940 | 2,346,186 |
| Orchard, shadows on | 5.7 ms | 5.7 ms | 931,580 | 2,544,562 |
| Orchard, shadows off | 5.7 ms | 5.7 ms | 557,906 | 1,622,297 |

The 1920×1080 rAF p95 was also about 5.7 ms for both modes. This is a browser
pacing floor, so it does not show how much GPU margin remains. `Game.profile`
is CPU time, including render submission, not GPU time.

The separate 1080p GPU timer-query pass measured the full renderer call
(world and viewmodel). `EXT_disjoint_timer_query_webgl2` returned about 300
samples per phase and zero disjoint samples:

| 1920×1080 phase | Baseline GPU p50 / p95 | Voxel GPU p50 / p95 |
| --- | ---: | ---: |
| Dock | 3.59 / 4.08 ms | 3.72 / 4.18 ms |
| Scripted route | 3.68 / 4.11 ms | 3.68 / 4.19 ms |
| Orchard, shadows on | 3.64 / 4.14 ms | 3.76 / 4.24 ms |
| Orchard, shadows off | 2.74 / 3.35 ms | 3.36 / 3.84 ms |

At the matched orchard view, disabling shadows removed **373,674 triangles
and 115 draw calls** in baseline, versus **922,265 triangles and 103 draw
calls** in voxel mode. The voxel shadow pass therefore submits 548,591 more
triangles. The largest unculled voxel scene geometry contributors were the
first voxel apple-tree harvest batch (141,700 triangles), merged props
(105,228), far apple fruit (102,416), voxel bushes (87,048), near apple fruit
(81,488), far coconuts (68,160), and voxel grass (68,136). Far fruit and small
foliage do not cast shadows in this inventory. These counts are weighted for
instancing but include geometry outside the camera view.

The timer-query result is specific to
this GPU, resolution, browser, and brief matched views; it does not establish
sustained frame rate on other hardware. The timer-query two-worker voxel sample
was anomalous (100 samples and a 16.8 ms rAF p95), so it is **inconclusive**.
In the non-query two-worker phase, both modes had 5.6–5.7 ms p95 paced frames
at 720p and 1080p. Repeat a longer GPU query if co-op GPU cost becomes a
decision point.
