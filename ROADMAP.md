# RIPE RIOT — Roadmap

Status of every system named in the brief. The vertical slice is playable end to
end: arrive, pick, sell, buy, escalate, and take down the King Melon.

## Done

**Foundation** — fixed-timestep loop with the step cap derived from the
frame-time clamp (no slow motion at low frame rates), latched input edges that
survive stepless frames on high-refresh displays, typed event bus, seeded RNG,
system registry, profiling, debug API, Playwright harness that advances the
world by forced fixed steps rather than wall-clock time, numeric frame triage,
contact sheets, geometry validation, 9 gameplay scenarios (256 checks), a
two-client multiplayer test (11 checks) and a startup check that reads the
presented canvas.

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

## Next, in order

1. **More impact VFX** — water splash, rope dust, sale sparkle. The shard
   system in `fx/ImpactFX.ts` is the place; it needs emitters, not a new system.
2. **Music** — light exploration bed, discovery sting, legendary escalation.
   The sting hooks already exist as events.
3. **WebRTC transport** — the interface is done; this is signalling plus ICE.
4. **Prediction and reconciliation** for client-side fruit interaction. Clients
   currently see a round-trip delay on their own picks.
5. **Save/load round-trip test** through a real page reload.
6. **Mid-tier tools** — harpoon, portable winch, sticky anchor, bounce charge,
   large catch net. All are compositions of existing systems.
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
  triangle counts ARE accurate: ~75 draws and ~535k triangles per frame, of
  which the shadow pass is 34 draws and 203k triangles.
- **Ragdoll shadows do not sway with the wind shader.** The depth material has
  no sway patch, so plant shadows are static while foliage moves. Not noticeable
  at this scale; would need a `customDepthMaterial`.
- **Rope meshes rebuild tube geometry every frame.** Fine at a handful of ropes;
  needs pooling before there are dozens.
- **CPU/GPU sway must be kept in step by hand.** The shader and
  `PlantSystem.swayOffset` implement the same curve twice, by necessity.
- **No prediction on client fruit interaction** (see item 5).
- **Boat is scenery.** It sells the arrival; it does not yet sail or upgrade.
