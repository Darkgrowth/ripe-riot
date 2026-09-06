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
      → tools → shop → book → legendary → progress → audio → net → save → ui
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
half-width that opens out at the sell pad, and `ROUTE_HILL` continues out of
the back of the orchard, up the one 29-degree shoulder of the hill, across the
hill farm and down to the ravine rim. `pathWeight(x, z)` answers "how much
is this point on a route", and three separate systems consult it: the terrain
tints toward packed earth, the clutter layer keeps off it, and the tree scatter
refuses to plant on it. The height function is not touched at all, so nothing
about traversal, collision or the authored pads changes — and the way ahead is
readable without hanging a marker in the sky. The waypoints were chosen from
`tools/harness/geo-probe.mjs`, which prints heights and slopes along a
candidate line, not from coordinates that looked plausible.

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

**Rope ends are identities, resolved every step.** An end is `world` (a
point), `fruit` (an id and an offset in the fruit's frame), `legendary`,
`player` (this peer's) or `peer` (another peer's, known by reported position).
Nothing caches a body: a fruit changes bodies across its life — a static
collider on the branch, a dynamic one loose, none in a hand — and the first
rope system tied a line fired at an apple on the tree to the point in the air
where its surface had been, so when the apple came down the rope stayed up.
Resolving by id follows it, and it also removes the whole class of "held a
`RigidBody` across its removal" faults, because there is nothing to hold.

Each resolved end carries an inverse mass, and that number is where the
co-op authority story for ropes lives. A body this peer simulates gets its
real inverse mass and gets pushed. A body some OTHER peer simulates — a
replica fruit on a client, a remote player on the host — also gets its real
inverse mass, so the impulse split is identical on both machines, but nothing
here pushes it; the peer that owns it applies that share. A client tethered to
a watermelon therefore feels 22/(22+82) of the tug and the host's watermelon
gets 82/(22+82) of it, which is what would happen if both bodies were in one
world. Only the host parts a shared rope; a client's copy would snap at the
wrong moment against a stand-in.

**A rope's wire identity is `(owner, cid)`.** The maker's peer id and the
maker's own rope id. Nobody ever re-keys a rope its tools already hold: the
host's ropes use its rope ids as cids, a client's local rope keeps its id and
the host files its copy under the client's number, and the snapshot lists
every shared rope as `[owner, cid, endA, endB, length]`. A client matches its
own by cid and only follows the host's length; everyone else's it mirrors. A
rope the host stops listing is gone — except one of the client's own that the
host has not acknowledged yet, which is still in the post and outlives the
snapshot that crossed it. Snaps travel as their own message so the owner
hears the line part. Vines are not shared at all: every peer grows them from
the seed and the legendary cuts them by bitmask, which is cheaper and was
already correct. The legendary's tethers, which used to be mirrored by anchor
proximity through a pair of dedicated intents, are now just ropes on the
melon, counted on every peer the same way.

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

**The catch net is a timed swing, not a volume.** The first net was "hold the
button and anything entering a 1.55 m sphere is yours", and measured against a
falling apple it was a 100% catch with no decision in it. `CatchNet` is now a
three-phase state machine — swing (0.34 s, of which 0.06–0.28 s can catch),
recover (0.36 s, 0.50 s after a whiff), ready — with the hoop sweeping through
the aim point at the middle of the active slice. A miss is an *event*, not the
absence of a catch: a catchable fruit passing the hoop while the net cannot
take it plays, dips the view, extends the recovery and, the first three times,
says what went wrong. Presses in the last 0.14 s of a recovery are buffered,
and a held button swings again on the same clock, so flailing is legal and
never gets a wider window for it. The arms follow the swing through a
`tool:swing` event rather than the tool reaching into the viewmodel.
`feel.mjs net` prints the resulting tolerance band — presses about 0.10–0.25 s
before arrival catch a falling apple, either side misses — and
`net-check.mjs` shows the four phases and the King Melon on one sheet.

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

**Hand rules are species rules, enforced twice.** Whether a fruit may be
taken by hand is decided by the same trait check on every peer — `spiked`
means never, `sticky` means it keeps the hands for a while — and the host's
`claim` applies it again to a client's request, carrying the pick's cause
(`hand`, `net`, `stuck`) so the net may take what hands may not and a
gluefruit that HIT someone holds on longer than one they reached for. The
"it hit you" detection lives on whichever peer simulates the fruit: the host
for its own player in `InteractionSystem` and for everyone else's in
`MultiplayerAuthority`, because a client's copy of a loose fruit has no body
and no speed. What a client learns from the snapshot is a fruit in its hands
with a `stuckHands` clock, and it refuses to let go for exactly that long.

**Progression is a system with no mechanics in it.** `systems/Progression.ts`
listens to the events the loop already emits — purchases, sales, discoveries,
the legendary's phases — and adds the connective tissue: the one line after a
purchase that turns the tool into a plan, the King Melon explained on first
approach, a banner for a new best sale, and the island unlock a beat after the
legendary pays. Everything it says is written down once per save so a
returning player is not re-taught, and it records the game time of each
first-ever milestone, which is what the playthrough harness reads.

**Saves load.** They were written for months — on a 45 s autosave and on
unload — and nothing ever read them back, so every session was a fresh one.
`SaveSystem.init` now restores the autosave slot before the UI exists, and the
UI reads the restored balance when it comes up. `?fresh` on the URL skips it,
and the harness driver always adds it, so a test page that saved on close
cannot hand its money to the next page in the same browser context.

## Multiplayer

`net/Transport.ts` abstracts the wire. `BroadcastTransport` (same-machine, real
local co-op) is what ships today and is what the automated multiplayer test
drives — two real browser pages, two real game instances. A WebRTC transport
implements the same interface and nothing above it changes.

`net/MultiplayerAuthority.ts` owns the wire. `net/FruitAuthority.ts` owns the
decision: a ledger of which peer holds which fruit, plus the validation for
every action that changes it. Host selection is deterministic (lowest peer id)
so there is no election round.

The split, stated once: **the host owns the world** — which fruit exists, whose
hands it is in, what it is worth, when it is gone. **A client owns exactly one
thing, its own player.** Everything else a client does is an intent naming the
fruit it means; the host validates it against the ledger and either applies it
or refuses it with a reason.

Where the boundary is enforced matters more than that it exists. The gate sits
at the bottom of the stack — `FruitSystem.detach`, `FruitSystem.shake` and
`FruitSystem.blast` — so it catches the hand, the shaker, the rope gun and the
air cannon in one place, rather than at each of the nine call sites someone
has to remember. (The cannon's blast went straight to the physics world
before, which on a client with bodiless replicas did nothing at all.) Ownership
transitions (`pickUp`, `stow`, release, sell) are gated in `InteractionSystem`,
which every tool already routes through.

Clients **predict** the cheap, reversible half so the game still feels local: a
picked fruit is in your hands on the frame the key went down. They reconcile
two ways — a targeted refusal, which undoes the prediction immediately and says
why, and the 15 Hz snapshot, which corrects hands and basket against the host's
ledger whatever caused the drift. **Nothing that creates money is predicted.**
A sale costs one round trip and buys certainty that the payout happens once.

Three details that are load-bearing:

- **Replicated fruit carries the host's id and the host's size roll.** Species
  plus variant plus roll rebuilds a fruit exactly, so a replica weighs, values
  and carries like the host's copy. The old path minted a fresh local id and
  filed the fruit under it; that only ever worked because two peers booting the
  same world consume ids in the same order.
- **The carrier owns its carried fruit's transform** — but only because the
  host said so, and only while the ledger agrees. A position report for a fruit
  the host has not booked out to that peer moves nothing.
- **Sold and destroyed fruit is tombstoned.** A snapshot in flight is older
  than the request that crossed it, and without tombstones it puts the fruit
  back.

This exists early because retrofitting an authority boundary through a physics
game is a rewrite, not a refactor.

**Money is destroyed in one place too.** A client's purchase is a `buy` intent:
the host checks the price list, the discovery tier and the balance, spends
once, records the sale against that peer, and answers; the client grants
itself the tool or upgrade only on a yes. Nothing is predicted — the shed
already checks the mirrored balance and tier before asking, so a refusal is
instant and a purchase costs one round trip. Tools and upgrades are
per-player; the pot is shared. The ledger also keeps each peer's basket
limits, because a client that paid for a Deep Basket used to have its tenth
apple refused by a host that only knew the base capacity. The discovery tier
travels in the snapshot with the money, since it gates the shed and a client's
book never fires the events that raise it.

**The King Melon runs on the host and pays once.** Clients mirror a small
state (`LegendaryNetState`: phase, a bitmask of the vines still holding, the
melon's transform, the tether anchors, the payout, and a generation number
that bumps on reset) and send cuts and tethers as intents. A client's melon is
a fixed body moved to where the host says it is, with the mesh damped between
reports, so ropes on it draw and walking into it is honest; the client never
simulates the drop. Cosmetic copies of other players' tethers are built from
the anchor list; a client's own pinned rope is reported once and removed when
the host stops listing it, which is how "the ropes parted" reaches the person
holding the other end. Owning a rope gun travels in the player packet, so a
client's rope gun opens the encounter on a host that has none.

**A tether is a rope, not a method call.** The legendary reads its tethers off
the rope system every step — any rope on the melon that is not a vine and is
not in somebody's hands — instead of keeping a list only a debug action could
append to. The shipped slice was not completable by a player for that reason,
and for a second one: the melon hangs *fixed* until its first cut, and the
rope gun anchored any line fired at a fixed body to a point in world space, so
the rope stayed in the air when the melon fell. The rope gun now ties to the
body when the body is the legendary; the pin (right-click) is what turns a
leash into a tether, and the prompt says so.

**The attached population travels as a log of node changes.** Snapshots skip
attached fruit because it is deterministic from the seed — and stop being
deterministic the moment a branch regrows, since every peer used to roll its
own regrowth with its own ids. The host now logs every node it empties and
every node it refills (`NodeChange`, sequence-numbered), streams the tail each
peer has not acknowledged with the snapshot, and sends a compacted
one-entry-per-node manifest to a joiner or to anyone who has fallen out of the
ring. Clients keep their regrowth queue (so a promoted host can carry on) and
grow nothing on their own clock. A fruit the log frees that the same snapshot
does not place anywhere is one the host no longer has — sold, burst, or long
gone — and is removed, which is what stops a late joiner seeing phantoms.

**The incumbent keeps the session.** Lowest-id election on every peer change
handed the world to whichever fresh page rolled a small id — host migration
*to an empty world*. Now a page that has just opened does not elect at all
until somebody answers its hello; the hello carries the sender's claim and
connection age, and the older session wins with lowest-id only for a genuine
simultaneous start. Nothing a peer says while it is briefly "host of nobody"
counts: snapshots, manifests and results are only applied from the peer the
receiver believes is host, and a host broadcasts no snapshot until it has been
established. When the host does leave, the survivors elect lowest-id among
themselves — on the `bye` itself, not three and a half seconds later when the
transport's liveness timer notices, because a session with no authority is a
session where every loose fruit on the island is standing still.

**A promotion rebuilds the physics, not just the ledger.** This was the last
serious hole in co-op and it is worth stating plainly: a client's loose fruit
is a PICTURE. `spawnReplica` builds it with no body on purpose — the host owns
the physics — so a promoted client inherited a world in which every loose
fruit was a visual-only replica that no rope, hand, shove or blast could ever
touch again. It looked like the fruit had frozen, because it had.

`MultiplayerAuthority.promote()` is the one place that fixes it, and the order
is the argument:

1. **tombstones**, seeded from the `gone` ids this peer saw as a client, so
   nothing sold or burst can be resurrected by anything below;
2. **the mirror of the old ledger**, so fruit in other players' hands stays in
   their hands;
3. **our own hands, basket and purchases** — per-player upgrades ride on the
   player packet (`bt`) for exactly this reason, or a new host would refuse a
   Deep Basket its ninth apple;
4. **orphans**: anything still booked to a peer who is not here is spilled back
   through the same recovery path a disconnect uses;
5. **`FruitSystem.adoptAuthority()`** — a real dynamic body for every loose
   fruit, at the transform, damage, inflation and VELOCITY the last snapshot
   reported. Velocity is why the fruit packet carries six more numbers than it
   used to: without them a melon rolling down the ravine is reconstructed at
   rest wherever the snapshot caught it, which is precisely the thing a player
   can see. `Fruit.adoptRemoteBody()` goes through the same `createBody` that
   `detach` and `release` use, so a reconstructed fruit rejoins the ordinary
   physics and instancing path with nothing special about it; a stuck gluefruit
   comes back fixed, not sliding off the cliff it was stuck to;
6. **the ropes**, which resolve by fruit id and therefore find exactly the
   bodies step 5 built. Restraint is recomputed, because `create` writes it
   only on the peer that simulates the fruit and a mirror never did;
7. **the legendary**, whose melon a client holds *fixed* and a host must not —
   a fixed melon under a promoted host is two and a half tonnes hanging in the
   air that nothing will ever move again. Tethers are re-armed for the drop for
   the same reason: the ratings the old host raised live on the old host's
   copies;
8. **our own pending requests**, settled here rather than left to time out and
   loudly forfeit a pick this peer has just legitimised as the authority.

`Fruit.adoptRemoteBody` has an inverse, `FruitSystem.handBack`, which runs when
a snapshot describes a loose fruit this peer is still simulating. Two machines
integrating one melon is worse than neither: both advance it, the snapshot
corrects one of them fifteen times a second, and the fruit stutters between two
futures.

**A departed peer's ropes are not all the same rope.** A line with that player
on one END goes with them — it would otherwise hold a melon to a point in the
air where somebody used to be standing. A line they merely MADE, between two
things that are both still here, is world state and is re-keyed to the new
host: dropping every one of them at a migration is how a King Melon that four
people spent ten minutes restraining ends up on the ravine floor.

**The first snapshot after connecting sweeps wider than the rest.** The
ordinary sweep can only forget fruit it was told about, and a peer that has
just joined was told about nothing — so a page that hosted, left and came back
kept every fruit the new host had sold or burst while it was away, as ghosts
only it could see. On the first snapshot, anything disturbed that the host does
not list at all is dropped. Same rule the ropes already follow when they leave
a session: what the host does not have is not part of this world.

Two smaller things this pass fixed because the migration test walked into them:
a spill now lands at the departing player's FEET rather than at the terrain
under them, which on the dock is several metres of seawater and deleted
everything they were carrying as sunk; and `forgetPeer` will not take a fruit
out of somebody else's live hands just because a stale holding still names it.

**Intents are ranged and clamped.** A shake must name a plant near the peer, a
blast must land within cannon reach at no more than a full charge, a release
point must be within arm's reach of where the peer says it stands, and a
throw is capped at 45 m/s. A client's position is still trusted, which is the
stated posture for co-op with friends.

**Species and variants travel as indices into the registries**, not a
hand-written list. The list silently mapped anything it did not know to
`'apple'`, so the first fruit added for Island 2 would have replicated as an
apple on every client and passed every check that only asked the host.

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
