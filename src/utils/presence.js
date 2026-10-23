// Who is driving a seat, in the words shown under their name.
//
// The server sends `connected` and `controlledByBot` with every game state, and
// several screens have to render the same label from them. Deriving the
// label in one pure function keeps them from drifting - and makes the one rule
// that is easy to get wrong testable on its own: an *absent* `connected` field
// means present, not away, so an older server or a caller that does not track
// presence never paints the whole table as reconnecting.

/** Seat is being held open for a player who dropped out; nobody is playing it. */
export const RECONNECTING = "RECONNECTING...";

/**
 * The label for a seat, or null when there is nothing to say.
 *
 * A seat the bot engine is driving - an actual bot, or a human whose grace
 * period ran out - is deliberately unlabelled: the game simply carries on. It is
 * checked first because a taken-over row keeps `connected: false`, and it must
 * not go back to reading as reconnecting.
 */
export function seatStatus(player) {
  if (!player) return null;
  if (player.controlledByBot) return null;
  if (player.connected === false) return RECONNECTING;
  return null;
}
