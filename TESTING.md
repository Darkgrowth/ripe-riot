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
node tools/harness/feel.mjs          # numbers for how each interaction feels
node tools/harness/feel.mjs throw hit               # by section
node tools/harness/multiplayer.mjs   # two real clients over a real transport
node tools/harness/startup-check.mjs # what the player sees when they press play
node tools/harness/carry-check.mjs   # how much of the frame a carried fruit takes
node tools/harness/net-check.mjs     # the catch net's four phases, and the King Melon from the ravine
node tools/harness/hud-check.mjs     # the DOM overlay, which no canvas shot contains
node tools/harness/tour.mjs          # one contact sheet of every landmark
node tools/harness/route.mjs         # the six first-person views of the main route
node tools/harness/detail.mjs        # three close-range frames: deck, shop, fruit
node tools/harness/shadow-check.mjs  # A/B the frame with shadows on and off
node tools/harness/perf-check.mjs    # attribute draw calls between passes
```

`RIPE_VERBOSE=1` prints passing checks too.

## How it works

`tools/harness/driver.mjs` starts Vite (or reuses a running server), opens the
game in Chromium, and talks to `window.__RIPE`. Scenarios drive the game through
**synthetic input** and **debug actions**, and assert on **numbers**.

**Scenarios advance simulated time, never wall-clock time.** The runner holds
the game clock paused for the whole run, and every `wait(seconds)` forces
exactly `round(seconds * 60)` fixed steps (`__RIPE.simulate`), a few per
rendered frame so the camera, UI and viewmodel keep up. A check that says
"within 3.6 s" means 216 steps whether the harness renders at 320x180 or full
screen, on a fast machine or a busy one. Nothing moves between a scenario's
calls, so a `state()` read is exact. `idleFrames(n)` renders frames with no
step at all, which is how the input-latching check reproduces a 144 Hz display.

The visual harnesses (tour, route, startup-check) still use real time; they
only need the world to look settled. `multiplayer.mjs` also uses real time,
because it is testing an asynchronous transport between two pages.

Chromium notes, all measured:
- Do not force ANGLE backends. `--use-angle=swiftshader` is ~50× slower and
  `gl-egl` renders black. Chromium's own default works.
- Never use `page.screenshot()`: the game never stops animating so Playwright's
  stability wait never settles. Capture the canvas directly.
- Use `127.0.0.1`, not `localhost` — Node's fetch tries `::1` first on Windows
  and stalls for seconds against an IPv4-bound Vite.
- The driver reuses a dev server already on the port, and checks that it is
  *ours* before doing so. "Something answers on 5173" is a different question:
  another project's Vite took the port once, every stage reused it, and each one
  waited the full 90 s for a `__RIPE_READY` that was never coming. It now fails
  immediately with the reason. Set `RIPE_URL` to run against another port —
  start Vite there yourself, e.g.
  `npx vite --host 127.0.0.1 --port 5188 --strictPort`.

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
5. **Somewhere, read the actual canvas.** Every check above looks at the scene
   rather than at the frame, and a startup that was 92% flat clear-colour passed
   all of them: `frameStats` re-renders into its own target, `probeLook` asks
   the physics world, and every contact sheet detaches the camera first. So
   `startup-check.mjs` and the `startup` scenario classify the presented canvas
   by pixel — what fraction is the raw clear colour, what fraction is sky, where
   the horizon falls, how much of the frame the viewmodel occupies. Still
   numbers, but numbers taken from the thing the player is looking at.

## Reading feel as numbers

`run-tests.mjs` answers "does it work". `feel.mjs` answers "how does it feel",
which is a different question and needs a different instrument — it prints, it
never asserts, and you read it before and after a tuning change:

| Section | What it measures |
|---|---|
| `pick` | whether E and LMB land on the step the button goes down; whether grabbing loose fruit moves the hands or makes any sound at all |
| `carry` | how far a held fruit trails the hand point through a 60° turn, per species — the only readout of carried weight |
| `throw` | release speed by species, which is where mass has to be legible |
| `hit` | peak camera amplitude when fruit lands on the player, and whether it flattened them |
| `puff` | a Puff Melon's height second by second in still air |
| `rope` | tension, worst single-step yank, and how far you get sprinting off a leash |
| `cannon` | charge, blast power delivered to a fruit, and the shove it puts on you |
| `net` | press-to-arrival lead time against outcome for an apple falling through the hoop: the width of the swing's window, in seconds |
| `stunt` | what an ordinary pick-and-stow awards, which is how you catch reward spam |

The measurements are the argument. "Held fruit trails 0.030 m whatever it
weighs" and "an apple to the head produces 0.0000 of camera movement" are the
kind of statement that settles a design discussion in one line, and neither was
visible by reading the code that produced them.

## Scenarios

| Scenario | Covers |
|---|---|
| `startup` | the pose the game boots into: on the deck, facing the island, never pitched up; the shop and the King Melon on screen from frame one; the presented canvas is the world and not the clear colour; eye height, FOV, walk/sprint/jump/crouch on the dock; look accumulation and pitch clamps; a respawn out of a ragdoll 34 m up reproducing the opening frame exactly |
| `movement` | walk/sprint/crouch speeds, jump apex, short-hop, slope climbing, nine-point "never inside the terrain" sweep, long-fall ragdoll and recovery |
| `harvest-loop` | the whole game: target an apple, pick it, auto-stow, fill the basket, walk to the pad, sell, auto-delivery of fruit landed on the pad, picking on the left mouse button (and the release not throwing back what the press just picked), and a basket filled by hand earning no stunts |
| `fruit-physics` | drop damage thresholds by species, watermelon bursting, coconut knockdown and automatic recovery, the band under it where a low-branch coconut registers as a hit without flattening you, an apple *not* knocking you down, oranges rolling |
| `ropes` | a rope actually holds a load at its length, reports correct tension, winches in, pays out, and snaps past its rating |
| `tools` | shaker drops fruit; the net as a timed swing — a swing timed to the apple's arrival catches it and awards MID-AIR HARVEST, a swing made too early catches nothing and registers a miss, a press during recovery is not a swing, holding the button flails on the same clock; ground nets; rope gun restrains the player; air cannon launches fruit and shoves the player, self-launch |
| `progression` | discovery, records, rare variants, shop purchase and tier gating, Puff Melon inflation and drift, Vinebomb launch |
| `legendary-king-melon` | four vines hold it still, gating on the rope gun, tethering, each cut, the 20 m drop, recovery to the pad, payout, and resetting for another attempt |
| `carry` | the carry classification table; the local copy leaving the world batch when picked up and returning when dropped; the tool stowing itself while the hands are full; a Puff Melon inflating from medium to large in hand and then leaving by itself past 1.10 m; oversized fruit refused, shoved, and prompted for; the aim highlight lighting the right instance |

Current status: **9/9 scenarios, 256 checks** plus **60/60 multiplayer checks**.
Typecheck and production build are clean.

## The multiplayer suite tests authority, not connectivity

`multiplayer.mjs` used to prove that two pages could see each other. It now
proves who is allowed to be right, which is a different and much harder claim,
and the way it is written is the argument:

**Nothing in it calls an authority method.** Every action goes through the
entry point the game uses — `pickup` is `InteractionSystem.pickUp`, which is
what the E key calls; `interact` is the E key; `fruit.detach` is what the
shaker and the hand call. On a client all of those are supposed to turn into
intents, and if that gating ever comes off, these checks fail instead of
quietly passing on local mutation. A test that reached past the boundary would
pass just as happily with no boundary there.

What it establishes, in order: both peers know the same attached fruit by the
same id; a replica weighs and measures exactly what the host's copy does; a
client's detach request is decided by the host; a claim from 89 m away is
refused and the client's prediction is rolled back; a claim from arm's length
is booked out; a second player cannot take what is already claimed, in both
directions; a genuine simultaneous grab — both peers reaching in the same tick,
before either has seen a snapshot mentioning the other — leaves the fruit with
exactly one of them, and the one holding it is the one the host says holds it;
a client's sale pays the host's own valuation, once, credited once, banked
once, agreed by both peers, with the fruit gone on both and tombstoned; a
second request for the same fruit pays nothing; a client cannot sell what
somebody else is carrying; a peer that leaves while carrying has its fruit
spilled where it stood rather than orphaned; and rejoining duplicates neither
the money nor the fruit, with both peers holding the same set of loose fruit by
id.

Two of the three failures on the first run were the test measuring the wrong
thing. The third was real, and worth writing down: **the range check treated
every detach as hand reach.** Because the gate sits at the bottom of
`FruitSystem`, it catches tools as well as hands, and a 7 m limit would have
silently broken the shaker (11 m), the rope gun and the air cannon in
multiplayer while the hand kept working perfectly — which is exactly the sort
of thing that ships.

## The camera is a thing under test

Every scenario in the table above measures the WORLD. That is most of the game
and it is not all of it, and the gap is not academic: the worst bug found in the
project so far — carried fruit filling the screen, with the tool viewmodel drawn
on top of it — passed all 203 checks, because every one of them asked the
simulation what was true rather than asking the frame what was visible.

Two harnesses now ask the frame:

- `startup-check.mjs` — the pose the game boots into, and the framing of every
  tool at five aspect ratios.
- `carry-check.mjs` — the framing of every carry state. It projects the carry
  proxy's vertices through the real view camera and reports the fruit's screen
  height and where its top edge falls relative to the crosshair, then asserts
  those. It also samples the escaping Puff Melon's angular size in degrees of
  FOV, which is how "it leaves rather than loitering in front of the lens"
  becomes a number.
- `hud-check.mjs` — the DOM overlay. Every other capture in the harness reads
  the WebGL canvas directly, which is correct for the world and completely blind
  to the HUD: the carry readout, the prompt, the slots and the toasts are HTML
  and appeared in no screenshot the project had ever taken. This asserts on the
  overlay's markup and composites it onto the canvas so it can be looked at.

Both write a contact sheet, and neither needs anyone to open it unless the
numbers look wrong. Two things in this pass were only findable by looking:
the grip hands were behind the fruit rather than on it, and the escaping melon
parked itself in the frame. Both then got a number attached so they cannot come
back silently.

## The harness window size is a cost, not a calibration

`run-tests.mjs` renders at 320x180 because every forced step is still followed
by a frame, and software rendering is fill-rate bound; the size decides how
long the suite takes and nothing else. It used to be a calibration: with
wall-clock waits and a five-step cap, render size decided how much simulation
each check got, and an art pass that touched no gameplay code failed three
physics scenarios in ways that read exactly like regressions (a 34 m drop that
had not landed inside its 3.6 s, an uphill walk that covered 1.4 m instead of
3.5 m). That whole class of failure is gone with forced stepping. Keep 16:9 —
the startup scenario asserts on horizontal FOV.

`multiplayer.mjs` still runs in real time at 400x225, and its settle waits are
still frames-not-seconds; see the comments in it.

Two traps worth knowing, both found by the harness:

**Do not assert on one instantaneous read of a flickering flag.** `grounded` is
per-step, and a capsule walking a flat deck genuinely loses contact for the odd
step — sampled eight times across one walk it came back false once, at deck
height, mid-stride, at full speed. The check now samples the walk and asks that
the deck held for nearly all of it.

**Remote avatars damp toward the snapshot rather than snapping to it,** so the
multiplayer settle time is counted in frames, not seconds. At 900 ms the avatar
was already 1.3 m short of the teleport it was chasing — inside the 4 m
tolerance by luck rather than by margin.

**An assertion a broken feature cannot fail is not an assertion.** "The rope
restrains the player" was `walked < 26 m` after 2.6 s of walking, which is
about 14 m with no rope at all. It passed for two reasons at once: the player
is kinematic so the rope never pulled them, and the bound was wide enough not
to notice. It is now `0.3..4 m` against a ~7 m rope, and the first version of
the fix failed it — the rope snapped, because stopping 82 kg in one step is 23
kN — which is exactly what a real bound is for.

## The slow-motion bug, and why the harness had to move first

`core/Time.ts` capped a frame at five fixed steps while its frame-time clamp
allowed fifteen, so below about 12 fps the game ran in **slow motion**. The cap
is now derived from the clamp. It could not be raised on its own because every
scenario polled for transients between wall-clock frames, and at fifteen steps
a frame a jump arc completes inside three of them. The scenarios were moved to
forced stepping in the same change, which is what made the cap safe to fix and
what made the suite independent of render cost.

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
- The viewmodel pass re-cleared the colour buffer, so the game drew all of
  Sunpatch and then wiped it: 92% of the opening frame was the raw clear colour
  with two enormous forearms in front of it. Every existing visual check said
  "ok" because none of them read the presented canvas.
- Input edges were computed per rendered frame and consumed per fixed step, so
  any frame that ran no step dropped the press. About half of all jumps, picks
  and clicks on a 144 Hz display, invisible at 60 Hz.
- A rope tied to the player never pulled the player (kinematic bodies are
  immovable to the solver), and the check that should have caught it could
  not fail.
- The spawn point was 4.9 m off the side of the dock deck, so the player fell
  2.4 m onto the sand, and nothing set a spawn yaw at all — the comment claimed
  it faced the island, and it faced whatever direction yaw 0 happened to be.
- The dock sign's board was positioned by a hand-rolled rotation that dropped
  the local X term, leaving it floating unsupported in the middle of the
  walkway, 2 m from its own post.
- The Puff Melon's wind behaviour never ran. `setInflation` clears `inflating`
  the moment the fruit reaches full size, and every one of drag, wind and
  buoyancy sat behind `if (!f.inflating) return` — so the species named for
  being blown across the island switched all of it off at the instant it
  became a balloon. What looked like flight was a stale force left in Rapier's
  accumulator by the code that had stopped running: `addForce` persists until
  something calls `resetForces`, so the last force written before the early
  return kept pushing forever. The melon hung motionless at a fixed height in
  still air, and a scenario measuring 58 m of drift passed on the artefact.
- `InteractionSystem` computed a spring offset for the carried fruit and then
  never added it to the fruit's position, so every species rode the hand point
  exactly and a 22 kg watermelon carried identically to an apple.
- The catch net could not miss. Held open, it caught a falling apple 100% of
  the time with no timing in it, and the scenario that covered it — hold the
  button, drop an apple, wait — would have passed a net with an infinite
  radius. The timing scenario that replaced it swings early on purpose and
  asserts the miss.
- `fruit:impact.onPlayer` is never true. Rapier reports no contact-force event
  for the kinematic player capsule, which the ragdoll's own detector documents
  and works around — but the camera thump was gated on that flag, so being hit
  by fruit produced no camera movement whatsoever.
- A client's sell intent ran `sellAll()` **on the host**. The request carried no
  fruit ids, so the host emptied its own basket, paid its own fruit into the
  shared pot, and the client that asked kept everything it was carrying. Every
  connectivity check passed, because money did change and both peers did agree
  on the number.
- Replicated fruit was filed under a locally-minted id rather than the host's.
  It worked only because two peers booting the same world consume ids in the
  same order; the first divergence would have produced a second copy of every
  replicated fruit, and the check that "a fruit spawned on the host appears on
  the client" would still have passed.

## Not yet automated

- **Real pointer lock.** The transition is exercised event by event — the queued
  delta is dropped, the first move after lock engages is swallowed, a spike is
  clamped, an ordinary move still turns the view — and the orientation is
  asserted unchanged across all of it. What is not covered is an actual
  OS-level lock grant: neither headless Chromium nor an embedded preview will
  hand one out (`requestPointerLock` rejects with "the root document of this
  element is not valid for pointer lock").
- Frame-rate on real GPU hardware (the harness runs under SwiftShader; its
  timings are useful for relative CPU cost only)
- Audio output (synthesis is exercised, the waveform is not asserted)
- Save/load round-trip through a page reload
- Network loss, latency and host migration
- Long-session memory growth
