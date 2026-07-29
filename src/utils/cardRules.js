// Client-side mirror of the server's follow-suit rule.
//
// The server is authoritative - it re-validates every play in
// `server/src/utils/cardUtils.ts#canPlayCard` and rejects an illegal one. This
// module exists so the table can grey out cards the player is not allowed to
// play, instead of letting them tap and get an error back.
//
// Because it is a mirror, it must agree with the server exactly. It is unit
// tested against the same scenarios the server rule is tested against
// (`src/utils/__tests__/cardRules.test.js`).

/**
 * Indexes of the cards in `hand` that may legally be played right now.
 *
 * Rules, in order:
 *   - not your turn, or not the playing phase -> nothing is playable
 *   - leading the trick (no lead suit yet)    -> everything is playable
 *   - holding the lead suit                   -> only the lead suit, trump included
 *                                                in the ban (trump does not
 *                                                excuse you from following suit)
 *   - void in the lead suit                   -> everything is playable
 *
 * @param {{suit: string, rank: string}[]} hand
 * @param {string|null|undefined} leadSuit
 * @param {{isMyTurn?: boolean, status?: string}} [turn]
 * @returns {number[]} indexes into `hand`
 */
export function getPlayableCardIndexes(hand, leadSuit, turn = {}) {
  const { isMyTurn = true, status = "PLAYING" } = turn;

  if (!Array.isArray(hand) || hand.length === 0) {
    return [];
  }

  if (!isMyTurn || status !== "PLAYING") {
    return [];
  }

  // Leading: anything goes.
  if (!leadSuit) {
    return hand.map((_, i) => i);
  }

  const hasLeadSuit = hand.some((c) => c.suit === leadSuit);

  if (hasLeadSuit) {
    // Must follow suit.
    return hand.map((c, i) => (c.suit === leadSuit ? i : -1)).filter((i) => i !== -1);
  }

  // Void in the lead suit: discard or trump, both allowed.
  return hand.map((_, i) => i);
}

/**
 * Convenience predicate over the same rule, for a single card.
 *
 * @param {{suit: string, rank: string}} card
 * @param {{suit: string, rank: string}[]} hand
 * @param {string|null|undefined} leadSuit
 */
export function isCardPlayable(card, hand, leadSuit) {
  const playable = getPlayableCardIndexes(hand, leadSuit);
  return playable.some(
    (i) => hand[i].suit === card.suit && hand[i].rank === card.rank
  );
}
