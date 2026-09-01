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

Rope constraints are solved in `fixedStep`, i.e. *before* `physics.step()`, so
the solver integrates the impulses they apply.

## Key decisions, and why

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

## Performance posture

Measured on the current build: 38 draw calls, ~307k triangles, ~154 physics
bodies with the island fully populated (113 plants, 458 fruit).

- one draw call per fruit species, per plant type/variant, one for all props
- terrain is one mesh; submerged seabed triangles are not indexed
- attached fruit has no rigid body at all; free fruit sleeps via Rapier
- ragdolls exist only while ragdolled (6 bodies, 5 joints)
- rope meshes rebuild their tube geometry per frame, which is fine at the
  handful of ropes in play and would need pooling in the hundreds

Frame timings from the automated harness run under SwiftShader (software
rendering) and are **not** representative of GPU performance; use them for
relative CPU cost only.
