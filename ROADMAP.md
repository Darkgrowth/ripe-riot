# RIPE RIOT — Roadmap

Status of every system named in the brief. The vertical slice is playable end to
end: arrive, pick, sell, buy, escalate, and take down the King Melon.

## Done

**Foundation** — fixed-timestep loop, typed event bus, seeded RNG, system
registry, profiling, debug API, Playwright harness with numeric frame triage,
contact sheets, geometry validation, 7 gameplay scenarios (157 checks) and a
two-client multiplayer test (11 checks).

**Player** — first-person controller (walk/sprint/crouch/jump/coyote/buffer/
short-hop), ladder climbing, carry-load slowdown, camera bob/roll/shake/recoil,
six-body articulated ragdoll with automatic recovery and a divergence guard,
chunky worker rig with five suit presets.

**World** — Sunpatch as an analytic height function; shared visual mesh and
collider; ocean with distance-faded waves; dock, boat, shop shed, sell pad,
signs, crates, rocks, waterfall and cliff; nine named landmarks.

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
winching, paying out and snapping.

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

## Next, in order

1. **Feel pass on what exists.** The systems are verified; the *tuning* is not.
   Play an hour, adjust throw arcs, net radius, cannon recoil, damage
   thresholds, prices and regrowth timers against how it actually plays.
2. **Particles and impact VFX** — splat, dust, leaf burst, water spray, rope
   dust. Pooled, instanced.
3. **Music** — light exploration bed, discovery sting, legendary escalation.
   The sting hooks already exist as events.
4. **WebRTC transport** — the interface is done; this is signalling plus ICE.
5. **Prediction and reconciliation** for client-side fruit interaction. Clients
   currently see a round-trip delay on their own picks.
6. **Save/load round-trip test** through a real page reload.
7. **Mid-tier tools** — harpoon, portable winch, sticky anchor, bounce charge,
   large catch net. All are compositions of existing systems.
8. **Full Sunpatch content** — cave orchard interior, secret spawns, the rest of
   the landmark dressing.
9. **Weather and time** — day/night, wind events, rain surfaces. `TimeSystem`
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
