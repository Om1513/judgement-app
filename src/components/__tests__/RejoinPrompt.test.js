// The question asked when a game is still running without its player.
//
// What matters here is that it is a genuine choice: both answers are always
// reachable, neither fires without a tap, and nothing about the game is entered
// until one of them is chosen. The prompt is the only thing standing between a
// returning player and a hand that a bot has been playing for them.

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";

import RejoinPrompt from "../RejoinPrompt";

const offer = {
  gameId: "game-1",
  lobbyCode: "ABC123",
  status: "PLAYING",
  currentRound: 2,
  totalRounds: 4,
};

describe("RejoinPrompt", () => {
  it("renders nothing until there is something to ask about", () => {
    const { toJSON } = render(<RejoinPrompt visible={false} offer={offer} />);
    expect(toJSON()).toBeNull();
  });

  it("asks the question and offers both answers", () => {
    render(<RejoinPrompt visible offer={offer} />);

    expect(screen.getByText("You Were In A Game")).toBeTruthy();
    expect(screen.getByText(/still in progress/)).toBeTruthy();
    expect(screen.getByText("Rejoin Game")).toBeTruthy();
    expect(screen.getByText("Discard")).toBeTruthy();
  });

  it("says what would be rejoined, so the choice is informed", () => {
    render(<RejoinPrompt visible offer={offer} />);

    expect(screen.getByText("Round 2 of 4")).toBeTruthy();
    expect(screen.getByText("A hand is being played")).toBeTruthy();
  });

  it("names the bidding phase when that is what is waiting", () => {
    render(<RejoinPrompt visible offer={{ ...offer, status: "BIDDING" }} />);
    expect(screen.getByText("Bidding is under way")).toBeTruthy();
  });

  it("still asks when the phase is one it has no wording for", () => {
    render(<RejoinPrompt visible offer={{ ...offer, status: "SOMETHING_NEW" }} />);

    expect(screen.getByText("Rejoin Game")).toBeTruthy();
    expect(screen.getByText("Round 2 of 4")).toBeTruthy();
  });

  it("survives an offer with no round information", () => {
    render(<RejoinPrompt visible offer={{ gameId: "game-1", lobbyCode: "ABC123" }} />);

    expect(screen.getByText("Rejoin Game")).toBeTruthy();
    expect(screen.queryByText(/Round/)).toBeNull();
  });

  it("calls back on rejoin, and only on rejoin", () => {
    const onRejoin = jest.fn();
    const onDiscard = jest.fn();
    render(<RejoinPrompt visible offer={offer} onRejoin={onRejoin} onDiscard={onDiscard} />);

    fireEvent.press(screen.getByText("Rejoin Game"));

    expect(onRejoin).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it("calls back on discard, and only on discard", () => {
    const onRejoin = jest.fn();
    const onDiscard = jest.fn();
    render(<RejoinPrompt visible offer={offer} onRejoin={onRejoin} onDiscard={onDiscard} />);

    fireEvent.press(screen.getByText("Discard"));

    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onRejoin).not.toHaveBeenCalled();
  });

  it("shows progress and refuses further taps while the answer is in flight", () => {
    const onRejoin = jest.fn();
    render(<RejoinPrompt visible busy offer={offer} onRejoin={onRejoin} />);

    expect(screen.getByText("Rejoining...")).toBeTruthy();
    fireEvent.press(screen.getByText("Rejoining..."));

    // A second rejoin would be a second navigation into the same game.
    expect(onRejoin).not.toHaveBeenCalled();
  });

  it("does nothing when no handlers are supplied", () => {
    render(<RejoinPrompt visible offer={offer} />);

    expect(() => fireEvent.press(screen.getByText("Rejoin Game"))).not.toThrow();
    expect(() => fireEvent.press(screen.getByText("Discard"))).not.toThrow();
  });
});
