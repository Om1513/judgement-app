// GameButton is the app's primary action - Create Game, Join Game, Start Game,
// Continue. What matters is that a tap fires exactly once, and that disabling it
// really does make it inert.

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";

import GameButton from "../GameButton";
import audioManager from "../../services/audioManager";

describe("GameButton", () => {
  it("renders its title", () => {
    render(<GameButton title="Create Game" onPress={() => {}} />);
    expect(screen.getByText("Create Game")).toBeTruthy();
  });

  it("calls onPress once per tap", () => {
    const onPress = jest.fn();
    render(<GameButton title="Start Game" onPress={onPress} />);

    fireEvent.press(screen.getByText("Start Game"));
    expect(onPress).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByText("Start Game"));
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it("plays the click sound itself, so screens never double it up", () => {
    render(<GameButton title="Join Game" onPress={() => {}} />);

    fireEvent.press(screen.getByText("Join Game"));

    expect(audioManager.playSound).toHaveBeenCalledWith("buttonPop");
    expect(audioManager.playSound).toHaveBeenCalledTimes(1);
  });

  it("ignores taps when disabled", () => {
    const onPress = jest.fn();
    render(<GameButton title="Start Game" onPress={onPress} disabled />);

    fireEvent.press(screen.getByText("Start Game"));

    expect(onPress).not.toHaveBeenCalled();
    expect(audioManager.playSound).not.toHaveBeenCalled();
  });

  it("still renders its label while disabled, so the button does not vanish", () => {
    render(<GameButton title="Start Game" onPress={() => {}} disabled />);
    expect(screen.getByText("Start Game")).toBeTruthy();
  });

  it("does not blow up without an onPress handler", () => {
    render(<GameButton title="Nothing" />);
    expect(() => fireEvent.press(screen.getByText("Nothing"))).not.toThrow();
  });
});
