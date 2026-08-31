// Who is driving a seat, in the words shown under their name.
//
// The server sends `connected` and `controlledByBot` with every game state, and
// three screens have to render the same three states from them. Deriving the
// label in one pure function keeps them from drifting - and makes the one rule
// that is easy to get wrong testable on its own: an *absent* `connected` field
// means present, not away, so an older server or a caller that does not track
// presence never paints the whole table as reconnecting.

/** Seat is being held open for a player who dropped out; nobody is playing it. */
export const RECONNECTING = "RECONNECTING...";

/**
 * The bot engine is driving this seat - either an actual bot, or a human whose
 * grace period ran out and who has not rejoined. The two read the same on
 * purpose: a taken-over seat plays exactly like a bot, so it should look like one.
 */
export const AUTO_PLAYING = "AUTO PLAYING";

/**
 * The label for a seat, or null for the ordinary case: somebody present and
 * playing for themselves.
 */
export function seatStatus(player) {
  if (!player) return null;
  if (player.controlledByBot) return AUTO_PLAYING;
  if (player.connected === false) return RECONNECTING;
  return null;
}
