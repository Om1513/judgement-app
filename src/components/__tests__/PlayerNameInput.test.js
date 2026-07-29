// The name box on the home screen. Everything downstream keys off this value,
// so trimming and the length cap are the behaviour worth pinning.

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";

import PlayerNameInput from "../PlayerNameInput";

const setup = (props = {}) => {
  const onChangeText = jest.fn();
  const onSubmit = jest.fn();
  render(<PlayerNameInput value="" onChangeText={onChangeText} onSubmit={onSubmit} {...props} />);
  return { onChangeText, onSubmit, input: screen.getByPlaceholderText("Enter Your Name") };
};

describe("PlayerNameInput", () => {
  it("shows the default placeholder", () => {
    setup();
    expect(screen.getByPlaceholderText("Enter Your Name")).toBeTruthy();
  });

  it("accepts a custom placeholder", () => {
    render(<PlayerNameInput value="" onChangeText={() => {}} placeholder="Who are you?" />);
    expect(screen.getByPlaceholderText("Who are you?")).toBeTruthy();
  });

  it("reports each keystroke", () => {
    const { onChangeText, input } = setup();

    fireEvent.changeText(input, "Om");

    expect(onChangeText).toHaveBeenCalledWith("Om");
  });

  it("displays the value it is given", () => {
    render(<PlayerNameInput value="Omkar" onChangeText={() => {}} />);
    expect(screen.getByDisplayValue("Omkar")).toBeTruthy();
  });

  it("trims trailing whitespace when the field loses focus", () => {
    const { onChangeText, input } = setup({ value: "  Omkar  " });

    fireEvent(input, "blur");

    expect(onChangeText).toHaveBeenCalledWith("Omkar");
  });

  it("submits the trimmed name on the return key", () => {
    const { onSubmit, input } = setup({ value: "  Omkar " });

    fireEvent(input, "submitEditing");

    expect(onSubmit).toHaveBeenCalledWith("Omkar");
  });

  it("does not submit an empty or whitespace-only name", () => {
    const blank = setup({ value: "   " });
    fireEvent(blank.input, "submitEditing");
    expect(blank.onSubmit).not.toHaveBeenCalled();
  });

  it("caps the name at 20 characters, matching the server limit", () => {
    const { input } = setup();
    expect(input.props.maxLength).toBe(20);
  });

  it("turns off autocorrect so names are not mangled", () => {
    const { input } = setup();
    expect(input.props.autoCorrect).toBe(false);
  });
});
