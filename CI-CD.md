# Testing, CI and CD

How this repository is validated, what runs where, and what is still missing.

Everything CI does can be run locally with one command:

```bash
npm run ci     # lint -> typecheck -> unit tests -> integration tests -> build
```

---

## 1. What this repository actually is

Not a monorepo and not a workspace setup — **two independent npm packages that
happen to live in one git repository**, each with its own `package-lock.json`:

| | Root (`/`) | `server/` |
|---|---|---|
| What | Expo / React Native app (iOS, Android, web) | Node game server |
| Language | Plain JavaScript + JSX (no TypeScript) | TypeScript, strict |
| Entry | `index.js` → `App.js` → `src/navigation/AppNavigator.js` | `src/server.ts` |
| Realtime | `socket.io-client` (`src/services/socket.js`) | `socket.io` (`src/socket/*`) |
| Data | none — the server is authoritative | Prisma → PostgreSQL |
| Build | Metro / Expo (`expo export`) | `tsc` |
| Deploy | EAS build & submit | Docker → Railway |

The architecture is **backend-authoritative**: the client renders state and sends
intents; every rule (legal card, bid validity, trick winner, score) is decided
and persisted server-side. The client mirrors only the follow-suit rule, to grey
out unplayable cards — see [`src/utils/cardRules.js`](src/utils/cardRules.js).

Package manager is **npm**, and it stays npm. Because there are two lockfiles,
the root exposes delegating scripts so nobody has to remember which directory to
be in:

```bash
npm run bootstrap   # npm ci in both packages
npm run lint        # both
npm run typecheck   # both
npm test            # both
npm run build       # both
```

---

## 2. Commands

### Root

| Command | What it does |
|---|---|
| `npm run bootstrap` | `npm ci` for the app and the server |
| `npm run lint` | ESLint across app, server, tests and config |
| `npm run lint:fix` | Same, applying fixes (**local only** — never in CI) |
| `npm run typecheck` | `tsc --noEmit` for the root and for `server/` |
| `npm run test:unit` | App tests (Jest) + server game-rule tests |
| `npm run test:integration` | Server suites against a real Postgres, incl. Socket.IO |
| `npm test` | `test:unit` then `test:integration` |
| `npm run test:coverage` | Coverage for both packages, with thresholds |
| `npm run build` | Compile the server, then bundle the app for web |
| `npm run validate` / `npm run ci` | The whole pipeline, in CI order |

### App only

`npm run test:app`, `npm run test:app:watch`, `npm run test:app:coverage`

### Server only (from `server/`)

`npm run build`, `npm run build:prod`, `npm run typecheck`, `npm run test:unit`,
`npm run test:integration`, `npm run test:coverage`, `npm run db:test:up`,
`npm run db:test:down`

---

## 3. Test layout

```
src/                                    # the app
  utils/__tests__/cardRules.test.js     # client mirror of the follow-suit rule
  utils/__tests__/seating.test.js       # table seat rotation
  components/__tests__/GameButton.test.js
  components/__tests__/GameSettings.test.js     # rounds / trump order / scoring controls
  components/__tests__/PlayerCard.test.js       # lobby row, host-only remove
  components/__tests__/PlayerNameInput.test.js

server/src/tests/
  helpers/db.ts             # test-database guard, truncation, teardown
  helpers/gameFlow.ts       # fixtures + drivers that go through the real services
  helpers/random.ts         # seeded Math.random, so "random" is reproducible
  helpers/socketHarness.ts  # real server + real socket.io clients

  unit/                     # no database, no I/O, pure rules
    scoring.test.ts         bidding.test.ts     rotation.test.ts
    trump.test.ts           lobbyCode.test.ts   bots.test.ts
    cardValidation.test.ts  lobbyValidation.test.ts
    trickWinner.test.ts     deck.test.ts        corsOrigin.test.ts
    perf.test.ts

  integration/              # real Postgres, real services, real sockets
    schema.test.ts          # empty database -> schema -> a playable game
    lobby.test.ts           bidding.test.ts     scoreboard.test.ts
    gameStart.test.ts       gameplay.test.ts    completeGame.test.ts
    bots.test.ts            restApi.test.ts     socket.test.ts
```

**Frameworks.** The server uses Node's built-in test runner (`node --test`) —
which is what it already used, and it keeps the server's dependency footprint at
zero test packages. The app uses **Jest** via `jest-expo` with
`@testing-library/react-native`, which is the supported path for an Expo app.

There is no snapshot testing anywhere. A stored render tree of an animated,
gradient-heavy card says nothing useful when it changes and breaks on every
colour tweak.

---

## 4. The test database

Integration tests never touch a development or production database.

**Resolution order** (`server/scripts/test.mjs`):

1. `TEST_DATABASE_URL` if set — CI points this at its Postgres service container.
2. Otherwise a throwaway container from `server/docker-compose.test.yml`, started
   on demand, on port **55432** so it cannot collide with a local dev Postgres,
   with `tmpfs` storage so the data dies with the container.

**Guards.** The runner refuses to proceed unless the database *name* contains
`test`, and unless the host is local (`ALLOW_REMOTE_TEST_DB=1` overrides the
second, deliberately awkwardly). `server/src/tests/helpers/db.ts` repeats the
name check inside the test process, for anyone who bypasses the runner. This
matters because the next step drops everything.

**Schema from empty.** Before the suites run:

```
prisma db push --force-reset --skip-generate --accept-data-loss
```

`--force-reset` drops the public schema and rebuilds every table from
`prisma/schema.prisma`. This is *the same mechanism production uses* — the
container's boot command is `prisma db push` (see `server/Dockerfile`). So a
green integration run is direct evidence that provisioning a brand-new database
and playing a game on it works. `integration/schema.test.ts` asserts that
explicitly: every table exists, the `GameStatus` enum has the values the code
transitions through, cascades work, and a full lobby → game → round → scoreboard
flow persists.

> **Note on migrations.** This project has no `prisma/migrations` directory; it
> has always used `db push`, in development and in production. CI therefore
> validates the mechanism that is actually in use rather than a parallel one that
> is not. Moving to `prisma migrate deploy` would be an improvement (reviewable
> diffs, no accidental drops), but it needs the live Supabase database baselined
> first — a deployment decision, not a testing one. See §10.

---

## 5. Determinism

Flaky tests were designed out rather than tolerated:

- **No `setTimeout` guessing.** Socket tests wait on the specific event they
  care about, with an explicit timeout and a predicate
  (`waitForMatching`), so they cannot pass by luck or hang forever quietly.
- **No real network.** The socket harness boots the real server on an ephemeral
  port on `127.0.0.1`.
- **Randomness is injected.** `withSeed(seed, fn)` pins `Math.random` to a
  seeded Mulberry32 and restores it afterwards. Randomised rules (shuffle,
  random trump order, bot bid jitter) are asserted on *properties that must hold
  for every draw* — never on one hard-coded "random" sequence.
- **Timing is a seam, not a wait.** The inter-trick presentation pauses
  (`LAST_CARD_VIEW_DELAY_MS`, `HAND_WINNER_DURATION_MS`, defaults 1000 ms and
  1800 ms) and the bot "thinking time" (`BOT_SPEED_FACTOR`, default 1) are
  overridable by env var. The test runner sets them to ~0. Production defaults
  are unchanged.
- **No shared rows.** Every suite truncates every table in `beforeEach`, and
  integration files run with `--test-concurrency=1` because they share one
  database. Any file can be run alone, in any order.

---

## 6. Coverage

`npm run test:coverage`. Server coverage is source-mapped back to the original
TypeScript via `--enable-source-maps`, so the report names `src/*.ts`, not
`dist/*.js`.

### Server

Measured on the current suite (unit + integration together):

```
all files              | lines 88.21 | branches 78.18 | funcs 90.27
```

The game rules — the part that must not be wrong — are at or near 100%:

| File | Lines | Branches |
|---|---|---|
| `utils/cardUtils.ts` (deck, legality, trick winner, scoring) | 100% | 100% |
| `utils/trump.ts` (trump order, bid limits) | 100% | 100% |
| `utils/validateLobby.ts` | 100% | 100% |
| `utils/generateLobbyCode.ts` | 100% | 100% |
| `utils/rotation.ts` (dealer / round starter) | 100% | 100% |
| `utils/bot.strategy.ts` | 97.0% | 94.1% |
| `services/game.service.ts` | 94.6% | 89.6% |
| `services/lobby.service.ts` | 94.9% | 82.6% |
| `services/player.service.ts` | 88.4% | 79.2% |
| `services/bot.service.ts` | 87.9% | 60.2% |
| `services/scoreboard.service.ts` | 75.6% | 65.4% |
| `app.ts` (REST) | 88.0% | 70.6% |
| `socket/*` | 67–88% | 41–65% |

(Figures move by a few tenths between runs — Node attributes coverage per test
process — which is why the floors sit several points below them.)

**Thresholds** are set at `lines 80 / branches 75 / functions 80` (override with
`COVERAGE_LINES` etc.). They are floors under what the suite already achieves,
not aspirations, so a real regression trips them and normal work does not.

### App

```
src/utils/         | 100% across statements, branches, functions and lines
src/components/    | 29%  (5 of 23 components have tests)
all collected      | 37.46% statements
```

The threshold is scoped to `src/utils/` at 90% on all four counters
(`jest.config.js`), because that directory duplicates server logic and a gap
there is a gap in something safety-critical. The app-wide number is left in the
report as an honest signal rather than tuned upward: most of the untested 71% is
presentational (`Sparkles`, `ConfettiCelebration`, `SuitLegend`, `RuleSection`,
the How-to-Play blocks), where a test would assert that a gradient renders and
nothing more. The components that carry behaviour — buttons, the name field, the
settings controls, the lobby row — are covered at 69–100%.

**What is deliberately not covered**

- `src/server.ts` and `src/db/connection.ts` — process bootstrap and the Prisma
  singleton, excluded from the report.
- The error branches of the socket handlers. Each handler is a
  `try/catch` that logs and emits `*:error`; the happy paths and the
  interesting rejections (not your turn, not host, invalid bid, bad code) are
  covered, but the "database threw unexpectedly" arms are not.
- Disconnect/reconnect edge cases beyond identity recovery
  (`lobby.test.ts` covers `clientId` survival across a new socket).
- The React screens (`src/screens/*`). They are large, heavily animated
  components; the logic worth testing was extracted out of them into
  `src/utils/` and is tested there.

---

## 7. Linting

One flat config at the repo root (`eslint.config.js`) covers both packages.

- **App**: `eslint-config-expo` (React, hooks, React Native) on `App.js`,
  `index.js`, `src/**/*.js`.
- **Server**: `typescript-eslint` with **type-aware** linting
  (`projectService: true`), which is what makes
  `@typescript-eslint/no-floating-promises` possible — the most valuable rule in
  an async, socket-driven codebase.

The rule set targets correctness, not style: unused bindings, unreachable code,
duplicate imports, accidental globals, `no-self-compare`,
`no-unmodified-loop-condition`, unhandled promises, `await` of a non-thenable.
Formatting is not linted at all; there is no Prettier and nothing bikesheds
quotes or commas.

Two deliberate relaxations, both documented in the config:

- `react-hooks/exhaustive-deps` is a **warning**. The screens contain many
  intentional mount-only animation effects; the signal stays visible without
  blocking unrelated work. Currently 25 warnings.
- `@typescript-eslint/no-explicit-any` is **off**. Prisma's generated JSON
  column types force a handful of casts at the persistence boundary.

CI fails on errors and never runs `--fix`.

---

## 8. CI (`.github/workflows/ci.yml`)

Runs on every `pull_request` and every `push` to `main`.

```
quality              unit-tests          integration-tests      build            docker           audit
├─ npm ci (both)     ├─ npm ci (both)    ├─ postgres service    ├─ npm ci        ├─ docker build  ├─ server prod
├─ prisma generate   ├─ prisma generate  ├─ npm ci (server)     ├─ tsc           │  ./server      │  deps must be
├─ eslint            ├─ jest --coverage  ├─ prisma generate     ├─ expo export   └─ verify        │  clean @ high
└─ tsc --noEmit      └─ server unit      ├─ db push --force-    │  --platform       dist/         └─ full report
                        tests            │  reset (from empty)  │  web              server.js        (informational)
                                         └─ integration +      └─ upload
                                            socket tests           artifact
                                            + coverage
                                                    │
                                                    ▼
                                              ci-success
```

Design notes:

- **Six parallel jobs, no artificial dependencies.** Only `ci-success` has
  `needs:`. Lint failures and integration failures surface at the same time
  instead of one hiding the other.
- **`ci-success`** is the single check to require in branch protection. It fails
  if any upstream job failed or was cancelled, so adding a job later does not
  mean editing the protection rules.
- **`concurrency`** cancels the previous run for a branch when a new commit
  arrives.
- **Deterministic installs.** `npm ci` everywhere, never `npm install`.
- **Caching** is npm's cache (via `actions/setup-node`, keyed on *both*
  lockfiles), not `node_modules` — caching `node_modules` across differing
  lockfiles or Node versions is how CI starts lying.
- **Node 24** for tooling: the test runner needs Node ≥ 22 for coverage
  thresholds and glob support. Production still runs `node:20-slim`, and the
  `docker` job builds and boots exactly that image, so the production runtime is
  validated on its own version. Aligning both on Node 22+ is a reasonable
  follow-up (see §10).
- **Real production builds**, not just tests: `tsc` for the server, and a full
  Metro/NativeWind web bundle for the app. A broken import or a missing asset
  fails the PR.

### Security posture

- `permissions: contents: read` at the workflow level. Nothing needs more.
- **No secrets are used by CI at all.** The integration job's database is a
  per-run service container with throwaway credentials written in plain sight in
  the workflow. There is nothing for an untrusted pull request to exfiltrate.
- No deployment happens from a pull request. There is no deploy workflow at all
  (see §9).
- Only first-party `actions/*` at pinned major versions.

### Dependency auditing

Handled in two parts, on purpose:

- **Enforced:** `npm --prefix server audit --omit=dev --audit-level=high`. The
  server is the internet-facing process; its production tree is small and is
  currently advisory-free (a stale transitive `ws` was updated in the lockfile as
  part of this work).
- **Informational:** a full `npm audit` for both packages, printed in collapsible
  groups. The app's tree carries known advisories inside Expo/React Native/Jest
  build tooling (`tar`, `shell-quote`, `glob`, …) with no fix short of an SDK
  upgrade. None of it executes in the shipped bundle or on the server, so it is
  reported rather than used to block unrelated work. Failing on it would make the
  repository permanently red for reasons nobody in this codebase can fix.

---

## 9. CD — current status

**There is no GitHub Actions deployment workflow, and that is deliberate.**

Deployment already exists and is owned by the platforms, not by this repository
(see [`DEPLOYMENT.md`](DEPLOYMENT.md)):

| Piece | How it deploys today |
|---|---|
| Game server | **Railway**, watching `main` via its own GitHub integration. Root directory `server`, builds `server/Dockerfile`, health check `GET /health`. On boot: `prisma db push` then `node dist/server.js`. |
| Database | **Supabase** Postgres. `DATABASE_URL` (transaction pooler, 6543) and `DIRECT_URL` (session pooler, 5432) are set as Railway variables. |
| Mobile app | **EAS** — `eas build` / `eas submit`, run manually, profiles in `eas.json`. |
| Alternative | `render.yaml` exists as a Render blueprint; unused. |

Adding a GitHub Actions deploy job would either duplicate Railway's deploy (two
deploys per merge) or require inventing credentials that do not exist in this
repository. Neither is right. What CI does instead is gate the artifact: the
`docker` job builds the exact image Railway will build, so a broken image fails
the PR rather than the deploy.

### To close the loop (one setting, no code)

Turn on Railway → service → **Settings → Deploys → Wait for CI**. Railway then
holds a deploy until the commit's checks pass, which makes the real flow:

```
PR      → CI
merge   → CI on main → Railway waits for CI → build image → prisma db push → deploy
```

### If you later want deploys driven from here instead

Turn off Railway's GitHub integration first, then add
`.github/workflows/deploy.yml`:

- Trigger: `push: branches: [main]` (staging) and `release: types: [published]`
  or a `v*` tag (production).
- Gate: `needs:` the CI workflow via `workflow_run`, or move the CI jobs into the
  same workflow — deployment must never run before CI is green.
- Environments: define GitHub **Environments** (`staging`, `production`) and put
  the secrets there, with required reviewers on `production`. Environment
  secrets are not exposed to pull requests from forks.
- Secrets needed: `RAILWAY_TOKEN` (project token) and the deploy step
  `npx @railway/cli up --service <name>` — or push the image to a registry and
  have Railway pull it.
- For mobile: `EXPO_TOKEN`, then `eas build --non-interactive --profile
  production`. Note `EXPO_PUBLIC_SERVER_URL` is baked in at build time from
  `eas.json`, so a server URL change means a new binary (or an `eas update`).

There is currently **no staging environment**. A second Railway service plus a
second Supabase project, deployed from `main`, with production moved behind a
tag, is the natural next step.

---

## 10. Gaps and recommended follow-ups

Ordered by how much they would actually buy:

1. **Prisma migrations.** `db push` cannot express a rename and will happily drop
   a column. Baseline the Supabase database
   (`prisma migrate diff` → `migrate resolve --applied`), then switch the
   container's boot command to `prisma migrate deploy` and add a CI step that
   applies migrations to an empty database *and* checks for drift.
2. **Unused tables.** `RoundTrick` and `TrickCard` exist in the schema but are
   never written to — trick state lives in `Game.gameStateJson`, and only
   `GameAction` records the plays. Either populate them or drop them; right now
   they are a false promise to anyone reading the schema.
3. **Screen-level tests.** `HomeScreen`, `LobbyScreen`, `BiddingScreen`,
   `GameTableScreen`, `ScoreBoardScreen` are untested. They need
   `socketService` and navigation mocked; worth doing for the bidding grid
   (forbidden-bid button state) and the game table (enabled/disabled cards)
   in particular.
4. **Lobby disconnect grace period.** A player who drops *before* the game starts
   is removed from the lobby immediately (`handleLobbyDisconnect`); only
   in-progress games survive a drop. Add a grace period, then test it.
5. **Reconnect mid-trick.** `session:restore` is covered at the service level but
   not over a socket — worth a test that drops a client mid-trick and asserts the
   restored hand and turn.
6. **Node version alignment.** Move `server/Dockerfile` to `node:22-slim` (or 24)
   so development, CI and production agree, and add an `engines` field.
7. **`react-hooks/exhaustive-deps`.** 25 warnings. Most are mount-only animation
   effects that want an explicit disable comment rather than a dependency; worth
   a pass so the rule can be promoted to an error.
8. **Concurrency under load.** Two players acting at the same instant both
   read-modify-write `Game.gameStateJson`. The turn check makes this benign in
   practice, but nothing tests it, and there is no optimistic locking.
9. **Coverage reporting service.** Coverage is printed and the app's HTML report
   uploaded as an artifact; wiring it to Codecov (or similar) would give
   per-PR deltas.

---

## 11. Reproducing CI locally

```bash
npm run bootstrap        # once, or after a lockfile change
npm run ci               # everything CI runs, in the same order
```

Individually:

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration   # starts a throwaway Postgres in Docker
npm run test:coverage
npm run build
```

The only prerequisites are Node ≥ 22 and Docker (for `test:integration`; set
`TEST_DATABASE_URL` to your own disposable Postgres to skip Docker).
