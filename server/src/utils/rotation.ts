// Per-round seat rotation.
//
// Kachuful deals a new dealer every round, moving one seat clockwise. The
// dealer bids last, so the player immediately after the dealer both opens the
// bidding and leads the first trick of the round.
//
//   round 1 -> seat 0 deals, seat 1 starts
//   round 2 -> seat 1 deals, seat 2 starts
//   ...and it wraps, so with four players round 5 looks like round 1 again.
//
// `initializeGame` and `startNewRound` both need this and used to compute it
// inline; keeping it in one place means the two can never drift apart, and the
// rotation can be tested without a database.

export interface RoundRotation {
  /** Index into `turnOrder` of the dealer for this round. */
  dealerIndex: number;
  /** Player id of the dealer. Bids last. */
  dealerId: string;
  /** Index into `turnOrder` of the player who opens bidding and leads. */
  firstBidderIndex: number;
  /** Bidding order, clockwise from the dealer's left, dealer last. */
  bidOrder: string[];
}

/**
 * @param roundNumber 1-based round number
 * @param turnOrder   player ids in seat order
 */
export function getRoundRotation(
  roundNumber: number,
  turnOrder: string[]
): RoundRotation {
  const playerCount = turnOrder.length;

  if (playerCount === 0) {
    throw new Error('Cannot compute a round rotation with no players');
  }

  const dealerIndex = (roundNumber - 1) % playerCount;
  const firstBidderIndex = (dealerIndex + 1) % playerCount;

  const bidOrder: string[] = [];
  for (let i = 0; i < playerCount; i++) {
    bidOrder.push(turnOrder[(firstBidderIndex + i) % playerCount]);
  }

  return {
    dealerIndex,
    dealerId: turnOrder[dealerIndex],
    firstBidderIndex,
    bidOrder,
  };
}
