# RIPE RIOT — Architecture

WebGL / Three.js / TypeScript, physics by Rapier (WASM), bundled with Vite.
No runtime asset files: every mesh, texture, material and sound is generated in
code.

## Shape of the thing

```
main.ts            boots the Game, registers systems in dependency order
core/Game.ts       fixed-timestep loop, system registry, event bus, profiling
core/Time.ts       60 Hz accumulator with interpolation + forced stepping
core/Events.ts     typed event bus (see core/GameEvents.ts for the map)
core/Rng.ts        seeded mulberry32; every world-generating system forks one
```

A **System** is anything with a `name` and any of `init / fixedStep /
frameUpdate / lateUpdate / dispose`. `Game` owns an ordered list and calls them.
Systems find each other by name (`g.get<T>('fruit')`), typed by the narrow shape
the caller needs rather than the concrete class, which keeps coupling low.

Registration order in `main.ts` is dependency order. `init()` runs in that
order, so a system may resolve anything registered before it.

```
world → economy → fruit → ragdoll → interaction → ropes → scoring
      → tools → shop → book → legendary → audio → net → save → ui
```

### The loop

```
per frame:
  sample input
  apply mouse look                    (per frame — see note below)
  for each fixed step (60 Hz):
      player.step()
      system.fixedStep()              ← all simulation
      physics.step()                  ← Rapier integrates
  system.frameUpdate()                ← visuals, interpolation
  camera update, sun follow
  render
```

Look is applied per frame rather than per fixed step: mouse deltas are already
frame-quantised, and re-integrating them at 60 Hz feels laggy.

**Input edges are latched until a fixed step consumes them.** A press is
recorded by the event handler and cleared by `PlayerInput.consumeEdges()`,
which the loop calls after the first fixed step of a frame and never on a frame
that ran none. The first version derived "pressed" from a per-frame key-set
diff, and because edges were computed per rendered frame but read per fixed
step, any frame with zero steps lost the press. On a 120 or 144 Hz display that
is most frames: jump, pick and click were dropped about half the time, and a
60 Hz harness could not see it. The `movement` scenario now presses jump, renders
six stepless frames, and asserts the jump still happens.

**The step cap matches the frame-time clamp.** `Time.ts` allows a frame to
represent 0.25 s and lets it run `0.25 / (1/60)` = 15 steps. They used to be
separate numbers (0.25 s and 5) and the game ran in slow motion below ~12 fps.
A slow frame now costs frame rate and nothing else. The test harness no longer
depends on either number: it advances the world by forced steps.

Rope constraints are solved in `fixedStep`, i.e. *before* `physics.step()`, so
the solver integrates the impulses they apply.

## Key decisions, and why

**The route is a ground treatment, not a corridor.** `Terrain.ROUTE` is a
fifteen-point polyline from the dock, past the shop, up into the orchard, with a
half-width that opens out at the sell pad. `pathWeight(x, z)` answers "how much
is this point on the route", and three separate systems consult it: the terrain
tints toward packed earth, the clutter layer keeps off it, and the tree scatter
refuses to plant on it. The height function is not touched at all, so nothing
about traversal, collision or the authored pads changes — and the way ahead is
readable without hanging a marker in the sky.

**Clutter is instanced, clumped, and never collidable.** `world/Dressing.ts`
places ~2,100 pieces of grass, bush, fern, flower, stone and driftwood for nine
draw calls. Density is multiplied by a low-frequency noise field so vegetation
gathers into thickets with clear ground between them: at the same instance count
a uniform scatter reads as static and hides the route, and a clumped one reads
as a place and frames it. On top of the procedural field sits a table of
hand-placed clusters, because the scatter has no idea that the corner where the
dock meets the sand is the first thing anybody sees. Nothing in the layer has a
collider — a bush you have to walk round is a bug, not detail.

Flowers are two meshes sharing one set of transforms: green stems, and heads
that take a per-instance tint. `instanceColor` multiplies the whole instance, so
a single merged mesh would tint the stems red along with the petals; split, five
flower colours cost two draw calls instead of five.

**Decorative planting goes through the fruit system's plant pool.** The palms
and broadleaf cover along the route are planted by `FruitSystem` from a `DECOR`
table and simply never have `growOn` called on them. They land in the same
instanced batches as the fruiting plants, so thirty of them cost no draw call
and get the existing GPU wind sway for free.

**The island is a pure function, not a heightmap.** `world/Terrain.ts` is
`height(x, z)`. The visual mesh and the collider are generated from the same
function, so they cannot drift apart, gameplay can ask "how high is the ground
here?" without a raycast, and the whole island is ~150 lines in source control.

**One InstancedMesh per fruit species.** Attached, falling, rolling and carried
fruit all draw from the same instance buffer, so 458 fruit across the island
cost seven draw calls. Species colouring lives in the geometry's vertex colours;
per-fruit tint (variant, bruising) rides on `instanceColor` and multiplies over
it. A small `onBeforeCompile` patch adds a per-instance emissive term so Glowing
variants actually glow.

**Plants are instanced with GPU wind sway, mirrored on the CPU.** The vertex
shader displaces by a `swayWeight` attribute; `PlantSystem.swayOffset` computes
the identical curve in JS so attached fruit tracks the branch it hangs from
instead of hovering beside it. The two must be kept in step by hand — that is
the cost of the approach and it is called out at both sites.

**Fruit that is far away has no collider.** Attached fruit is transform-only
until a player comes within `activationRadius` (42 m), at which point it gets a
*fixed* collider so tools and thrown objects can hit it. Hundreds of colliders
across the island would be pure broadphase cost for nothing.

**Ropes are solved by hand, not by Rapier joints.** Measured, Rapier's rope
joint did not constrain at all here: a 2.6 tonne melon fell through three of
them and a tethered player walked 9 m against a 2.5 m rope. `RopeSystem` solves
each rope as a one-sided distance constraint with a Baumgarte positional term.
This also yields tension in real newtons (a 4 m rope holding 22 kg reports
484 N = mass × gravity), which drives strain audio, snapping and winching.
Rope endpoints are resolved from Rapier *handles* every step, never from cached
`RigidBody` references — holding one across its removal calls into freed WASM
memory and poisons every later physics call.

The player is a kinematic body, which Rapier treats as immovable. A rope tied
to the player therefore held a melon and could never pull the player, and the
"restrains the player" check passed with a bound a player with no rope could
not have failed. The solver now treats the player end as an 82 kg movable
whose velocity lives on the controller, capped at a 9 m/s change per step so
the end of a rope is a tug rather than a teleport. Snapping is judged on
tension smoothed over ~0.15 s: arresting a walking player inside one step is
23 kN on paper, more than any rope is rated for, and the first version of this
parted the rope on the first taut step.

**Explosions iterate bodies rather than shape-querying.** Measured,
`intersectionsWithShape` reliably returned only the terrain even when centred on
an awake dynamic collider a raycast had just hit, silently making every blast a
no-op. Iterating the body set is O(few hundred) once per blast and cannot miss.

**Impact severity is velocity actually lost in one step.** Rapier's contact
force integrates over substeps, so `force / mass` overstates a hit by a large
and inconsistent factor — it was bruising apples dropped four metres. Every
fruit tracks its own speed each step; the drop is the impact. Contacts are still
used, but only to answer *who* was hit.

**Mass must be set via `ColliderDesc.setMass`.** Setting a near-zero density and
adding mass separately gives the right kilograms with a near-zero inertia
tensor. A lone fruit survives that; a jointed ragdoll diverges to 1.7e6 m, and a
2.6 tonne melon that weighs nothing ignores its vines.

**Impact feedback is one instanced mesh, simulated in the fixed step.**
`fx/ImpactFX.ts` listens to the events the physics already emits —
`fruit:impact` with its honest velocity-loss, `fruit:destroyed`, `plant:shaken`,
`player:ragdoll`, `legendary:landed` — and throws chunky octahedron shards:
dust for landings, pulp and rind for bursts, leaves for anything that disturbs
a canopy. It also thumps the camera by momentum over distance, so a coconut
beside you and the King Melon across the basin both register and an apple
never does. Particles bounce off `terrain.height`, which is a function, so no
raycasts. It is cosmetic, one draw call, and the `fruit-physics` scenario
asserts a burst actually produces particles.

**Canopies are shaded by facing, in the vertex colours.** `PlantGeometry`
darkens faces that point down and lightens faces that point up before merging,
so a low-poly canopy has a top and an underside in flat light and in shadow
alike; the lighting only adds to that. Broadleaf trees are a crown, a ring and
a lower wider ring of smaller blobs, which stacks the silhouette and hangs most
of the fruit at head height. Each plant instance also carries a warm/cool and
light/dark tint on `instanceColor`, so three cached shapes do not read as three
trees.

**The viewmodel gets its own scene and camera.** Tools are rendered as a second
pass with the depth buffer cleared, so a tool can sit 40 cm from the eye without
ever poking through a wall — the usual failure of parenting a viewmodel straight
to the camera. It is purely cosmetic and never feeds back into simulation.

Two things about that second pass are not optional. `autoClear` must be off
around it: `render()` honours it on *every* call, so the viewmodel pass
otherwise wipes the colour buffer and the entire world with it, leaving the
clear colour behind the tool. That shipped, and nothing caught it —
`frameStats()` renders the scene into its own target, so the numeric triage
never looked at the canvas the player was looking at, and every contact sheet
detached the camera first. `tools/harness/startup-check.mjs` now reads the real
canvas and fails if any measurable fraction of it is the raw clear colour.

And a viewmodel's screen size is set by how CLOSE its nearest vertex is, not by
its scale — at 0.22 m a 7 cm forearm is a quarter of the frame height. Framing
lives in one place (`VIEW_OFFSET`, `VIEW_SCALE` in `render/Viewmodel.ts`), the
lateral placement is a fraction of the visible width rather than a fixed
distance so it survives a narrow window, and the harness asserts the resulting
percentages for every tool at five aspect ratios.

**The world's idea of size and the camera's idea of size are allowed to
disagree, in one direction only.** Carried fruit used to be placed in world
space at its true radius, 0.85 m in front of the eye, and perspective decided
the rest. That is honest and it is unusable: a 22 kg watermelon covered 62% of
the frame height, and a Puff Melon — which triples in diameter in the two thirds
of a second *after* it leaves the bush, i.e. while it is in your hands — reached
a radius of 0.87 m at a hold distance of 0.85 m and literally contained the
camera. Meanwhile the equipped tool went on drawing itself over the top of it in
the depth-cleared viewmodel pass, so a bad frame was a melon, a basket, a rope
gun and two unrelated gloves at once.

The split is now explicit:

- **The world copy is the truth.** True size, true position, true physics, and
  it is what other players see you holding. Its hold distance grows with the
  fruit's radius so it never intersects the person carrying it.
- **The camera copy is a proxy** (`player/CarryViewmodel.ts`), drawn in the
  viewmodel scene at a size chosen so that the fruit's TOP EDGE lands at a fixed
  fraction of frame height — 34% for a small fruit, 40% for a heavy haul, all
  well under the crosshair at 50%. Sizing from the top edge rather than the
  centre is the trick: a bigger fruit then grows *downward* out of frame instead
  of upward into the crosshair. Real size still shows through a compressed curve
  (`screenHeightPctFor`), so an apple, a coconut and a watermelon are visibly
  three different sizes; the curve is just capped.
- The local player's world copy is suppressed from the instanced batch for the
  one frame it is held (`FruitRenderer.hiddenId`) so the two never fight.

`interaction/CarryRules.ts` owns the classification — small / medium / large /
oversized, gated on BOTH true diameter and true mass — and it is a pure function
so it can be checked exhaustively without spawning anything. Above the limit
(1.10 m across or 60 kg) a fruit cannot be hand-carried at all: picking it up is
refused with a reason, aiming at it offers a shove instead, and anything that
grows past the limit *while held* is handed back to the world, upward and away,
with the buoyancy clock restarted so it genuinely leaves rather than hanging in
front of the lens. Big fruit is a physics problem in the world, never a
visibility problem in the camera.

**Weight is a spring, not a number in the HUD.** A carried fruit is drawn at the
hand point plus an offset that a mass-softened spring pulls back to zero, and
the hands moving is what displaces it. Stiffness falls with mass, so an apple
trails 7 cm through a fast turn and a 22 kg watermelon trails 21 cm and takes a
beat to catch up; the cap on that offset opens up for a moment on a pick so the
fruit visibly springs off the branch rather than teleporting into frame. The
offset was already being computed before this and simply never added to the
fruit's position, which is why every species used to carry identically.

**Getting hit is detected by proximity and velocity loss, in one place.**
Rapier reports no contact-force event for the kinematic player capsule, so
`fruit:impact.onPlayer` is never true. `PlayerRagdoll.checkFruitStrikes` is the
only detector that works: capsule-distance plus the fruit's velocity lost this
step. It now has two outcomes rather than one — above the threshold you are
flattened, below it a `player:hit` goes out and the camera, viewmodel and HUD
react. Anything that wants to know a player was struck listens to that event;
nothing should reach for the contact flag, which looks authoritative and is
always false.

**Forces on fruit bodies are applied as impulses.** Rapier's `addForce`
accumulates into a persistent buffer that is only cleared by `resetForces`, so
a force written every step is not "a force" — it is a growing one, and one
written and then abandoned keeps acting forever. The Puff Melon's drag and
buoyancy did both. Traits multiply by `ctx.dt` and call `applyImpulse`, so a
number in the source is one step's worth of exactly what it says.

**The spawn is a pose, not a point.** `Sunpatch.spawnPlayer()` sets position,
yaw and pitch together, is derived from the built dock rather than from
coordinates written next to it, and is the single path used by boot, respawn and
the tests. The coordinates that shipped were 4.9 m off the side of the deck, so
the player fell onto the sand and — since nothing set a yaw — faced whatever
direction yaw 0 happens to be.

## Multiplayer

`net/Transport.ts` abstracts the wire. `BroadcastTransport` (same-machine, real
local co-op) is what ships today and is what the automated multiplayer test
drives — two real browser pages, two real game instances. A WebRTC transport
implements the same interface and nothing above it changes.

`net/MultiplayerAuthority.ts` is host-authoritative. The host owns fruit
physics, detachment, ropes, quality, economy and weather. Clients own only their
own movement and otherwise send **intents** the host validates and applies. Host
selection is deterministic (lowest peer id) so there is no election round.

This exists early because retrofitting an authority boundary through a physics
game is a rewrite, not a refactor.

## Debug surface

Everything the test harness needs is on `window.__RIPE` (`debug/DebugAPI.ts`).
Systems register **probes** (state, folded into one flat object) and **actions**
(callable commands) during their own `init`. Nothing in the game depends on it,
so it can be stripped from a shipping build.

The design rule is *return numbers, not pictures*. `Renderer.frameStats()`
renders the current view into a 96×54 target and reduces it to mean luminance,
flat fraction, contrast, hue spread and a histogram, which is enough to catch a
black screen, an untextured wall or a washed-out horizon without anyone opening
an image.

It has one blind spot worth knowing: it renders the scene *itself*, into its own
target. It therefore cannot see anything a later pass does to the presented
frame — which is precisely how a viewmodel pass that wiped the whole canvas
scored "ok" on every metric. Anything that asks "what is the player actually
looking at" has to read the canvas, which is what `startup-check.mjs` and the
`startup` scenario do.

## Performance posture

Measured on the current build with the island fully populated (113 plants, 458
fruit, ~154 physics bodies), attributed by toggling passes:

| Pass | Draw calls | Triangles |
|---|---|---|
| scene | 40 | 331k |
| shadow map | +34 | +203k |
| viewmodel | +1 | ~1k |
| **total** | **~75** | **~535k** |

The shadow pass nearly doubles both, which makes it the first lever to pull if
frame time becomes a problem (shorter shadow distance, or a cascade).

Note that `renderer.info` resets per `render()` call. With two passes it must be
reset manually and snapshotted, or it reports only the viewmodel — one draw call
and seventy triangles, which looks like a spectacular optimisation and is in
fact a broken measurement.

- one draw call per fruit species, per plant type/variant, one for all props
- terrain is one mesh; submerged seabed triangles are not indexed
- attached fruit has no rigid body at all; free fruit sleeps via Rapier
- ragdolls exist only while ragdolled (6 bodies, 5 joints)
- rope meshes rebuild their tube geometry per frame, which is fine at the
  handful of ropes in play and would need pooling in the hundreds

Frame timings from the automated harness run under SwiftShader (software
rendering) and are **not** representative of GPU performance; use them for
relative CPU cost only.
