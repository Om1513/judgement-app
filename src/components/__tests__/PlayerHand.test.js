// The local player's hand: the real cards, popping up on our turn.
//
// The motion itself is not asserted - where cards go is pinned by the
// getHandPositions tests - only what it is in service of: the right cards can
// be played, one tap plays one card, a played card lands and is handed over,
// and a rejected play comes back.

import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

import PlayerHand from "../PlayerHand";

const S5 = { suit: "spades", rank: "5" };
const H7 = { suit: "hearts", rank: "7" };
const S9 = { suit: "spades", rank: "9" };

const props = (overrides = {}) => ({
  cards: [S5, H7, S9],
  poppedKeys: ["spades-5", "spades-9"],
  dimmedKeys: ["hearts-7"],
  flyingCard: null,
  flightTarget: { left: 410, top: 200, width: 54, height: 76 },
  hiddenKey: null,
  areaWidth: 874,
  bottom: 392,
  cardWidth: 55,
  cardHeight: 80,
  handInset: 20,
  poppedInset: 122,
  onPlay: jest.fn(),
  onArrive: jest.fn(),
  ...overrides,
});

const tappable = (key) =>
  screen.getByTestId(`hand-card-${key}`).props.accessibilityState?.disabled !== true;

// Long enough for any pop, reflow or flight to finish.
const settle = () => act(() => jest.advanceTimersByTime(2000));

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe("PlayerHand", () => {
  it("draws every card, and only the popped ones can be played", () => {
    render(<PlayerHand {...props()} />);

    expect(tappable("spades-5")).toBe(true);
    expect(tappable("spades-9")).toBe(true);
    expect(tappable("hearts-7")).toBe(false);
  });

  it("plays nothing when nothing is popped up", () => {
    const p = props({ poppedKeys: [] });
    render(<PlayerHand {...p} />);

    for (const key of ["spades-5", "hearts-7", "spades-9"]) expect(tappable(key)).toBe(false);
  });

  it("plays the tapped card with one tap, and only once", () => {
    const p = props();
    render(<PlayerHand {...p} />);

    fireEvent.press(screen.getByTestId("hand-card-spades-9"));
    // A second tap before the parent answers - on the same card or another.
    fireEvent.press(screen.getByTestId("hand-card-spades-9"));
    fireEvent.press(screen.getByTestId("hand-card-spades-5"));

    expect(p.onPlay).toHaveBeenCalledTimes(1);
    expect(p.onPlay).toHaveBeenCalledWith(S9);
  });

  it("flies the played card to the table and reports when it lands", () => {
    const p = props();
    const { rerender } = render(<PlayerHand {...p} />);
    fireEvent.press(screen.getByTestId("hand-card-spades-9"));

    // The parent answers: the card is on its way and nothing else is popped.
    rerender(<PlayerHand {...p} poppedKeys={[]} flyingCard={S9} />);
    expect(tappable("spades-5")).toBe(false);
    expect(p.onArrive).not.toHaveBeenCalled();

    settle();
    expect(p.onArrive).toHaveBeenCalledTimes(1);
    expect(p.onArrive).toHaveBeenCalledWith(S9);
  });

  it("finishes the flight even if the server takes the card out of the hand first", () => {
    const p = props();
    const { rerender } = render(<PlayerHand {...p} />);
    fireEvent.press(screen.getByTestId("hand-card-spades-9"));
    rerender(<PlayerHand {...p} poppedKeys={[]} flyingCard={S9} />);

    // Confirmation arrives mid-flight.
    rerender(<PlayerHand {...p} cards={[S5, H7]} poppedKeys={[]} flyingCard={S9} />);
    expect(screen.getByTestId("hand-card-spades-9")).toBeTruthy();

    settle();
    expect(p.onArrive).toHaveBeenCalledWith(S9);
  });

  it("brings a rejected card back and pops the playable cards up again", () => {
    const p = props();
    const { rerender } = render(<PlayerHand {...p} />);
    fireEvent.press(screen.getByTestId("hand-card-spades-9"));
    rerender(<PlayerHand {...p} poppedKeys={[]} flyingCard={S9} />);
    settle();

    // Landed and drawn by the table, unconfirmed.
    rerender(<PlayerHand {...p} poppedKeys={[]} hiddenKey="spades-9" />);
    expect(tappable("spades-9")).toBe(false);

    // Rejected: back in the hand, and playable again.
    rerender(<PlayerHand {...p} />);
    settle();
    expect(tappable("spades-9")).toBe(true);

    fireEvent.press(screen.getByTestId("hand-card-spades-5"));
    expect(p.onPlay).toHaveBeenLastCalledWith(S5);
  });
});
