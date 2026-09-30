# RIPE RIOT shared desktop

The user may be playing the game on this Windows desktop while Codex works.
During an active play session, keep their game tab and physical cursor untouched.

- Use an isolated worktree and port for code work.
- Do not run Playwright, CUA, or other browser or desktop input automation,
  including headless tests that click, move a mouse, or request pointer lock.
- Do not run `npm test` during active play; its scenario driver launches a
  browser. Use browser-free `node --test` checks and `npm run build` instead.
- Resume browser input on this Windows desktop only when the user explicitly
  says their play session is over. A request to "resume" project work does not
  mean play is over. A separate port or headless browser did move and box the
  real cursor on this machine.
- Browser gameplay checks may instead run on an isolated remote Linux runner
  with no access to this desktop. Keep the local session browser-free while
  the user is playing, and bring back its screenshots, video, and reports.
