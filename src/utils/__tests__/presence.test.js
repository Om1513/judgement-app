// The seat label three screens share.
//
// Small, but it is the one place a wrong default is expensive: an older server -
// or the `game:started` broadcast, which omits presence because the game refuses
// to deal to an absent player - sends players with no `connected` field at all,
// and treating that as "away" would paint the whole table as reconnecting.

import { RECONNECTING, seatStatus } from "../presence";

describe("seatStatus", () => {
  test("a player who is present and playing for themselves has no label", () => {
    expect(seatStatus({ connected: true, controlledByBot: false })).toBeNull();
  });

  test("a player inside their grace period is shown as reconnecting", () => {
    expect(seatStatus({ connected: false, controlledByBot: false })).toBe(RECONNECTING);
  });

  test("a seat the bot has taken over has no label, not reconnecting", () => {
    // The row keeps `connected: false` after a takeover; it must not fall back
    // to reading as reconnecting.
    expect(seatStatus({ connected: false, controlledByBot: true })).toBeNull();
  });

  test("an actual bot has no label", () => {
    expect(seatStatus({ connected: true, controlledByBot: true })).toBeNull();
  });

  test("a missing presence field reads as present, not away", () => {
    expect(seatStatus({ id: "p-om", name: "Om" })).toBeNull();
    expect(seatStatus({ connected: undefined, controlledByBot: undefined })).toBeNull();
  });

  test("no player at all is no label rather than a crash", () => {
    expect(seatStatus(null)).toBeNull();
    expect(seatStatus(undefined)).toBeNull();
  });
});
