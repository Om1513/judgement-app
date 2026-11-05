# App Store — product page copy and asset plan

The copy and creative plan for the public App Store listing, kept here so it is
version-controlled and consistent between versions — the same philosophy as
`TESTFLIGHT.md`, which covers the TestFlight-only fields.

Everything in a fenced block is meant to be pasted verbatim into App Store
Connect → the app → **App Store** tab → the version page.


|                       |                                                           |
| --------------------- | --------------------------------------------------------- |
| App Store Connect app | `6801937647`                                              |
| Bundle identifier     | `com.omsinghan25.judgement`                               |
| Category              | Games → Card (secondary: Games → Strategy)                |
| Orientation           | Landscape only — screenshots must be landscape too        |
| Privacy Policy URL    | host `privacy.html` / `PRIVACY.md` per `DEPLOYMENT.md §7` |


Character limits that matter: **Name 30**, **Subtitle 30**, **Promotional Text
170**, **Keywords 100** (comma-separated, no spaces needed), **Description
4000**. Counts below are all within limit.

---



## Name (30 chars max)

```
Judgement — Kachuful Cards
```

26 characters. Leads with the brand, and gets the game's other common name into
search without burning keyword budget — words in the Name rank highest in App
Store search.

## Subtitle (30 chars max)

```
Bid exactly. Win together.
```

26 characters. States the core mechanic (exact bidding) in the player's own
terms rather than describing the app.

## Promotional Text (170 chars max)

Editable *without* a new build — after launch, use it for whatever is newest.
For the initial release, pitch the whole game:

```
The classic trick-taking game of exact bids, now online. Create a game, share
one code, and play with 2–8 friends — or add bots and play right now.
```



## Description (4000 chars max)

```
How many hands will you win this round? Say a number. Now prove it.

Judgement — known across South Asia as Kachuful — is a trick-taking card game
with one twist that changes everything: you only score if your bid is EXACTLY
right. Win more hands than you promised, or fewer, and you get nothing. Every
round becomes a small act of self-knowledge.

PLAY WITH ANYONE, ANYWHERE
• Create a game and share the 6-character code, or join a friend's in seconds
• 2 to 8 players, online in real time
• No account, no sign-up — type a name and play
• Add bots to fill empty seats, or play a full game solo against them

THE GAME
• 4 to 8 rounds — one more card dealt each round, so every round raises the
  stakes
• One suit is trump every round: follow the classic Kachuful rotation
  (♠ Kari, ♥ Chukat, ♦ Falli, ♣ Lal) or draw trump at random
• You must follow the lead suit if you hold it — reading what's left in other
  players' hands is the whole art
• Two scoring modes: 10 × your bid, or a flat 10 + your bid

BUILT FOR REAL LIFE
• Drop off WiFi mid-game and your seat, hand and score come straight back
• A clear round-by-round scoreboard, so arguments are settled by the app
• In-game How To Play guide — teach a new player at the table in two minutes
• Designed for landscape, with music and effects you can mute with one tap

PRIVATE BY DESIGN
No ads. No tracking. No analytics. No account. The app knows your display name
and nothing else about you.

Whether you learned Kachuful from your grandparents or you're discovering
trick-taking games for the first time: shuffle up, say your number, and stand
by it.
```

(~1,550 characters — well inside the 4000 limit, with room to grow.)

Policy notes baked into the copy above (App Review Guidelines §2.3 and the
asset guidance): no pricing, no URLs, no awards or unverifiable claims, no
mention of other platforms, nothing above a 4+ rating.

## Keywords (100 chars max)

Do **not** repeat words already in the Name or Subtitle (judgement, kachuful,
cards, bid) — Apple indexes those fields separately and duplicates waste the
100 characters.

```
trick,taking,judgment,oh hell,callbreak,multiplayer,trump,online,friends,party,desi,indian,bluff
```

97 characters.

## Support URL

Use the repo's GitHub Pages site or the repository itself, e.g.
`https://github.com/Om1513/judgement-app`. Must be a live page with a way to
contact you — `omsinghan25@icloud.com` is the address used everywhere else
(`PRIVACY.md`, TestFlight), keep it consistent.

---



## Screenshot plan

Required sizes (landscape, because the app is landscape-only):


| Device      | Pixels (landscape)           | Required?                      |
| ----------- | ---------------------------- | ------------------------------ |
| iPhone 6.9" | 2868 × 1320 (or 2796 × 1290) | Yes                            |
| iPad 13"    | 2752 × 2064                  | Yes — `supportsTablet` is true |


Up to 10 per device; the **first three** are what shows in search results for
landscape, so they must stand alone. Capture from the Simulator
(`⌘S` saves a correctly-sized PNG) or a real device, running the **production
build** — reviewers compare screenshots against the live app (§2.3 again).

Order tells a story: hook → core loop → social proof of the experience.

1. **Game table, mid-hand, 4 players** (`GameTableScreen`) — the money shot.
  Cards fanned in hand, a trick in progress on the table, trump visible.
   Overlay: `Win exactly what you bid — no more, no less`
2. **Bidding screen** (`BiddingScreen`) — the moment of judgement.
  Overlay: `How many hands will YOU win?`
3. **Lobby with code showing** (`LobbyScreen`) — the social hook, now with the
  new settings panel visible.
   Overlay: `Share one code. Friends drop straight in.`
4. **8-player table** — show the game at full size; it's the most visually
  impressive state. Overlay: `2 to 8 players, online in real time`
5. **Round scoreboard** (`ScoreboardModal`) — exact bids paying off, a zero for
  someone who missed. Overlay: `Only an exact bid scores`
6. **Bots in the lobby** — Add Bot in action.
  Overlay: `No one around? Bots are always up for a game.`
7. **Winner screen with confetti** (`FinalWinnerScreen`) —
  Overlay: `Settle it once and for all`
8. **How To Play** (`HowToPlayScreen`) —
  Overlay: `New to Kachuful? Learn in two minutes.`

Overlay text rules from the asset guidance: short phrases that *enhance* the
visual rather than describe it, legible at search-result size, kept inside a
safe area (nothing within ~8% of any edge), and localized if we ever localize
the app. Keep one consistent font/color treatment across all ten — ideally the
Bangers/Inter pairing and palette the app itself uses, so the listing and the
product feel like one thing.

What **not** to show: debug UI, a half-empty lobby that looks dead, placeholder
player names like "test" or "asdf" (use real-looking names — Priya, Marcus,
Aiko, Dev…), or any screen state the shipping build can't reach.

## App preview video (optional, up to 3 × 15–30s)

Worth doing for v1.1 rather than blocking v1.0. When you do:

- **Real captured UI only** — Apple rejects previews that are mostly motion
graphics. Record with the Simulator or `xcrun simctl io booted recordVideo`.
- First 3 seconds: a card being played onto the table (the new fly-to-table
animation from PR #17 is exactly the hook this wants).
- Story arc: join via code → bid → play a trick → scoreboard with an exact bid
paying. Beginning, middle, end.
- Must work **muted** (previews autoplay silently) and **loop cleanly** —
end on the scoreboard, cut back to the opening deal.
- Poster frame: the mid-trick table shot, same as screenshot 1.



## App icon

Already shipped (`assets/logo_kachuful.png`). Two upgrades to consider, not
blockers: check legibility at Spotlight size (~60 px), and build a layered
Liquid Glass version with **Icon Composer** so it gets the iOS 26+ treatment.

---



## Remaining App Store Connect form answers

- **App Privacy**: collects **Name** and **User ID** (the random device play
id) → linked to the user? **No** (it's a random id, not identity) → used for
tracking? **No**. Everything else: not collected. Matches `PRIVACY.md`.
- **Age rating questionnaire**: no to everything (no gambling with real money,
no violence, no mature themes) → lands at **4+**.
- **Sign-in required**: No.
- **App Review notes** — reuse the block from `TESTFLIGHT.md` (§Beta App Review
Information). The bots instruction is the single most important sentence in
the whole submission:
  ```
  Multiplayer is solo-testable: Create Game → Add Bot (tap 3 times) → Start
  Game. No account or sign-in exists. The app requires internet to reach its
  server, which is live and monitored.
  ```
- **Release option**: Manually release this version — for v1.0, approve first,
confirm the server one last time, then press the button yourself.



## Pre-submission checklist

1. Server live **and** on the same commit as the build (`DEPLOYMENT.md §7`,
  `TESTFLIGHT.md §Before you distribute`).
2. Screenshots taken from the build being submitted, not an older one.
3. Privacy Policy URL resolves publicly (open it in a private browser window).
4. How To Play text agrees with live server scoring.
5. Keep the server up for the entire review window — a reviewer who can't
  reach the lobby rejects the build.

