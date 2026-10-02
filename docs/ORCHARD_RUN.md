# Orchard Run

This is the compact harvest-extraction prototype recommended by the latest **Analyze Fishing Game** conversation. It is a separate mode with its own saves and co-op channels.

## Play

Choose **Try Orchard Run · harvest & extract** from the Sunpatch menu, or add `?orchardRun=1` to the preview URL. Begin harvesting from the Orchard title.

The goal is to secure **$500 of actual produce** at the extraction crate. You can bank a small haul, keep harvesting after the target, or finish early. At the crate with empty hands and basket, press **E** to finish.

- **WASD / mouse / Space / Shift:** move, look, jump, sprint.
- **1:** hands and Mallet. **2:** Air Cannon. **3:** Catch Net. **4:** basket.
- **E:** pick fruit, shake a trunk, bank cargo, or finish at the crate.
- **Left click:** tool action or throw held fruit.
- **Right click:** stow held fruit, cannon hop, or lay a net.
- **Esc:** pause. **H:** hold for the existing stuck recovery.

## What changes

One compact grove replaces the expedition route. The clearing contains loaded apple/orange trees, Puff Melons, Gluefruit, Boulder Plums, a Mimic and a Snapjaw. There is no shop, boss or quest progression in this mode; all three tools start available.

Harvesting makes trouble. Violent tree shaking or unusual fruit detachment gives a brief rustling warning, then wakes the threats. With no further disturbance, they settle after 30 seconds. The crate's small safe apron heals players and keeps threats outside it.

Physical fruit can help: a moving Boulder Plum knocks and damages an enemy; Gluefruit interrupts and gums it temporarily; the Air Cannon redirects threats without an instant kill. Mallet interruption and Catch Net rescue remain available. Enemy defeat pays no money and contributes nothing to the extraction target.

Banked fruit appears in the bin and counts once in the shared crew ledger. Evacuation loses held/basket cargo while preserving banked value. Finishing saves the run; replay starts a separate slot. The original Sunpatch expedition remains accessible from the menu.

## Evidence and limits

See [the design](superpowers/specs/2026-10-01-orchard-extraction-design.md) and [implementation plan](superpowers/plans/2026-10-01-orchard-extraction.md). Browser-free checks cover authority, saved fruit, join/reconnect, warning/rest, crate boundaries and swept fruit contacts. Remote Linux checks use actual keyboard/mouse input for harvest, haul, bank, finish and reload.

The prototype is intended for a short human playtest before expanding the full expedition. Automated success does not establish fun, first-time readability, pacing, or hardware frame rate. Local browser automation is prohibited while the user may be playing Warcraft; the automated browser runs execute on isolated Linux runners.
