# RIPE RIOT — Testing

The rule this project runs on: **do not declare something done because the
source looks reasonable.** Every system below was verified by running the game,
and most of the real bugs so far were found by tests rather than by reading.

## Commands

```bash
npm run dev                          # play it
npm run typecheck                    # tsc --noEmit
node tools/harness/smoke.mjs         # boots? renders? no errors? (~30 s)
node tools/harness/geo-check.mjs     # every procedural mesh: NaN, attrs, tris
node tools/harness/run-tests.mjs     # all gameplay scenarios (~4 min)
node tools/harness/run-tests.mjs ropes legendary    # by name
node tools/harness/multiplayer.mjs   # two real clients over a real transport
node tools/harness/tour.mjs          # one contact sheet of every landmark
node tools/harness/shadow-check.mjs  # A/B the frame with shadows on and off
node tools/harness/perf-check.mjs    # attribute draw calls between passes
```

`RIPE_VERBOSE=1` prints passing checks too.

## How it works

`tools/harness/driver.mjs` starts Vite (or reuses a running server), opens the
game in Chromium, and talks to `window.__RIPE`. Scenarios drive the game through
**synthetic input** and **debug actions**, and assert on **numbers**.

Chromium notes, all measured:
- Do not force ANGLE backends. `--use-angle=swiftshader` is ~50× slower and
  `gl-egl` renders black. Chromium's own default works.
- Never use `page.screenshot()`: the game never stops animating so Playwright's
  stability wait never settles. Capture the canvas directly.
- Use `127.0.0.1`, not `localhost` — Node's fetch tries `::1` first on Windows
  and stalls for seconds against an IPv4-bound Vite.

## Judging visuals without looking at hundreds of images

Images are the most expensive thing you can put in a review, and they never
leave the context they enter. So:

1. **Triage with numbers.** `Renderer.frameStats()` reduces a frame to mean
   luminance, flat fraction, contrast, hue spread, black/blown fractions and a
   histogram. `sheet.mjs:verdict()` turns those into BLACK SCREEN / FEATURELESS /
   NO CONTRAST / MONOCHROME / ok. This caught the `gl-egl` black-frame case
   without anyone opening a file.
2. **One contact sheet, not N frames.** `tour.mjs` frames nine landmarks and
   emits a single labelled sheet with each frame's stats in the caption.
3. **A/B rather than squint.** "Are shadows working?" was answered by rendering
   the same frame with `sun.castShadow` on and off and comparing the histogram —
   they were working, just washed out by ambient fill.
4. **Probe, don't peer.** `probeLook()` raycasts from the eye and reports what
   is there. `fruit.body()` reports whether a body exists, is asleep, its mass
   and its collision groups. Most "what IS that" questions are cheaper to
   answer numerically.

## Scenarios

| Scenario | Covers |
|---|---|
| `movement` | walk/sprint/crouch speeds, jump apex, short-hop, slope climbing, nine-point "never inside the terrain" sweep, long-fall ragdoll and recovery |
| `harvest-loop` | the whole game: target an apple, pick it, auto-stow, fill the basket, walk to the pad, sell, and auto-delivery of fruit landed on the pad |
| `fruit-physics` | drop damage thresholds by species, watermelon bursting, coconut knockdown and automatic recovery, an apple *not* knocking you down, oranges rolling |
| `ropes` | a rope actually holds a load at its length, reports correct tension, winches in, pays out, and snaps past its rating |
| `tools` | shaker drops fruit, net catches mid-air and awards the stunt, ground nets, rope gun restrains, air cannon launches fruit and shoves the player, self-launch |
| `progression` | discovery, records, rare variants, shop purchase and tier gating, Puff Melon inflation and drift, Vinebomb launch |
| `legendary-king-melon` | four vines hold it still, gating on the rope gun, tethering, each cut, the 20 m drop, recovery to the pad, payout, and resetting for another attempt |

Current status: **7/7 scenarios, 158 checks** plus **11/11 multiplayer checks**.
Typecheck and production build are clean.

## Writing a scenario

Put a file in `tools/harness/scenarios/`, export `name` and
`run(g, t)`. `g` is the driver plus helpers (`standAt`, `faceTo`, `hold`,
`input`, `call`, `terrainHeight`); `t` has `ok/eq/near/gt/lt/between/note`.

Two traps worth knowing, both of which produced confidently wrong results here:

**Sample at the right moment.** Ground friction is ~13/s and a harness
round-trip is not instant, so reading the player's velocity *after* releasing
the input always returns zero. The air-cannon recoil test looked like a
completely broken tool until it started asserting on the value the tool records
at the instant of the impulse. The same trap made the Vinebomb launch look weak
until it asserted on peak speed since detach rather than current speed. Where a
quantity is transient, record it in the game and assert on the record.

**Scenarios share one game.** The runner fully resets player state, ragdoll,
carried fruit, loose fruit, basket, economy, camera and wind between runs. It
did not at first, and one test leaving the player mid-fall silently corrupted
three others.

## Bugs this harness found that reading would not have

- Rapier's rope joint does not constrain: a 2.6 t melon fell through three of
  them; a tethered player walked 9 m against a 2.5 m rope.
- `intersectionsWithShape` returned only the terrain when centred on an awake
  dynamic collider a raycast had just hit — every explosion was a no-op.
- `setDensity(~0)` + `setAdditionalMass` leaves a near-zero inertia tensor; the
  ragdoll diverged to 1.7e6 m and the King Melon's vines could not hold it.
- The short-hop gravity cut applied to *any* upward velocity, halving every
  air-cannon launch.
- Ropes holding `RigidBody` references across removal called into freed WASM
  memory and poisoned all later physics calls.
- A ragdoll helper aliased the caller's scratch vector and launched the player
  at their own world coordinates.
- The seabed culling threshold clipped the waterfall basin floor, leaving a hole
  in the collider that swallowed the player at exactly one spot on the island.
- `NaN` in banana-leaf geometry from `Math.pow(-1e-17, 2.1)`.
- `undefined !== false` rejected every non-utility tool in `assignSlot`.

## Not yet automated

- Frame-rate on real GPU hardware (the harness runs under SwiftShader; its
  timings are useful for relative CPU cost only)
- Audio output (synthesis is exercised, the waveform is not asserted)
- Save/load round-trip through a page reload
- Network loss, latency and host migration
- Long-session memory growth
