// The row of playable cards that lifts out of the hand on the player's turn.
//
// The animation itself is not asserted - only what it is in service of: the
// right cards come out, one tap plays one card, and nothing is sent until the
// card reaches the table.

import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

import PlayableCardTray from "../PlayableCardTray";

const SPADE_5 = { suit: "spades", rank: "5" };
const SPADE_9 = { suit: "spades", rank: "9" };

const props = (overrides = {}) => ({
  open: true,
  cards: [
    { card: SPADE_5, index: 0 },
    { card: SPADE_9, index: 2 },
  ],
  slots: [
    { left: 300, top: 200, width: 55, height: 80 },
    { left: 363, top: 200, width: 55, height: 80 },
  ],
  getSourceRect: () => null,
  target: { cx: 437, cy: 260, width: 60 },
  landed: false,
  resetSignal: 0,
  onPlace: jest.fn(),
  onPick: jest.fn(),
  onHiddenChange: jest.fn(),
  ...overrides,
});

// Long enough for the deal, the flight and the return to finish.
const settle = () => act(() => jest.advanceTimersByTime(2000));

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe("PlayableCardTray", () => {
  it("deals out the playable cards and empties their places in the hand", () => {
    const p = props();
    render(<PlayableCardTray {...p} />);

    expect(screen.getByTestId("tray-card-spades-5")).toBeTruthy();
    expect(screen.getByTestId("tray-card-spades-9")).toBeTruthy();
    expect(p.onHiddenChange).toHaveBeenLastCalledWith(["spades-5", "spades-9"]);
  });

  it("shows nothing when it is not our turn", () => {
    render(<PlayableCardTray {...props({ open: false })} />);
    expect(screen.queryByTestId("tray-card-spades-5")).toBeNull();
  });

  it("plays the tapped card once it reaches the table, and only once", () => {
    const p = props();
    render(<PlayableCardTray {...p} />);
    settle();

    fireEvent.press(screen.getByTestId("tray-card-spades-9"));
    // A second tap - on the same card or another - is ignored.
    fireEvent.press(screen.getByTestId("tray-card-spades-9"));
    fireEvent.press(screen.getByTestId("tray-card-spades-5"));
    expect(p.onPick).toHaveBeenCalledTimes(1);
    expect(p.onPick).toHaveBeenCalledWith(SPADE_9);
    expect(p.onPlace).not.toHaveBeenCalled();

    settle();
    expect(p.onPlace).toHaveBeenCalledTimes(1);
    expect(p.onPlace).toHaveBeenCalledWith(SPADE_9);
    // The others are back in the hand, and no longer drawn in the row.
    expect(p.onHiddenChange).toHaveBeenLastCalledWith(["spades-9"]);
    expect(screen.queryByTestId("tray-card-spades-5")).toBeNull();
  });

  it("hands over to the table once our card has landed", () => {
    const p = props();
    const { rerender } = render(<PlayableCardTray {...p} />);
    settle();
    fireEvent.press(screen.getByTestId("tray-card-spades-9"));
    settle();

    rerender(<PlayableCardTray {...p} open={false} landed />);
    expect(screen.queryByTestId("tray-card-spades-9")).toBeNull();
    expect(p.onHiddenChange).toHaveBeenLastCalledWith([]);
  });

  it("brings the row back when the play is rejected", () => {
    const p = props();
    const { rerender } = render(<PlayableCardTray {...p} />);
    settle();
    fireEvent.press(screen.getByTestId("tray-card-spades-9"));
    settle();

    rerender(<PlayableCardTray {...p} resetSignal={1} />);
    settle();
    expect(p.onHiddenChange).toHaveBeenLastCalledWith(["spades-5", "spades-9"]);

    fireEvent.press(screen.getByTestId("tray-card-spades-5"));
    settle();
    expect(p.onPlace).toHaveBeenLastCalledWith(SPADE_5);
  });

  it("gathers the row back into the hand if the turn ends untouched", () => {
    const p = props();
    const { rerender } = render(<PlayableCardTray {...p} />);
    settle();

    rerender(<PlayableCardTray {...p} open={false} />);
    settle();
    expect(screen.queryByTestId("tray-card-spades-5")).toBeNull();
    expect(p.onHiddenChange).toHaveBeenLastCalledWith([]);
    expect(p.onPlace).not.toHaveBeenCalled();
  });
});
