# RIPE RIOT — Game Design

**Harvest increasingly impossible fruit with increasingly unreasonable
equipment.**

1–4 player first-person co-op physics adventure. The joke is four people using
borderline industrial equipment to pick fruit, and the design test for any
feature is whether it makes players more likely to say *"we absolutely did not
need to do it that way… but I'm glad we did."*

## Pillars

HARVEST · PHYSICS · CHAOS · PROGRESSION · DISCOVERY · CO-OP

A feature that improves none of these does not go in. This is explicitly **not**
a farming sim: there is no planting, watering, fertiliser or time-gated growth.
Fruit exists; getting it down and getting it home is the entire game.

## Core loop

Explore → find fruit → work out how to detach it → control its physics →
recover it → return it to the dock → sell → buy better equipment → reach harder
harvests → find rare variants → complete the island legendary → next island.

Players should be in the world, not in menus. The shop is a physical counter you
walk to.

## What is implemented today (vertical slice)

### Movement
First person, 5.4 m/s walk, 8.4 sprint, 2.7 crouch, ~1.3 m jump with coyote time
and jump buffering, short-hop cut, ladder climbing. Deliberately no stamina.

Hard impacts ragdoll the player into a six-body articulated tumble that recovers
on its own in about a second. Ragdoll is comedy, never punishment: it cannot
strand you, cannot lose your basket, and has a divergence guard that stands you
back up if the physics ever misbehaves.

### Fruit
Data plus reusable traits, never a subclass per species. Seven species in the
slice:

| Fruit | Size | Mass | The rule it teaches |
|---|---|---|---|
| Apple | 0.34 m | 1.1 kg | picking, selling, quality |
| Orange | 0.32 m | 1.0 kg | round things roll, and keep rolling |
| Coconut | 0.40 m | 3.4 kg | gravity does the harvesting, and it hurts |
| Banana Bunch | 0.62 m | 2.6 kg | long awkward objects fit nowhere |
| Watermelon | 0.80 m | 22 kg | detaching is the easy half |
| Puff Melon | 0.56 m | 1.9 kg | it inflates ×3.1 and the wind takes it |
| Vinebomb | 0.48 m | 3.6 kg | the vine is a catapult |

Traits in the registry: `heavy`, `roller`, `splitter`, `inflate`, `elastic`,
`unstable`, `volatile`, `sticky`. Later islands' fruit (Magnapple, Ice Plum,
Gravity Gourd, Phase Berry) are trait work, not new systems.

**Quality** is Perfect / Good / Bruised / Damaged / Ruined, driven by velocity
actually lost on impact against a per-species tolerance. Deliberately generous:
an apple shrugs off a four-metre drop, a watermelon objects to two metres and
bursts past about nine. Ordinary chaos should cost a little; only genuinely
awful handling wipes the value out. Perfect is a *bonus* (×1.55), not the
baseline.

**Rare variants** (5.5% of spawns): Huge, Tiny, Pale, Black, Glowing, Ancient,
Unstable, Golden. They change size, mass, fragility, tint and value — a Huge
Coconut weighs 83 kg and sells for around $790.

### The basket rule
One fruit in your hands. Picking another automatically stows the first *if it
fits* — nine items, nothing over 6.5 kg. That single threshold is what turns a
watermelon from "an apple worth more" into a logistics problem, and it is why
the Deep Basket upgrade matters.

### Carry states
How a fruit is held is a function of how big and how heavy it actually is, and
the four states are mutually exclusive — the equipped tool is always put away
while something is in your hands.

| State | Up to | Reads as |
|---|---|---|
| **Small** | 0.46 m / 4.5 kg | Held low and to the right, one hand under it. Apple, orange, coconut. |
| **Medium** | 0.72 m / 12 kg | Two hands, lower and further from the eye. Banana bunch, deflated Puff Melon, Vinebomb. |
| **Large** | 1.10 m / 60 kg | A haul: centred, low, heavy, and it slows you down. Watermelon, Huge Coconut. |
| **Oversized** | above that | Cannot be carried at all. |

**Oversized fruit is a haulage problem.** A fully inflated Puff Melon (1.74 m),
a Huge Watermelon (1.30 m, 374 kg) and an Ancient anything cannot go in your
hands. They can be shoved (E leans on them, above the centre, so round ones
roll), roped, netted, or fired home with the air cannon — and fruit that comes
to rest on the sell pad sells itself, so herding one downhill into the drop-off
is a legitimate and very slow strategy.

**The Puff Melon is the joke this rule exists for.** It carries fine while
deflated. It then inflates in your hands, going medium → large as you watch,
and the moment it passes 1.10 m it bursts free upward and takes the wind. You
are not robbed of it — it is a physics object two metres in front of you, and
everything you own can still catch it. You just cannot hold it any more.

### Tools
Three active slots plus one utility slot. The constraint is the point: with
everything available at once nobody has to decide what to bring, and nobody has
to shout at a teammate to bring the other thing.

- **Hand Picker** (start) — pick, charge-throw, stow
- **Basket** (start, utility) — nine small fruit, or tip them all out
- **Ladder** (start, utility) — placeable, climbable
- **Catch Net** ($260) — click to swing as the fruit arrives. The hoop only
  catches through the middle of the swing, so it is a timing call: too early
  or too late whooshes, droops, and costs a recovery; holding the button
  flails. The ring glows as something catchable closes on it, which is the
  cue. Right-click lays a ground net that softens whatever lands in it
- **Tree Shaker** ($380) — one trunk hard, or everything nearby gently
- **Rope Gun** ($720, tier 1) — tether, pin the near end, winch
- **Air Cannon** ($1,450, tier 2) — charged blast that launches fruit, shakes
  trees and shoves you backwards; right-click fires down to launch yourself

Tools combine systemically rather than by script. A Vinebomb fired by an air
cannon into a catch net scores three stunt bonuses without a line of code naming
that combination.

### Stunt harvesting
Scored from the physical record every fruit already keeps — distance travelled,
peak height, bounces, whether it ever touched the ground, how many ropes are on
it. Bonuses stack multiplicatively into the sale price.

MID-AIR HARVEST · PERFECT LANDING · LONG HAUL · RICOCHET · FOUR-WAY TETHER ·
ZERO DAMAGE · HILL RUNNER · SKY PICK · ONE SHOT · CHAIN REACTION · LAST SECOND ·
AIR FREIGHT · FRUIT FLIGHT

### Economy
One currency. Fruit value = species × size^1.5 × variant × quality × stunts.
A second axis, **Discovery Tier**, gates equipment on new species and rare
variants found, so grinding apples cannot buy an air cannon. No crafting
materials.

### Harvest Book
Per species: discovered, harvested, lost, largest, smallest, most valuable, best
quality, best stunt multiplier, longest haul, variants seen. Undiscovered
entries show only a habitat hint. Records are what make a player have an opinion
about a coconut.

### Island 1 — Sunpatch
Compact authored island, ~260 m across. Dock (spawn), Shop Shed, Old Orchard,
Palm Beach, Waterfall Basin, Hill Farm, Cave Orchard, High Ridge, The Ravine.
113 plants, 458 fruit at start, regrowing on a 95–190 s timer.

### Legendary — THE KING MELON
Visible from most of the island from the first minute, which is the point.
Explicitly not a health bar; every phase is a physical problem.

1. **PREPARE** — you need a rope gun
2. **TETHER** — restrain it; each rope bleeds off the fall
3. **DETACH** — cut four vines; each cut shifts the load onto the rest
4. **DROP** — 2,600 kg falls 20 m at 20 m/s. Enough tethers and it lowers under
   control; too few and they part
5. **RECOVER** — get it to the extraction pad, downhill along the ravine
6. **PAYOUT** — $9,500 plus a bonus per tether used

Solo runs the same problem on a reduced tether requirement, not a separate
script. Failure is soft: if it goes in the sea it regrows.

## Failure and friction

Knocked out → get up. Fruit destroyed → lose its value, it regrows. Equipment →
never lost. No permanent inventory wipes, no permanent team-killing, no
griefing that deletes progression.

## First 30 minutes (target)

0:00 arrive by terrible boat, read a sign that says PICK FRUIT / SELL FRUIT /
BUY BETTER STUFF · 0:02 pick apples · 0:04 sell them · 0:05 buy something ·
0:08 reach the palms, someone gets flattened · 0:12 find a watermelon, drop it,
learn what quality means · 0:15 buy the catch net · 0:18 a Puff Melon inflates
and leaves · 0:20 chaotic chase, mid-air recovery, STUNT BONUS · 0:25 see the
King Melon over the ravine and understand the rest of the game.

## Deferred (designed, not built)

Islands 2–5 (Gale Grove, Red Rind, Cold Crop, Oddgarden) and their legendaries;
boat progression and cosmetics; weather and day/night beyond a wind vector;
random events; secrets and collectibles; achievements; the mid/late tool tiers
(harpoon, winch, vacuum, repulsor, rocket net, impulse mortar). See ROADMAP.md.
