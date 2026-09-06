# RIPE RIOT — Roadmap

Status of every system named in the brief. The vertical slice is playable end to
end: arrive, pick, sell, buy, escalate, and take down the King Melon.

## Done

**Foundation** — fixed-timestep loop with the step cap derived from the
frame-time clamp (no slow motion at low frame rates), latched input edges that
survive stepless frames on high-refresh displays, typed event bus, seeded RNG,
system registry, profiling, debug API, Playwright harness that advances the
world by forced fixed steps rather than wall-clock time, numeric frame triage,
contact sheets, geometry validation, 10 gameplay scenarios (322 checks), a
two-client multiplayer authority suite (127 checks), a startup check that
reads the presented canvas, and a fresh-save playthrough with a stopwatch.

**Player entry** — the spawn is a pose derived from the built dock (position,
yaw and pitch together, one code path shared by boot, respawn and the tests):
standing on the planking looking back down the deck, with the sign, the shop
and the King Melon all in the opening frame. Viewmodel framing is measured
rather than eyeballed — screen-height percentage, distance from the crosshair
and the frame edges, at five aspect ratios.

**Player** — first-person controller (walk/sprint/crouch/jump/coyote/buffer/
short-hop), ladder climbing, carry-load slowdown, camera bob/roll/shake/recoil,
six-body articulated ragdoll with automatic recovery and a divergence guard,
chunky worker rig with five suit presets.

**World** — Sunpatch as an analytic height function; shared visual mesh and
collider; ocean with distance-faded waves; nine named landmarks.

**Sunpatch art pass** — the dock-to-shop-to-orchard route built for a first
impression rather than for a greybox: planked decking with real seams, posts
with rope swags, crates, barrels, fruit baskets and lanterns; a shop with a
gabled roof, overhanging eaves, a lit serving hatch, shuttered windows, a
bracket sign and a planked forecourt; a weighed and painted sell pad; a fenced
orchard avenue with working props. A worn route the ground itself draws, a
~2,100-piece instanced clutter layer, slope-placed rock outcrops, procedural
clouds, and a waterfall of three crossing sheets over a real rock notch with
spray at its foot. Nine extra draw calls for all of it.

**Fruit** — 7 species, 8 traits, 5 quality tiers, 8 rare variants, instanced
rendering (one draw call per species), activation radius, regrowth, honest
velocity-based impact damage.

**Plants** — 7 types × 3 shape variants, instanced with GPU wind sway mirrored
on the CPU, trunk colliders, shakeable.

**Interaction** — look-targeting with a forgiving cone, pick/carry/throw with
charge, the auto-stow basket rule, selling at the pad and by delivery.

**Tools** — hand picker, basket, ladder, catch net (+ ground nets), tree shaker,
rope gun (tether/pin/winch), air cannon (charged blast + self-launch); three
active slots plus one utility slot.

**Ropes** — hand-solved one-sided distance constraints with real tension,
winching, paying out and snapping on time-smoothed tension. Ropes pull the
player as an 82 kg body, capped to a tug per step, so a tether is a leash and a
falling melon can drag you.

**Impact feedback** — one instanced shard mesh driven by the events physics
already emits: dust by momentum, pulp and rind on bursts, leaves on shakes and
picks, a dust ring under a ragdoll and under the King Melon, and a camera thump
scaled by momentum over distance. The hands punch on pick, stow and throw.

**Systems** — economy with a discovery-tier gate, physical shop with tools and
stat upgrades, harvest book with per-species records and variant tracking,
stunt scoring (13 stunts) read off the physical record.

**Legendary** — the King Melon, six phases, playable and tested.

**Viewmodel** — procedural first-person models for all seven tools, rendered in
their own scene with a cleared depth buffer; sway, bob, recoil, charge pull-back
and stow/draw transitions.

**Audio** — fully synthesised: 24 sound generators, distance attenuation, stereo
panning, a limiter, and layered surf/wind ambience that responds to altitude.

**Multiplayer** — transport abstraction, same-machine BroadcastChannel
transport, deterministic host election, player replication with posed remote
rigs, fruit replication, shared economy, client intents.

**Save** — opt-in per-system serialisation, autosave, versioned blob.

**Feel pass** — the core loop tuned against measurements taken from the real
first-person game rather than from reading the source (`tools/harness/feel.mjs`
prints them). Carried fruit rides on a mass-softened spring so weight is
visible; left-click picks; grabbing loose fruit makes a sound and moves the
hands; the throw curve no longer saturates, so every species leaves the hand at
a different speed; being hit by fruit moves the camera at all, and the coconut
knockdown bar sits above a legible bonk band; the Puff Melon's wind behaviour
runs (it did not); the catch net telegraphs and rewards a real catch; ropes
announce going taut on the edge and tug the view; the air cannon out-throws an
arm; stunts stopped firing on every ordinary pick and now read as rewards.

**Carry presentation pass** — found by a human playing the build, not by any
check in the suite. Carried fruit was placed in world space at its true radius
0.85 m from the eye, so a watermelon covered 62% of the frame height and an
inflating Puff Melon contained the camera outright — while the equipped tool
kept drawing itself on top in the depth-cleared viewmodel pass. The world copy
is still the truth; the first-person view now draws a framed proxy whose top
edge is held below the crosshair, the tool stows itself whenever the hands are
full, and fruit above 1.10 m or 60 kg cannot be hand-carried at all — it is
shoved, roped, netted or blasted home instead. Anything that grows past the
limit while held leaves upward under its own power. Verified by
`tools/harness/carry-check.mjs` (framing, in percentages of the real frame) and
the `carry` scenario (the rules, in forced fixed steps).

**Catch net pass** — the net was a volume you held open, and measured against a
falling apple it was a certain catch with no decision in it. It is now an
aimed, timed swing: a third of a second of arc, a window in the middle of it
that can catch, a miss that whooshes, droops and costs a recovery, a buffered
re-press, and flailing on a held button that never earns a wider window. The
tolerance band is printed by `feel.mjs net` (about 0.10–0.25 s before arrival
catches), the four phases and the King Melon are on one sheet from
`net-check.mjs`, and the `tools` scenario swings early on purpose. The
King Melon's rind also went from two greens that averaged to canopy colour at
range to a pale stripe over a dark rind, so the legendary reads as a
watermelon from the dock rather than as one more tree.

**Authority pass** — the shed and the King Melon brought inside the host
boundary. Purchases are a host-validated intent (price, tier and balance
checked once, spent once, granted on the answer; simultaneous buyers get
exactly one shaker between them); the ledger knows each peer's basket
upgrade; the discovery tier travels with the money. The legendary runs on the
host and pays once: clients mirror phase, vines, transform and tethers, send
cuts and tethers as intents, and a client's rope gun opens the encounter. The
attached population is replicated as a sequence-numbered log of node changes
with a compacted manifest for joiners, so regrowth and late joins no longer
split the island into per-peer versions. Host election prefers the incumbent
and a promoted client inherits the ledger from its mirror. Intents are ranged
and clamped. Found and fixed on the way: the King Melon was not completable by
a player at all — rope-gun ropes never counted as tethers, and a rope fired at
the hanging (fixed) melon anchored to a point in the air.

**Shared ropes** — every rope is host state. Rope ends are typed (world,
fruit, legendary, this player, another peer) and resolved from identity
every step rather than from cached bodies, so a rope tied to a fruit on the
branch follows it when it comes down and no rope can hold a freed Rapier
body. On the wire a rope is `(owner, cid)`: the maker's peer id and its own
id for it, so nobody re-keys a rope its tools already hold. A client's gun
creates a local copy and asks; the host builds its own, lists every rope in
the snapshot, and clients mirror the rest. The half of a rope another peer
simulates is a stand-in with the real thing's mass, so a client's player
gets exactly its share of a tug and the host applies the other share to the
fruit. Peers leaving take their ropes with them; late joiners see what is
out; snaps are announced to the owner. The legendary's bespoke tether
mirroring is gone — a tether is a rope like any other.

**First chapter pass** — Sunpatch as a game rather than a slice. Three
back-country fruit with one physical rule each (Boulder Plum, Gluefruit,
Spikefruit), placed as an escalation with rare-variant pockets in the far
corners; a second worn track up the hill to the ravine and fingerposts that
name what is ahead; two fruiting palms by the shed; a WANTED poster and an
island board on the shed; the shed telling you in words what a locked tool
needs and what to save for; one "try this" line after every purchase; the
King Melon explained on first approach, tethers described by whether they
can actually lower it, the drop winching them taut, a landed melon that
counts as landed; a next-island unlock that changes the world and survives
the save; saves that actually load at boot; a playthrough harness with a
stopwatch. Numbers in TESTING.md.

## Next, in order

1. **More impact VFX** — water splash, rope dust, sale sparkle. The shard
   system in `fx/ImpactFX.ts` is the place; it needs emitters, not a new system.
2. **Music** — light exploration bed, discovery sting, legendary escalation.
   The sting hooks already exist as events.
3. **WebRTC transport** — the interface is done; this is signalling plus ICE.
   Use reliable, ordered data channels: the node log, the intent stream and
   the rope list all assume delivery in order.
4. **Host migration with loose fruit.** A promoted client's replicas of free
   fruit have no bodies and nothing gives them any; they freeze where they
   were. Ropes migrate (mirrors become the new host's), the ledger migrates,
   the loose fruit does not yet.
5. **Save/load round-trip test** through a real page reload. In co-op every
   peer saves its own copy of the shared pot.
6. **Mid-tier tools** — harpoon, portable winch, sticky anchor, bounce charge,
   large catch net. All are compositions of existing systems, and the shared
   rope layer is the base a harpoon and a winch sit on.
7. **Full Sunpatch content** — cave orchard interior, secret spawns, the rest of
   the landmark dressing.
8. **Weather and time** — day/night, wind events, rain surfaces. `TimeSystem`
    and `WeatherSystem` are named in the brief and not yet written; wind is
    currently a vector on `FruitSystem`.

## Later islands

Each is content plus a small number of traits, not new architecture.

| Island | New mechanics | New traits needed |
|---|---|---|
| Gale Grove | wind tunnels, canopy, long-distance catches | buoyancy (Floatpear), extended `inflate` |
| Red Rind | elastic vines, volatile fruit, rolling terrain | `volatile` (written), `spiked` |
| Cold Crop | low friction, breakable ice, sliding cargo | `frozen`, `slippery` |
| Oddgarden | local gravity, phasing, magnetism | `gravity`, `phase`, `magnetic` |

Legendaries: Sky Gourd, Canyon Melon, Glacier Fruit, World Fruit. The King Melon
established the shape — phases that are physical problems, a soft failure, and a
solo path that widens the margin rather than changing the script.

## Known gaps and honest caveats

- **Frame rate is unmeasured on real hardware.** The harness runs under software
  rendering; its timings are only good for relative CPU cost. Draw call and
  triangle counts ARE accurate: ~104 draws and ~745k triangles per frame after
  the first-chapter pass (was ~75 / ~535k), of which the shadow pass is 47
  draws and 283k triangles. The growth is three new fruit species, up to nine
  new plant batches (three types, three shape variants each), five more
  sign boards and the boat's pennant. The shadow pass is still the first lever;
  giving the new bush types one shape variant instead of three would give
  back twelve draws for a visible cost only on the ridge.
- **Ragdoll shadows do not sway with the wind shader.** The depth material has
  no sway patch, so plant shadows are static while foliage moves. Not noticeable
  at this scale; would need a `customDepthMaterial`.
- **Rope meshes rebuild tube geometry every frame.** Fine at a handful of ropes;
  needs pooling before there are dozens.
- **CPU/GPU sway must be kept in step by hand.** The shader and
  `PlantSystem.swayOffset` implement the same curve twice, by necessity.
- **A client's harvest book only learns from sales.** Discovery fires on
  `fruit:detached`, which the host emits and a client never does; the tier is
  synced from the host, but a client's own records of species seen are not.
- **A peer that played solo and then joins keeps its solo world.** The
  manifest reconciles the attached population to the host's, but loose fruit
  and money from the solo session are neither wiped nor merged.
- **Boat is scenery.** It sells the arrival and raises a flag when Gale Grove
  opens; it does not yet sail.
- **Each sign is its own draw call.** Eight boards now; fine until it is not.
- **A completed King Melon still hangs there after a reload.** The phase is
  restored as complete and nothing offers it again, but the fruit is drawn on
  its vines. Cosmetic, and the next island is where the attention goes.
