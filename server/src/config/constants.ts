// Centralized runtime constants.
//
// Anything that is a tunable product decision rather than a game rule belongs
// here, so it can be adjusted in one place instead of being scattered through
// the handlers. Game rules themselves live in utils/validateLobby.ts.

/**
 * Reads a non-negative millisecond value from the environment, falling back to
 * `fallback` when it is unset or nonsense. Same pattern as the presentation
 * pauses in socket/playFlow.ts: every real deployment runs on the defaults, but
 * an operator can retune without a code change.
 */
function envMs(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

/**
 * How long a player who drops out of a WAITING lobby keeps their seat before
 * being removed for good.
 *
 * The waiting room is where phones are most likely to blink out - the app gets
 * backgrounded while the code is shared, WiFi hands over to mobile data, a
 * browser tab is refreshed - and none of that should cost someone their seat.
 * Their slot (including host status and seat position) is reserved for this
 * long; if they are still absent when it elapses they are removed normally.
 *
 * Kept short enough that a lobby is not blocked for long by someone who has
 * genuinely left, and long enough to cover a Socket.IO reconnect cycle
 * (reconnectionDelayMax on the client is 5s).
 *
 * Override with LOBBY_DISCONNECT_GRACE_MS.
 */
export const LOBBY_DISCONNECT_GRACE_MS = envMs('LOBBY_DISCONNECT_GRACE_MS', 30_000);
