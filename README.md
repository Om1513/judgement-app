# Judgement (Kachuful)

A cross-platform Kachuful / Judgement card game: an Expo app (iOS, Android, web)
talking to a backend-authoritative Node game server over Socket.IO.

## Getting Started

### Prerequisites

- **Node.js 22 or newer** — the server's test runner uses Node's built-in test
  runner with coverage thresholds
- npm
- **Docker** — only for the integration tests, which provision a throwaway Postgres
- Expo Go on your device, for testing on real hardware
- PostgreSQL, for running the server locally

### Installation

```bash
npm run bootstrap     # installs the app and the server (npm ci in both)
```

Copy the environment templates and fill them in:

```bash
cp .env.example .env                 # app: EXPO_PUBLIC_SERVER_URL
cp server/.env.example server/.env   # server: DATABASE_URL, DIRECT_URL, CORS_ORIGIN, ...
```

### Running the App

```bash
npm start          # Expo dev server
npm run android
npm run ios
npm run web
```

### Running the Server

```bash
cd server
npm run db:push    # apply the Prisma schema to your local database
npm run dev        # http://localhost:3001
```

## Tests and CI

One command runs everything CI runs, in the same order:

```bash
npm run ci         # lint -> typecheck -> unit tests -> integration tests -> build
```

Individually:

```bash
npm run lint             # ESLint across the app, the server and the tests
npm run lint:fix         # apply fixes (local only)
npm run typecheck        # tsc --noEmit for the root and for server/
npm run test:unit        # app tests (Jest) + server game-rule tests
npm run test:integration # server + Socket.IO against a real Postgres
npm run test:coverage    # coverage for both packages, with thresholds
npm run build            # compile the server, bundle the app for web
```

`npm run test:integration` starts a disposable Postgres in Docker on port 55432
and rebuilds the schema from empty before every run. It never touches your
development database. Set `TEST_DATABASE_URL` to use your own throwaway database
instead.

Full details of the pipeline, coverage numbers, what is deliberately untested and
the deployment status: **[CI-CD.md](CI-CD.md)**.

## Project Structure

```
judgement/
├── App.js                  # App entry point
├── app.json                # Expo configuration
├── eslint.config.js        # Lint config for the whole repository
├── jest.config.js          # App test config (jest-expo)
├── assets/                 # Images, fonts, sounds
├── src/                    # The Expo app
│   ├── components/         # Shared UI
│   ├── screens/            # Home, Lobby, Bidding, GameTable, Scoreboard, ...
│   ├── navigation/         # React Navigation stack
│   ├── services/           # socket.js, api.js, audioManager.js
│   ├── utils/              # Pure logic: card legality, seat layout
│   └── hooks/
├── server/                 # The game server (TypeScript)
│   ├── prisma/schema.prisma
│   ├── src/
│   │   ├── services/       # lobby, game, bot, scoreboard, player
│   │   ├── socket/         # Socket.IO handlers + shared play flow
│   │   ├── utils/          # Game rules: cards, trump, scoring, rotation
│   │   ├── types/          # Shared state and event types
│   │   └── tests/          # unit/ and integration/ suites
│   ├── Dockerfile          # Production image (Railway)
│   └── docker-compose.test.yml
├── CI-CD.md                # Testing, CI and deployment reference
└── DEPLOYMENT.md           # Railway + Supabase + EAS deployment guide
```

## Architecture

The server is **authoritative**. Clients render state and send intents; every
rule — which cards are legal, whether a bid is allowed, who takes the trick, what
a round scores — is decided and persisted server-side, then broadcast per player
so nobody ever receives another player's hand. The client mirrors only the
follow-suit rule, to grey out unplayable cards.

## Platforms

- **Mobile**: iOS and Android via Expo Go or an EAS build
- **Web**: `react-native-web` bundle via `expo export --platform web`
