# TestFlight — beta test information

The copy App Store Connect asks for when you distribute a build to testers, kept
here so it is version-controlled and consistent between builds rather than
retyped into a web form each time.

Everything in a fenced block below is meant to be pasted verbatim.

| | |
|---|---|
| App Store Connect app | `6801937647` |
| Bundle identifier | `com.omsinghan25.judgement` |
| TestFlight | https://appstoreconnect.apple.com/apps/6801937647/testflight/ios |
| Feedback email | `omsinghan25@icloud.com` — the same address as `PRIVACY.md`, so testers and Apple see one contact |

Where each block goes:

- **Beta App Description** and **Feedback Email** — TestFlight → *Test
  Information*. Set once; persists across builds.
- **What to Test** — attached to each individual build. Worth editing per build
  so testers know what changed.
- **Beta App Review Information → Notes** — asked when you submit an external
  testing group for Beta App Review. Internal testing skips review entirely and
  never asks for it.

Both long fields cap at 4000 characters; everything here is far short of that.

---

## Beta App Description

```
Judgement (also known as Kachuful) is a trick-taking card game for 2–8 players,
played online in real time.

Each round you're dealt a hand and asked one question: exactly how many hands do
you think you'll win? Bid too high or too low and you score nothing — only an
exact judgement pays. One suit is trump every round, and you must follow the lead
suit if you hold it.

• Create a game and share the 6-character code, or join a friend's
• 4 to 8 rounds — one more card dealt each round
• Trump follows the Kachuful rotation (Kari, Chukat, Falli, Lal) or is drawn at
  random, your choice
• Two scoring modes: 10 × your bid, or a flat 10 + your bid
• Add bots to fill a table, or play a whole game solo against them
• Drop off WiFi mid-game and your seat, hand and score come straight back

No account, no ads, no tracking. Played in landscape.

This is a beta — please report anything that looks wrong, especially on screen
sizes I haven't been able to try.
```

## What to Test

```
Thanks for testing! The fastest way in:

  Create Game → Add Bot ×3 → Start Game

That gives you a full 4-player game on your own, no second person needed.

Please try:
1. A complete game start to finish — bidding, playing every hand, the round
   scoreboard, and the final winner screen.
2. Playing with a real person. One of you taps Create Game and shares the code;
   the other taps Join Game and enters it.
3. Reconnecting. Mid-game, switch your phone from WiFi to mobile data. Your seat,
   your cards and the turn order should all come back on their own.
4. Different table sizes — a 3-player game and an 8-player one look quite
   different, and 8 is the one most likely to be cramped.
5. The How To Play screen (the ? on the home screen) — tell me if any rule is
   unclear or wrong.

What I most want to hear about:
• Anything cut off, overlapping, or sitting under the notch or home bar
• Buttons that are awkward to reach or hard to tap
• Anything that jumps or resizes while you're looking at it
• Sound: the ♪ button should mute music and effects together

When reporting, please include your phone model and which screen you were on.
A screenshot helps enormously.
```

## Beta App Review Information → Notes

Only needed for **external** testing. The first point is the one that matters:
this is a multiplayer game, and a reviewer with nobody to play against will
otherwise get stuck in the lobby and reject the build.

```
This is an online multiplayer card game, but it does NOT require a second person
to review. Bots are built in:

  Create Game → Add Bot (tap 3 times) → Start Game

That starts a complete, playable 4-player game.

No account, login or sign-up is required — the app asks only for a display name
on the first screen, which can be anything.

The game needs an internet connection to reach its server. If the game screen
does not load, please let me know rather than failing the build; the server is
live and monitored.

Orientation: landscape only, by design.
```

Also answer **Sign-in required: No** — there are no accounts, so there is no demo
account to supply.

---

## Before you distribute a build

1. **The server must be live**, and running the same code the build expects. The
   app is useless without it, and a reviewer will fail the build rather than
   report it:
   ```bash
   curl https://judgement-server-production.up.railway.app/health   # {"status":"ok",...}
   ```
   A green `/health` only proves the server is *up*, not that it is running the
   right revision — check Railway has deployed the commit your build was cut
   from.

2. **Rules must match between app and server.** Scoring is decided by
   `calculateScore` in `server/src/utils/cardUtils.ts`, but it is *printed* to
   the player by How To Play and the ⓘ on Game Settings. Ship a build whose text
   disagrees with the live server and testers will report the game as broken —
   correctly. See `DEPLOYMENT.md §7` for the release ordering.

   If you do distribute before the server catches up, say so rather than letting
   someone waste a report on it — for example:
   ```
   Known issue: with the "+1" scoring mode, making a bid of zero currently scores
   10 rather than the 11 shown in How To Play. Server-side fix already in flight.
   ```
   Delete that line once the server is deployed; a stale known-issues note costs
   you real bug reports, because testers stop trusting the list.

3. **A build expires 90 days after upload.** Old invite links stop working, which
   looks like a bug to whoever clicks one.
