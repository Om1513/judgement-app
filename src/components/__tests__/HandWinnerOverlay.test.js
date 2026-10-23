// The "X wins the hand!" popup.
//
// It has to float over the table, never take up room in it. React Native 0.86
// removed StyleSheet.absoluteFillObject, and spreading the now-undefined value
// silently dropped `position: absolute`: the popup was laid out at the bottom of
// the screen, squeezing the table so the side seats jumped up until it closed.

import React from "react";
import { StyleSheet } from "react-native";
import { render } from "@testing-library/react-native";

import HandWinnerOverlay from "../HandWinnerOverlay";

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe("HandWinnerOverlay", () => {
  it("fills the screen out of the layout flow while visible", () => {
    const { toJSON, unmount } = render(<HandWinnerOverlay visible winnerName="P1" />);
    const style = StyleSheet.flatten(toJSON().props.style);

    expect(style).toMatchObject({ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 });
    unmount();
  });
});
