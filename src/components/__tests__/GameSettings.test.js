// The three lobby settings controls. These decide how many rounds are played,
// how trump is chosen and how scores are awarded, so a broken control silently
// changes the rules of the game.

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";

import RoundSelector from "../RoundSelector";
import OrderModeToggle from "../OrderModeToggle";
import ScoringModeToggle from "../ScoringModeToggle";

describe("RoundSelector", () => {
  it("shows the current round count", () => {
    render(<RoundSelector value={6} onChange={() => {}} />);
    expect(screen.getByText("6")).toBeTruthy();
  });

  it("steps up and down by one", () => {
    const onChange = jest.fn();
    render(<RoundSelector value={6} onChange={onChange} />);

    fireEvent.press(screen.getByText("+"));
    expect(onChange).toHaveBeenLastCalledWith(7);

    fireEvent.press(screen.getByText("−"));
    expect(onChange).toHaveBeenLastCalledWith(5);
  });

  it("will not go below the four-round minimum", () => {
    const onChange = jest.fn();
    render(<RoundSelector value={4} onChange={onChange} />);

    fireEvent.press(screen.getByText("−"));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("will not go above the eight-round maximum", () => {
    const onChange = jest.fn();
    render(<RoundSelector value={8} onChange={onChange} />);

    fireEvent.press(screen.getByText("+"));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("honours custom bounds", () => {
    const onChange = jest.fn();
    render(<RoundSelector value={5} onChange={onChange} min={5} max={5} />);

    fireEvent.press(screen.getByText("+"));
    fireEvent.press(screen.getByText("−"));

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("OrderModeToggle", () => {
  it("shows the active mode", () => {
    render(<OrderModeToggle value="Kachuful" onChange={() => {}} />);
    expect(screen.getByText("Kachuful")).toBeTruthy();
  });

  it("flips Kachuful to Random and back", () => {
    const onChange = jest.fn();
    const { rerender } = render(<OrderModeToggle value="Kachuful" onChange={onChange} />);

    fireEvent.press(screen.getByText("🔄"));
    expect(onChange).toHaveBeenLastCalledWith("Random");

    rerender(<OrderModeToggle value="Random" onChange={onChange} />);
    fireEvent.press(screen.getByText("🔄"));
    expect(onChange).toHaveBeenLastCalledWith("Kachuful");
  });
});

describe("ScoringModeToggle", () => {
  it("offers both scoring modes", () => {
    render(<ScoringModeToggle value="+10" onChange={() => {}} />);
    expect(screen.getByText("+10")).toBeTruthy();
    expect(screen.getByText("+1")).toBeTruthy();
  });

  it("reports the mode that was picked", () => {
    const onChange = jest.fn();
    render(<ScoringModeToggle value="+10" onChange={onChange} />);

    fireEvent.press(screen.getByText("+1"));

    expect(onChange).toHaveBeenCalledWith("+1");
  });

  it("still reports a tap on the already-selected mode rather than swallowing it", () => {
    const onChange = jest.fn();
    render(<ScoringModeToggle value="+10" onChange={onChange} />);

    fireEvent.press(screen.getByText("+10"));

    expect(onChange).toHaveBeenCalledWith("+10");
  });
});
