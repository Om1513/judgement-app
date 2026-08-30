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

/**
 * How long a player who drops out of a LIVE GAME is shown as "Reconnecting..."
 * before the bot starts playing their seat for them.
 *
 * Nothing is taken away when this elapses: the same seat, hand, bid, score and
 * name stay exactly where they are, and only the *controller* changes. It exists
 * because the alternative is worse - a hand that never gets played blocks three
 * other people indefinitely, which is the one failure mode a card game cannot
 * absorb.
 *
 * Deliberately the same 30 seconds as the waiting room, for the same reason: it
 * comfortably covers a Socket.IO reconnect cycle (reconnectionDelayMax on the
 * client is 5s), an app switching to the background, or WiFi handing over to
 * mobile data, while being short enough that the table is not left staring at an
 * empty seat.
 *
 * Coming back after it has elapsed is not automatic - see
 * services/gameReconnect.service.ts for the rejoin/discard decision.
 *
 * Override with GAME_DISCONNECT_GRACE_MS.
 */
export const GAME_DISCONNECT_GRACE_MS = envMs('GAME_DISCONNECT_GRACE_MS', 30_000);
