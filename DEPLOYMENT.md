# Deployment Guide — Judgement (Kachuful)

This guide takes the game from "works on my WiFi" to "playable anywhere in the
world." Recommended stack: **Railway** (backend) + **Neon** (Postgres) + **EAS**
(mobile builds). Render config is also included if you prefer it.

The codebase has already been prepared for this:

- Client server URL is now read from `EXPO_PUBLIC_SERVER_URL` (no hardcoded IP) — `src/config.js`
- Socket transport falls back to long-polling for hostile networks — `src/services/socket.js`
- CORS supports a comma-separated origin allow-list — `server/src/utils/corsOrigin.ts`
- **Reconnection works**: players keep their seat/hand across drops and network
  switches via a stable `clientId` — `server/prisma/schema.prisma`,
  `server/src/services/player.service.ts`, `server/src/socket/index.ts`,
  `src/services/socket.js`
- Container + platform configs: `server/Dockerfile`, `server/railway.json`,
  `render.yaml`, `eas.json`

---

## 1. Provision the database (Neon)

1. Create a project at https://neon.tech → you get a Postgres database.
2. Copy the **pooled** connection string (host contains `-pooler`). It looks like:
   `postgresql://USER:PASS@ep-xxx-pooler.REGION.aws.neon.tech/DB?sslmode=require`
3. Keep it handy — it becomes `DATABASE_URL` on the backend.

(Supabase or Render Postgres work identically — just grab their connection string.)

## 2. Deploy the backend (Railway)

1. Push this repo to GitHub (already at `github.com/Om1513/judgement-app`).
2. Railway → **New Project → Deploy from GitHub repo** → pick this repo.
3. In the service settings set **Root Directory = `server`**. Railway detects
   `server/Dockerfile` and `server/railway.json` automatically.
4. Add environment variables (Variables tab):
   - `DATABASE_URL` = your Neon pooled string
   - `NODE_ENV` = `production`
   - `CORS_ORIGIN` = `*` (tighten later if you ship a web build)
   - `PORT` is injected by Railway automatically — do **not** set it.
5. Deploy. On boot the container runs `prisma db push` (creates all tables on the
   fresh Neon DB) then starts the server. Health check: `GET /health`.
6. Under **Settings → Networking**, generate a public domain. You'll get something
   like `https://judgement-server-production.up.railway.app`. TLS/`wss://` is
   automatic. **This URL is your API host.**

Verify:
```bash
curl https://YOUR-RAILWAY-HOST/health      # -> {"status":"ok",...}
```

### Render alternative
Import `render.yaml` via Render → New → Blueprint. It provisions the web service
+ Postgres together. Adjust the `plan` names to currently-available plans.

## 3. Point the app at the backend (EAS)

1. Install tooling and log in:
   ```bash
   npm i -g eas-cli
   eas login
   eas init            # links the project (writes the projectId)
   ```
2. Edit `eas.json`: replace `https://REPLACE-WITH-YOUR-API-HOST` in the
   `preview` and `production` profiles with your Railway URL.
3. Build:
   ```bash
   eas build --profile preview --platform android   # quick installable APK to test
   eas build --profile production --platform all     # store-ready binaries
   ```
   `EXPO_PUBLIC_SERVER_URL` is baked in from the chosen profile, so the binary
   talks to your cloud server from any network.
4. (Optional) Submit to stores: `eas submit --profile production --platform all`
   (needs an Apple Developer account — $99/yr — and a Google Play account — $25 once).

OTA updates for JS-only changes after release: `eas update`.

## 4. Local development (unchanged)

- Backend: `cd server && npm run dev` (uses local Postgres + `server/.env`).
- App: `npm start`. The phone reads `EXPO_PUBLIC_SERVER_URL` from the root `.env`
  (currently your LAN IP `http://192.168.0.21:3001`). Update that IP if your
  network changes, or set `http://10.0.2.2:3001` for the Android emulator.

## 5. Verifying reconnection

Already verified server-side end to end (drop mid-game → reconnect on a new
socket → same player, game state restored). To see it in the app: start a game,
toggle the phone between WiFi and mobile data; the socket reconnects, the server
re-emits your hand and the current turn, and play continues.

## 6. Performance / latency

The biggest production latency lever for this app is **network round-trip
distance**, because each game action is server-authoritative and touches the
database. To minimize it:

- **Co-locate the database with the server, in a region near your players.**
  Server↔DB should be ~1ms (same region); player↔server is the unavoidable
  internet hop, so pick the region closest to your audience. With Neon, match
  the Railway service region to your Neon project's region.
- The server keeps the (serverless) DB warm with a periodic `SELECT 1` to avoid
  Neon autosuspend cold-start spikes.

### Observability (env-gated, off by default)
Set on the server to measure where time goes (safe to leave off in normal prod):

- `PERF_LOG=1` — logs negotiated transport, per-handler timing for
  `game:submit-bid` / `game:play-card`, and broadcast payload size + room size.
- `PERF_WARN_MS=100` — handlers slower than this are logged as `SLOW`.

The client logs its negotiated transport on connect (e.g.
`Socket connected: <id> transport: websocket`) and any upgrade.

### Production WebSocket health checklist
1. Open the app (or two clients) and confirm the client log shows
   `transport: websocket` (not `polling`). Polling = much higher latency.
2. With `PERF_LOG=1`, confirm `game:submit-bid` / `game:play-card` handler times
   are low (tens of ms). If they're high, the DB is too far from the server →
   fix region co-location.
3. Confirm `broadcast game:update` `bytesPerPlayer` stays small (a few KB).
4. Single Railway instance → no Redis/sticky-session needed. Only add the
   Socket.IO Redis adapter if you scale to **more than one** backend instance.

---

## 7. iOS App Store submission

Prereq: your Apple Developer Program membership must show **active** (not
"Pending") at https://developer.apple.com/account.

### Privacy policy (required by the App Store)
`PRIVACY.md` is an accurate policy for what this app collects (display name +
a random device id; no ads/analytics/tracking). Host it for free and use the URL
in App Store Connect:

- **GitHub Pages:** repo → Settings → Pages → deploy from `main`. The file is
  served at `https://om1513.github.io/judgement-app/PRIVACY` (Pages renders
  Markdown), or convert to `privacy.html`. Any public URL works.
- Edit the contact email in `PRIVACY.md` first.

### Non-interactive submit (App Store Connect API key)
`eas.json` is pre-wired for API-key submission. Generate the key once:

1. App Store Connect → **Users and Access → Integrations → App Store Connect
   API** → **+** to create a key (role: App Manager).
2. Download the `.p8` file, save it in the repo root as **`asc-api-key.p8`**
   (already gitignored — never commit it).
3. Copy the **Key ID** and **Issuer ID** into `eas.json` →
   `submit.production.ios` (`ascApiKeyId`, `ascApiKeyIssuerId`).

Then:
```bash
eas build  --profile production --platform ios
eas submit --profile production --platform ios   # uploads to App Store Connect + TestFlight
```
(If you'd rather not use an API key, delete the `ios` block from
`submit.production` and `eas submit` will prompt for your Apple ID interactively.)

### In App Store Connect (browser)
- Create/confirm the app record (bundle id `com.omsinghan25.judgement`).
- Add name, description, keywords, category (Games → Card).
- **Landscape** screenshots (6.7" iPhone, and 12.9" iPad since `supportsTablet`).
- Privacy Policy URL (from above) + App Privacy answers: collects **Name** and a
  **User ID** (the device play id), not used for tracking.
- Age rating: trick-taking card game, **no real-money gambling** → low rating.
- **App Review notes — important:** multiplayer is solo-testable via bots, e.g.
  *"To test multiplayer: Create Game → Add Bot three times → Start Game."*
- Keep the Railway server up during review (reviewers run the live app).

## Known limitations / recommended next steps

1. **Lobby (pre-game) disconnects still remove the player.** Only *in-progress
   games* survive a disconnect. A grace period for the waiting room is a nice
   follow-up (see `handleLobbyDisconnect` in `server/src/socket/lobby.events.ts`).
2. **Cold-start auto-rejoin.** Mid-session reconnects restore state into the
   already-open screen. Auto-navigating back into a game after the app is fully
   killed/reopened would use the `session:restore` event (now emitted by the
   server and cached on `socketService.lastSession`) from `HomeScreen`.
3. **In-game disconnect UX.** A dropped player's turn currently waits on them;
   consider a grace period + "disconnected" indicator or bot-takeover
   (`handleGameDisconnect` in `server/src/socket/game.events.ts`).
4. **Schema management.** Deploy uses `prisma db push`. For audited schema
   history switch to `prisma migrate deploy` once the schema stabilizes.
5. **Scaling past one instance** needs the Socket.IO Redis adapter + sticky
   sessions, and moving the bot `setTimeout`/`actionLocks` out of process memory
   (`server/src/services/bot.service.ts`). Not needed until thousands of
   concurrent players.
6. **Stray root Prisma setup** (`prisma/`, `prisma.config.ts`, root `@prisma/client`
   dep) is unused by the app — the real schema is `server/prisma/schema.prisma`.
   Safe to remove later to reduce confusion.
