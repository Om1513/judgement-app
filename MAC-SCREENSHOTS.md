# Mac runbook — Simulator setup and App Store screenshots

What to do on a Mac to produce the App Store assets this project needs. A Mac
is **not** required for anything else in the pipeline — EAS builds in the
cloud, `eas submit` uploads to TestFlight, and the server runs on Railway. The
Simulator screenshots (and the optional app preview video) are the only
Mac-shaped hole.

What to shoot and the copy that goes with it live in `APPSTORE.md`; this file
is purely the *how*.

---

## 0. One-time setup (~1 hour, mostly downloads)

1. **Xcode** — Mac App Store → search "Xcode" → install. Open it once; when it
   asks which platforms to add, tick **iOS** — that is what installs the
   Simulator.
2. **Node, git, and the project** — in Terminal:

   ```bash
   # Homebrew, if the Mac is fresh
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   brew install node git

   git clone https://github.com/Om1513/judgement-app
   cd judgement-app
   npm ci
   npm install -g eas-cli
   eas login        # omsinghan25 — the same account as everywhere else
   ```

## 1. Build the app for the Simulator (cloud build, ~15 min)

```bash
eas build --profile simulator --platform ios
```

The `simulator` profile in `eas.json` produces a Simulator-only `.app` pointed
at the **live Railway server**, so it behaves exactly like the shipping app.
When the build finishes, the CLI asks **"Install and run on a simulator?" —
say yes**; it boots a simulator and launches Judgement.

To install on additional simulators: download the build artifact
(`.tar.gz`), unzip it, and drag `Judgement.app` onto each simulator's window.

## 2. Boot the two devices the App Store requires

Simulator menu → **File → Open Simulator →**

| Device | Covers | Screenshot pixels (landscape) |
|---|---|---|
| iPhone 17 Pro Max (or 16 Pro Max) | iPhone 6.9" slot | 2868 × 1320 |
| iPad Pro 13-inch (M4) | iPad 13" slot | 2752 × 2064 |

Both sets are **mandatory** — the iPad set because `app.json` has
`supportsTablet: true`. Rotate to landscape with **⌘→** (the app forces
landscape anyway).

## 3. Clean the status bar

Run once per booted simulator (use the device's name instead of `booted` if
several are running):

```bash
xcrun simctl status_bar booted override \
  --time "9:41" --batteryState charged --batteryLevel 100 \
  --cellularBars 4 --wifiBars 3
```

`xcrun simctl status_bar booted clear` undoes it.

## 4. Stage and shoot

**⌘S** in the Simulator saves a pixel-perfect PNG to the Desktop — no
resizing needed. Work through the 8-shot plan in `APPSTORE.md`
(§Screenshot plan), and repeat **every** shot on the iPad.

Staging tips:

- **Human-looking lobbies** — run both simulators at once: create the game on
  the iPhone, join from the iPad (and/or a real phone on TestFlight) with
  names like *Priya*, *Marcus*, *Aiko*. Never ship a shot full of
  `Bot 1, Bot 2, Bot 3` or names like `test`/`asdf`.
- **The mid-trick hero shot** — play a solo bot game until a visually rich
  moment: cards on the table, a good hand fanned out, trump visible. Then ⌘S.
- **Scoreboard shot** — you want an exact bid paying off next to someone
  else's zero, so the scoring rule is visible at a glance.
- Screenshots must come from the build being submitted (App Review
  Guidelines §2.3) — rebuild with the `simulator` profile after any UI change.

Optional text overlays (the captions in `APPSTORE.md`) can be added afterwards
in Figma or a screenshot tool; raw screenshots are also perfectly acceptable.
Keep any text center-safe and use the app's own Bangers/Inter fonts.

## 5. App preview video (optional — fine to defer to v1.1)

```bash
xcrun simctl io booted recordVideo preview.mov    # Ctrl-C to stop
```

or Simulator → File → Record Screen. Requirements and the story arc are in
`APPSTORE.md` (§App preview video): real UI only, works muted, loops cleanly,
15–30 seconds.

## 6. Upload

App Store Connect → Judgement (`6801937647`) → **App Store** tab → the 1.0
version → drag the PNGs into the **iPhone 6.9"** and **iPad 13"** slots. The
first three are what search results show — order them per the plan. Then fill
in the rest of the version page straight from `APPSTORE.md`.

---

## Bonus — other things a Mac unlocks (none urgent)

- **Day-to-day dev in the Simulator**: `npx expo start --ios` instead of
  waiting on EAS builds.
- **Transporter.app** — manual `.ipa` upload fallback if `eas submit` ever
  misbehaves.
- **Icon Composer** — the layered Liquid Glass app icon suggested in
  `APPSTORE.md` (§App icon).

Total time once Xcode is installed: the EAS build runs unattended for ~15
minutes, then a focused screenshot session is about an hour for both devices.
