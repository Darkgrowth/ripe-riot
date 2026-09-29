# Sunpatch first expedition

This pass continues `d5ae411` on `codex/sunpatch-finish` from the latest adopted
Analyze Fishing Game brief. The original dirty checkout, its saves and the
5243 static preview were preserved. All browser work used isolated headless
contexts on 5244/5245.

## Delivered behavior

- A deliberately overloaded orchard crop warns on the first harvest action;
  the next distinct action releases physical fruit and wakes the local Mimic.
  Ordinary apples remain safe. Cleared sites stay cleared.
- Snapjaw guards real Puff Melons; the hillside Plum provides a rolling harvest
  beside Spitter. Solid geometry blocks seeds, including reflected seeds.
- Authored prizes, consumed fruit and cleared encounters survive saves and host
  migration without another prize or payment. Combat uses the existing timing,
  tools and host authority; the Air Cannon still costs $110 and is optional.
- Recovering players receive two seconds to move clear. Dock rest restores
  health; evacuation explains lost unsecured cargo and retained money/gear.
- The title, pause, controls, sound controls, saved results and separate replay
  slots frame the expedition. King Melon extraction leads to explicit E
  settlement at the dock boat. Sunpatch remains explorable afterward; the UI
  does not advertise an unfinished second island as playable.
- The existing orchard shoulder and hill-to-ravine path are graded below the
  climb limit. King Vine stands at the accessible worksite, with a visible root
  joining four ground-level vine ties. Starter-mallet combat and ordinary E
  cutting are possible without buying another tool. Original suspension anchor
  positions, melon floor and landing samples are preserved.
- Slow sequential vine cuts can swing the melon onto the northern ridge. A
  marked walking path behind the farm reaches it; the original melon can then
  be pushed downhill into a visible timber receiver. Ground-following amber
  marks replace the buried disk. Completion still uses the original extraction
  volume and now requires continuous settled contact. A lost submerged melon
  regrows after 25 seconds of game time, without repeating the guardian fight.

## Evidence and methods

[Authored harvest fixtures](harvest-sites/README.md) include real E input,
released-fruit restoration, normal sale and consumed-prize restoration. These
use fixture positioning and are distinct from the full ordinary-input run.

[Co-op log](coop.log) exercises real BroadcastChannel transport, reviving,
combat, harvest replication, settlement authority and migration. The fixture
deliberately sets some encounter/chapter states to isolate those edges.

[Shell log](shell.log) records title/pause/pointer lock, controls and sound,
replay/original slots and results layout. The results layout fixture injects
results; full expedition acceptance must earn them separately.

The normal expedition harness only reads state for navigation/telemetry and
uses keyboard/mouse actions. It does not teleport, grant equipment, set enemy
health or write progression. Earlier failures are retained in local capture
folders; they exposed the uphill route lip and inaccessible guardian placement.

## Acceptance status

| Check | Result |
| --- | --- |
| Offline regression suite | [279/279](offline.log) |
| Production scenarios | [20/20](production.log), including no-rope extraction, fruit physics and movement |
| Real host/client transport | [20/20](coop.log), including migration before settlement |
| Authored harvest runtime | [11/11](harvest-sites/runtime.log) |
| Title/pause/controls/sound/save slots/results | [Passed](shell.log) at 1720 x 720 |
| Production build and TypeScript | [Passed](build.log); existing large-chunk warning remains |
| Complete ordinary-input expedition | [26/26](ordinary-input-report.json), zero errors/warnings |
| Earned ending at native ultrawide | [3440 x 1440](gameplay/20a-earned-results-native-ultrawide.png), inspected |

[Independent integration review](integration-review.md) records actual
collision slopes and the inherited steep outer edge of the west walkout.
The guarded walkable core and painted hill route passed the geometry audit.
The new ridge path's actual collision slopes peak at 44.37 degrees across a
2.7 m walking corridor. The real receiver stops a 2600 kg Rapier sphere inside
the unchanged payout volume; a standing player capsule can walk beneath its
rails along the existing eastern exit.

## Complete ordinary-input run

Attempt 7 completed in 309.53 seconds on production `main-TnFu9DTZ`:
title/new replay, orchard warning and activation, starter-mallet Mimic fight,
physical prize carry and $163 sale, optional $110 Air Cannon purchase/use,
Snapjaw and its real crop, Spitter and the rolling Plum, starter-mallet King
Vine, four individually aimed E cuts, walking the marked ridge, physically
pushing the melon, $9500 extraction, walking back and E settlement at the dock.
Reload restored the settled chapter, subdued boss and cut vines. The final
$9883 balance did not change after another E press. All 26 acceptance fields
are true, with no console warnings or errors; synthetic input stayed disabled.
See the [full action log](ordinary-input.log) and [state report](ordinary-input-report.json).

The gameplay viewport was 1720 x 720. The same earned results and dock were
also captured and inspected at 3440 x 1440. Selected frames show the
[orchard warning](gameplay/03-suspicious-crop-warning.png),
[farm approach](gameplay/13c-walkable-hill-approach.png),
[guardian](gameplay/14-king-vine-arena.png),
[physical receiver](gameplay/18a-receiver-and-apron-from-rim.png),
[earned results](gameplay/20a-earned-results-native-ultrawide.png) and
[finished dock](gameplay/20b-earned-dock-native-ultrawide.png).
The full WebM remains locally at
`capture/sunpatch-expedition/normal-attempt-7/sunpatch-expedition.webm`.

After that run, the cut-label billboard was raised slightly to clear its gold
band. This only changes label placement. A separately labeled authoring fixture
verified all four real aim/range/LOS checks and the
[unobscured close-up](gameplay/cut-4-label-fixed.png); see
[cut-label-review.log](cut-label-review.log). The production build passes.

Earlier attempts remain locally for diagnosis. They exposed inaccessible
terrain, the original unreachable boss, and slow-cut ridge/water landings.
The [timed-drop diagnostic](slow-drop-fixture.json) seeds the guardian/player
pose and remains distinct from the complete ordinary-input proof.

The five-minute scripted route uses known destinations and state-assisted
navigation. It does not establish first-time human pacing, the intended
20-30-minute exploration experience, or subjective fun/visual approval.
