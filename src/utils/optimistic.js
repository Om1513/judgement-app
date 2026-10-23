
// Our own actions, shown before the server confirms them.
//
// A bid or a card goes to the server, which stays authoritative, but waiting a
// network round trip to show something the player just did makes every tap
// feel slow. These pure helpers project the action onto the state we already
// have, so the screen moves at once; the server's next update replaces the
// projection, and a rejection simply drops it.

/**
 * The game state with our pending bid applied: recorded against us, added to
 * the running total, and the turn passed to the next bidder. Returns the state
 * unchanged when there is nothing pending or it is not our bid to make.
 */
export function withPendingBid(state, bid, playerId) {
  const roundState = state?.roundState;
  if (bid === null || bid === undefined || !roundState) return state;
  if (roundState.currentBidderId !== playerId) return state;

  const order = roundState.bidOrder || [];
  const mine = order.indexOf(playerId);
  const nextBidderId = mine >= 0 ? order[mine + 1] ?? null : null;

  return {
    ...state,
    players: (state.players || []).map((p) =>
      p.id === playerId ? { ...p, bid, hasBid: true } : p
    ),
    roundState: {
      ...roundState,
      currentBidderId: nextBidderId,
      totalBidsSoFar: (roundState.totalBidsSoFar || 0) + bid,
      isLastBidder: false,
    },
  };
}
