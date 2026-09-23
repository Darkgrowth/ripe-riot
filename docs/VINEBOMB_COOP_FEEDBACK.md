# Vinebomb co-op feedback follow-up

The Vinebomb at `(22, -56)` remains the small, repeatable shelf encounter. This
pass changes net outcome feedback only; it does not move the fruit, change the
catch window, loosen host ownership, or alter rewards.

- A fruit entering the hoop during the first 0.06 seconds of a swing is a
  provisional miss until that swing's active window has passed. Catching it
  cancels the miss; a real uncaught crossing still gives timing feedback and
  longer recovery.
- `CAUGHT` requires a successful local pickup. On a client it also waits for
  the host's pickup approval; a denial rolls back the predicted catch count.
- The same-machine two-page video run used normal keyboard/mouse movement and
  tool controls after initial position/equipment setup. It completed a net
  catch, role swap, deliberate missed interception, manual ground recovery,
  and both sales. The client showed one `CAUGHT`, zero `MISSED` for the first
  catch. Both peers ended at $844, from two $422 sales with no double payout.
- A separate fresh-save solo run passed 29/29 checks without any gameplay
  debug mutation: earn $462 by harvesting, buy the $380 Tree Shaker, reach the
  vine with normal movement, release, miss, recover, basket-stow, and sell the
  Vinebomb once. Its final balance was $504. The rim descent caused two
  recoverable knockdowns; whether that route is clear and enjoyable still
  needs a human playtest.

The video and evidence sheet are local ignored capture artifacts under
`capture/vinebomb-coop/`; the JSON report is `report.json` there. The solo
report is under `capture/vinebomb-solo/`. This proves
same-machine BroadcastChannel play, **not internet co-op**. Heavy-fruit net
deflection and ground-net slowing still require a host physics body; remote
clients do not authoritatively simulate those effects. Human co-op testing of
timing, sightlines, and feel remains necessary.
