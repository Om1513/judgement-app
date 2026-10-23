import { withPendingBid } from "../optimistic";

const state = {
  status: "BIDDING",
  players: [
    { id: "p0", hasBid: true, bid: 1 },
    { id: "p1", hasBid: false, bid: null },
    { id: "p2", hasBid: false, bid: null },
  ],
  roundState: {
    currentBidderId: "p1",
    bidOrder: ["p0", "p1", "p2"],
    totalBidsSoFar: 1,
    isLastBidder: false,
  },
};

describe("withPendingBid", () => {
  it("records the bid, adds it to the total and passes the turn on", () => {
    const next = withPendingBid(state, 2, "p1");

    expect(next.players[1]).toEqual({ id: "p1", hasBid: true, bid: 2 });
    expect(next.roundState.totalBidsSoFar).toBe(3);
    expect(next.roundState.currentBidderId).toBe("p2");
  });

  it("leaves nobody on turn after the last bidder", () => {
    const last = { ...state, roundState: { ...state.roundState, currentBidderId: "p2", isLastBidder: true } };
    const next = withPendingBid(last, 0, "p2");

    expect(next.roundState.currentBidderId).toBeNull();
    expect(next.roundState.isLastBidder).toBe(false);
  });

  it("does not touch the state it was given", () => {
    withPendingBid(state, 2, "p1");
    expect(state.players[1].hasBid).toBe(false);
    expect(state.roundState.currentBidderId).toBe("p1");
  });

  it("is a no-op with nothing pending, or when it is not our turn", () => {
    expect(withPendingBid(state, null, "p1")).toBe(state);
    expect(withPendingBid(state, 2, "p2")).toBe(state);
    expect(withPendingBid(null, 2, "p1")).toBeNull();
  });
});
