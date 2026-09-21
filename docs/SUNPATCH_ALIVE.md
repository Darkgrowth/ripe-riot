# Sunpatch: harvest activity integration

## Delivery location

Current implementation is staged in `J:\RIPE-RIOT-staging\sunpatch-alive`. The user's running game at port 5188 and its source tree are intentionally untouched during this continuation. Port 5193 serves an isolated production preview; port 5192 serves staging development. Do not switch, reload, resize, unlock, or take focus from the user's game to review this work.

This is a technical implementation candidate, not a claim of commercial readiness. The remaining acceptance work is listed below and in `SUNPATCH_PLAYTEST_KIT.md`.

## Implemented

- Measured, wrapped sign text, blank board backs and supports behind lettering. Direction arrows checked against destination projections from their actual sign transforms. Slatted dock/shop/orchard crates, supported decorative fruit, grounded ladder/cart/barrow feet, corrected dock basket contents and lantern mounts. Hill sorting trays, spare tray rack and hanging hook have visible support. Merv's awning is raised and the main board sits ahead of the weighing beam; his face and the lettering are clear. The shop's side crate clears its neighboring barrel, with the collider moved to match.
- Original 48-bar, 96 BPM, 120-second instrumental composition: plucked melody, warm bass, quiet flute answers and wooden percussion. Three rendered OGG layers share one audio-clock epoch and crossfade on bar boundaries. Warning/result cues briefly lower music. King Melon active phases select the build and completion triggers its payoff. Editable composition/renderer: `tools/audio/render_score.py`; composition data: `public/audio/score.json`.
- Persistent master/music/effects/ambience controls, one master mute route, gesture unlock, visibility suspension handler, localized surf/waterfall/foliage, dock/shop sounds, distinct fruit/coconut/wood/rope/tool effects, bounded and cleaned-up voices.
- Host-owned Windfall and Coconut Forecast: eight-second warning, marked/swaying trees, staggered detachment of existing fruit, followed by time to collect. Seeded later selection and 120–180 second quiet periods. First accepted local or remote pickup arms the introductory Windfall near the orchard.
- Rush orders count accepted real fruit sales. First order: six apples/oranges, 90 seconds, $60 bonus. Later net-equipped order: four coconuts, 120 seconds, $120 bonus. Normal sale values remain; expiration removes no money or equipment. Reward is latched before payment.
- One low-poly gull, physical bounded peck toward its visible cache, safe fruit eligibility, player/pickup/rope/pad exclusions, 45-second cooldown, expressive flight/head/wings and squawks. The host alone applies the impulse.
- Merv behind the existing counter, twelve contextual lines with short vocalizations, greeting/work/sale/warning/duck animations, 30-second commentary cooldown and no session repeats.
- A real input defect discovered during the normal-input recording is fixed: selling with E no longer opens the shop on that same press and releases pointer lock. A separate empty-handed E press still opens the shop.
- Event state, targets, release cursor, order counted IDs/payment latch and gull state participate in existing host snapshots. Disk save keeps progression/cooldowns but clears transient events with a grace period. Systems register before multiplayer/save initialization. Generic network presentation messages cannot inject authoritative sale events.

## Evidence and limits

The affected automated checks use the actual gameplay tick and physics. Numerical runs suppress only the final GPU draw to avoid competing with the user's active game; they are not frame-rate or visual evidence.

- `capture/alive/qa/island-multiplayer.json`: 202/202 checks across eleven real BroadcastChannel late-join and host-departure fixtures, including client-only introduction/gathering and forged-sale rejection. No manual snapshot/promotion substitution.
- `capture/staging-qa/island-events-preview.log`: initial integrated scenario 43/43; subsequently extended with a real four-coconut order.
- `capture/staging-qa/island-characters-offline.json`: 20/20 CPU character rules/lifecycle checks, including exceptional-sale batch commentary. Mock physics tests do not replace real transport fixtures.
- `capture/zone-repair/qa/props-offline.json`: fourteen measured sign layouts, fifteen recorded ground contacts and eight orchard fruit floor contacts. CPU font metrics are conservative fixtures; screenshots remain required.
- `public/audio/verification.json`: decoded durations, peaks and seams. These establish file/grid integrity, not subjective mix quality.
- Full gameplay regression: 11/11 scenarios, 378 reported checks. Existing multiplayer: 127/127. Host migration: 163/163 across three loose-fruit passes and the legendary. The subsequent targeted harvest rerun passes 28/28 including two new same-press sale/browse assertions. Detailed build chronology and raw logs are in `STAGING_NUMERICAL_QA.md`.
- Additional remote-blast transport check: 14/14. Workstation supports: 4/4; side collision rays: 64/64; actual rope catch/pin/release and 3/3 shop/hill/beach approach walks passed.
- `capture/alive/visual/review.html`: final rendered inspection gallery, including both reported defect locations, fourteen sign faces, fourteen normal approaches, eleven straight rear views plus Merv's exterior side-lane rear view, and props/residents/event fixtures. Wanted/side-shop backs are building-facing; the invalid central Merv rear pose is excluded and replaced by the valid exterior oblique inspection. Authored cameras and forced event fixtures are labeled; these are not a normal-input session.
- Audio offline checks cover the synchronized score, warning duck, restored legendary build, controls, persistence, voice cleanup and eight spatial crate contact cases. Actual fruit impacts touching a collidable crate layer a wooden knock. The mocked visibility check does not certify real hidden-tab behavior.
- Final typecheck and production build pass (`index-CuK91byB.js`). Vite still reports the existing large bundle warning.

The uninterrupted normal-input service route completed ten minutes with every tracked beat and no runner failures. It observed its first Windfall warning at 1:23, first sale at 2:52 ($114), naturally scheduled rush order at 4:41 and successful order at 5:05. The $60 bonus was paid alongside real sale value; normal harvesting resumed at 5:47. A second Windfall occurred at 7:38. Ten real gull pecks occurred; final money was $299. These are one automated route's observations, not a human fun result. Earlier recordings and their reports are retained, including the same-press shop defect and a missed navigation waypoint. No forced event is substituted for a missing natural event.

Session evidence: `capture/staging-qa/normal-input-service-route/review.html`, `report.json`, `timeline.jsonl`, `session.mp4`, and `gameplay-audio.mp3`. The final MP4 is 600.25 seconds, H.264/AAC, with the actual post-master gameplay mix. The raw MediaRecorder WebM is retained; its Opus parser warnings prompted a standard MP4/MP3 export. Both delivered formats were decoded in full with zero decoder errors. Video was normalized to 8 fps without cuts or gameplay edits. Audio measured mean -30.2 dB and peak -12.1 dB; metering is not a listening verdict.

The recording uses 320×180 software rendering to avoid competing with the user's live game. Its video captures the world canvas; nineteen timestamped screenshots also include the DOM HUD, which is cramped at this deliberately tiny test resolution. The runner uses ordinary keyboard/mouse inputs and read-only navigation assistance, not human route discovery. It is neither visual-quality nor hardware-performance acceptance.

## Handoff without disrupting live play

`handoff/manifest.json` records changed files and both source/destination hashes. `tools/Apply-StagedSunpatch.ps1` defaults to a read-only listing. Its explicit `-Apply` mode validates every hash, backs up replaced files and copies the staged changes. It has **not** been applied. Copying source may trigger Vite reload, so leave the live project untouched until the active play session ends. It never controls browser windows, server processes or saves. Capture evidence remains in the staging directory.

## Acceptance still to close

Rendered scene review and regression reports are available above. Explicitly outstanding until corresponding evidence exists:

- Five minutes of actual 1080p RTX 4070 Ti gameplay timing, target p95 <=16.7 ms, without concurrent competing gameplay. Deferred while the user is playing.
- Real hidden-tab suspension validation without taking focus from the user; previous automation did not produce a hidden page.
- Human headphone and modest-speaker listening.
- Five outside first-session playtests. No participants or audience results have been fabricated.

Internet transport and proximity voice remain outside this pass. The implementation supports solo and existing local co-op.
