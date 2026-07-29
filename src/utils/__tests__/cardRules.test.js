// The client's follow-suit mirror.
//
// These are the same scenarios the server rule is tested against
// (server/src/tests/unit/cardValidation.test.ts). If the two ever disagree, the
// table will offer a card the server then refuses - so the cases are duplicated
// on purpose.

import { getPlayableCardIndexes, isCardPlayable } from "../cardRules";

const c = (suit, rank) => ({ suit, rank, value: 0 });

const HEARTS_HAND = [
  c("hearts", "4"),
  c("hearts", "K"),
  c("spades", "A"),
  c("clubs", "2"),
];

const VOID_IN_HEARTS = [
  c("spades", "3"),
  c("spades", "K"),
  c("clubs", "9"),
  c("diamonds", "Q"),
];

describe("leading a trick", () => {
  it("makes every card playable", () => {
    expect(getPlayableCardIndexes(HEARTS_HAND, null)).toEqual([0, 1, 2, 3]);
  });

  it("treats undefined lead suit the same as none", () => {
    expect(getPlayableCardIndexes(HEARTS_HAND, undefined)).toEqual([0, 1, 2, 3]);
  });
});

describe("following with the lead suit in hand", () => {
  it("narrows to just the lead suit", () => {
    expect(getPlayableCardIndexes(HEARTS_HAND, "hearts")).toEqual([0, 1]);
  });

  it("does not let trump excuse following suit", () => {
    // Index 2 is the ace of spades, trump in round 1, and it stays locked.
    expect(getPlayableCardIndexes(HEARTS_HAND, "hearts")).not.toContain(2);
    expect(isCardPlayable(c("spades", "A"), HEARTS_HAND, "hearts")).toBe(false);
  });

  it("forces a lone card of the lead suit", () => {
    const hand = [c("hearts", "2"), c("spades", "A"), c("spades", "K")];
    expect(getPlayableCardIndexes(hand, "hearts")).toEqual([0]);
  });
});

describe("following when void in the lead suit", () => {
  it("opens the whole hand back up", () => {
    expect(getPlayableCardIndexes(VOID_IN_HEARTS, "hearts")).toEqual([0, 1, 2, 3]);
  });

  it("allows trumping in", () => {
    expect(isCardPlayable(c("spades", "K"), VOID_IN_HEARTS, "hearts")).toBe(true);
  });
});

describe("turn and phase gating", () => {
  it("plays nothing when it is not your turn", () => {
    expect(getPlayableCardIndexes(HEARTS_HAND, null, { isMyTurn: false })).toEqual([]);
  });

  it("plays nothing outside the playing phase", () => {
    expect(
      getPlayableCardIndexes(HEARTS_HAND, null, { isMyTurn: true, status: "BIDDING" })
    ).toEqual([]);
    expect(
      getPlayableCardIndexes(HEARTS_HAND, null, {
        isMyTurn: true,
        status: "ROUND_SCOREBOARD",
      })
    ).toEqual([]);
  });

  it("defaults to your turn during play, so a plain call is usable", () => {
    expect(getPlayableCardIndexes(HEARTS_HAND, null, {})).toEqual([0, 1, 2, 3]);
  });
});

describe("degenerate input", () => {
  it("handles an empty hand", () => {
    expect(getPlayableCardIndexes([], "hearts")).toEqual([]);
    expect(getPlayableCardIndexes([], null)).toEqual([]);
  });

  it("handles a missing hand without throwing", () => {
    expect(getPlayableCardIndexes(undefined, "hearts")).toEqual([]);
    expect(getPlayableCardIndexes(null, null)).toEqual([]);
  });

  it("rejects a card that is not in hand", () => {
    expect(isCardPlayable(c("diamonds", "A"), HEARTS_HAND, null)).toBe(false);
  });
});

describe("the returned indexes", () => {
  it("always point at real cards in the hand", () => {
    for (const lead of [null, "hearts", "spades", "clubs", "diamonds"]) {
      for (const index of getPlayableCardIndexes(HEARTS_HAND, lead)) {
        expect(HEARTS_HAND[index]).toBeDefined();
      }
    }
  });

  it("never returns duplicates", () => {
    const indexes = getPlayableCardIndexes(HEARTS_HAND, "hearts");
    expect(new Set(indexes).size).toBe(indexes.length);
  });
});
