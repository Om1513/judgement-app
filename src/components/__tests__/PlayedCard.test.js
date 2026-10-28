// A card on the table. Other players' cards slide in from their side; ours has
// already been flown into place by the hand, so it mounts settled.

import React from "react";
import { render } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import PlayedCard from "../PlayedCard";

const zone = { left: 400, top: 180, width: 54, height: 76, enterFrom: { x: 0, y: 26 } };
const card = { suit: "spades", rank: "9" };

/** The card's transform on its first frame, as plain numbers. */
function firstFrame(element) {
  const { toJSON } = render(element);
  const style = StyleSheet.flatten(toJSON().props.style);
  return Object.assign({}, ...style.transform);
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe("PlayedCard", () => {
  it("slides in from its player's side by default", () => {
    const t = firstFrame(<PlayedCard card={card} zone={zone} />);
    expect(t.translateY).toBe(26);
    expect(t.scale).toBeGreaterThan(1);
  });

  it("mounts already in place when settled", () => {
    const t = firstFrame(<PlayedCard card={card} zone={zone} settled />);
    expect(t.translateX).toBe(0);
    expect(t.translateY).toBe(0);
    expect(t.scale).toBe(1);
  });
});
