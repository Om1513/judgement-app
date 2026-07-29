// The grey ⓘ on the settings cards.
//
// Three things have to hold: the detail is hidden until asked for, the ✕ closes
// it, and a tap outside closes it. The last one is the easiest to break by
// nesting the panel wrongly inside the scrim.

import React from "react";
import { Text } from "react-native";
import { render, screen, fireEvent } from "@testing-library/react-native";

import InfoHint from "../InfoHint";
import audioManager from "../../services/audioManager";

const setup = (props = {}) =>
  render(
    <InfoHint title="TRUMP ORDER" {...props}>
      <Text>Trump follows a fixed cycle.</Text>
    </InfoHint>
  );

describe("InfoHint", () => {
  it("shows only the info glyph at rest", () => {
    setup();

    expect(screen.getByText("ⓘ")).toBeTruthy();
    expect(screen.queryByText("TRUMP ORDER")).toBeNull();
    expect(screen.queryByText("Trump follows a fixed cycle.")).toBeNull();
  });

  it("carries no button chrome - just the glyph", () => {
    setup();

    const trigger = screen.getByLabelText("More information");
    const flattened = Object.assign({}, ...[trigger.props.style].flat(2).filter(Boolean));

    expect(flattened.backgroundColor).toBeUndefined();
    expect(flattened.borderWidth).toBeUndefined();
    expect(flattened.borderColor).toBeUndefined();
  });

  it("renders the glyph in grey, not the gold used for controls", () => {
    setup();
    const glyph = screen.getByText("ⓘ");
    const flattened = Object.assign({}, ...[glyph.props.style].flat(2).filter(Boolean));

    // The palette's muted grey, and pointedly not #FFD700.
    expect(flattened.color).toBe("#C9BEDC");
    expect(flattened.fontSize).toBe(22);
  });

  it("opens the panel when the glyph is tapped", () => {
    setup();

    fireEvent.press(screen.getByText("ⓘ"));

    expect(screen.getByText("TRUMP ORDER")).toBeTruthy();
    expect(screen.getByText("Trump follows a fixed cycle.")).toBeTruthy();
  });

  it("closes on the ✕", () => {
    setup();
    fireEvent.press(screen.getByText("ⓘ"));

    fireEvent.press(screen.getByText("✕"));

    expect(screen.queryByText("TRUMP ORDER")).toBeNull();
  });

  it("closes on a tap outside the panel", () => {
    setup();
    fireEvent.press(screen.getByText("ⓘ"));

    fireEvent.press(screen.getByTestId("info-hint-backdrop"));

    expect(screen.queryByText("TRUMP ORDER")).toBeNull();
  });

  it("does not close when the panel itself is tapped", () => {
    setup();
    fireEvent.press(screen.getByText("ⓘ"));

    fireEvent.press(screen.getByText("Trump follows a fixed cycle."));

    expect(screen.getByText("TRUMP ORDER")).toBeTruthy();
  });

  it("can be reopened after closing", () => {
    setup();

    fireEvent.press(screen.getByText("ⓘ"));
    fireEvent.press(screen.getByText("✕"));
    fireEvent.press(screen.getByText("ⓘ"));

    expect(screen.getByText("TRUMP ORDER")).toBeTruthy();
  });

  it("accepts a custom accessibility label for the trigger", () => {
    setup({ label: "How trump order works" });
    expect(screen.getByLabelText("How trump order works")).toBeTruthy();
  });

  it("clicks on open and on close", () => {
    setup();

    fireEvent.press(screen.getByText("ⓘ"));
    fireEvent.press(screen.getByText("✕"));

    expect(audioManager.playSound).toHaveBeenCalledTimes(2);
    expect(audioManager.playSound).toHaveBeenCalledWith("buttonPop");
  });

  it("renders without a title", () => {
    render(
      <InfoHint>
        <Text>Body only.</Text>
      </InfoHint>
    );

    fireEvent.press(screen.getByText("ⓘ"));

    expect(screen.getByText("Body only.")).toBeTruthy();
    expect(screen.getByText("✕")).toBeTruthy();
  });
});
