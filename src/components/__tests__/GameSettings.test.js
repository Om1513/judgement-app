// The three lobby settings controls. These decide how many rounds are played,
// how trump is chosen and how scores are awarded, so a broken control silently
// changes the rules of the game.

import React from "react";
import { View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { render, screen, fireEvent } from "@testing-library/react-native";

import RoundSelector from "../RoundSelector";
import OrderModeToggle from "../OrderModeToggle";
import ScoringModeToggle from "../ScoringModeToggle";

/** Collapses a possibly-nested RN style prop into one object. */
const flatten = (style) =>
  Object.assign({}, ...[style].flat(3).filter((s) => s && typeof s === "object"));

// Query by component type and style, not by counting `.parent` hops: the
// gradient alone sits behind four wrapper nodes, so depth-based traversal is
// only ever accidentally right.
const styleOf = (node) => flatten(node.props.style);
const gradients = (r) => r.UNSAFE_queryAllByType(LinearGradient).map(styleOf);
const gradientColours = (r) => r.UNSAFE_queryAllByType(LinearGradient).map((n) => n.props.colors);
const viewsWhere = (r, predicate) =>
  r.UNSAFE_queryAllByType(View).map(styleOf).filter(predicate);

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

  // Regression guards. The glow used to be a solid gold box bleeding 5px on all
  // four sides, which made "+1" light up the whole side (it bled under the
  // translucent neighbour) and left "+10"'s right edge dim (the neighbour
  // painted over the bleed).
  it("gives the digits room to overshoot, so they are not cropped", () => {
    render(<ScoringModeToggle value="+10" onChange={() => {}} />);

    for (const label of ["+10", "+1"]) {
      const style = flatten(screen.getByText(label).props.style);

      expect(style.fontFamily).toBe("Bangers_400Regular");
      // Padding on the Text's own box, not a pinned lineHeight: Bangers reports
      // metrics that clip its digits at this size, and a fixed line box only
      // moves the crop.
      expect(style.lineHeight).toBeUndefined();
      expect(style.paddingTop).toBeGreaterThan(0);
      expect(style.paddingHorizontal).toBeGreaterThan(0);
    }
  });

  it("cannot be compressed by the row it sits in", () => {
    const r = render(<ScoringModeToggle value="+10" onChange={() => {}} />);

    // The card lays the toggle out beside the ⓘ; shrinking crops "+10".
    const [row] = viewsWhere(r, (s) => s.flexDirection === "row");
    expect(row.flexShrink).toBe(0);
  });

  it("sizes both halves identically, with room to spare for the wider label", () => {
    const boxes = gradients(render(<ScoringModeToggle value="+10" onChange={() => {}} />));

    expect(boxes).toHaveLength(2);
    expect(boxes[0].minWidth).toBe(boxes[1].minWidth);
    // Room left for the glyphs after the horizontal padding. "+10" at 20px
    // Bangers runs to roughly 34px, so this must stay comfortably above it.
    const room = boxes[0].minWidth - 2 * boxes[0].paddingHorizontal;
    expect(room).toBeGreaterThanOrEqual(44);
  });

  it("haloes the selected half on all four sides, seam included", () => {
    const r = render(<ScoringModeToggle value="+1" onChange={() => {}} />);

    // The glow layers are the only views painted solid gold.
    const glows = viewsWhere(r, (s) => s.backgroundColor === "#FFD700");
    expect(glows).toHaveLength(2);

    for (const glow of glows) {
      for (const side of ["top", "right", "bottom", "left"]) {
        expect(glow[side]).toBeLessThan(0);
      }
    }
  });

  it("raises the selected half so its halo is not painted over at the seam", () => {
    // "+10" is the first child, so without this its right-hand halo would be
    // covered by "+1" - the "right side stays dim" bug.
    const first = render(<ScoringModeToggle value="+10" onChange={() => {}} />);
    const halves = viewsWhere(first, (s) => s.position === "relative");

    expect(halves).toHaveLength(2);
    expect(halves[0].zIndex ?? 0).toBeGreaterThan(halves[1].zIndex ?? 0);

    // And the other way round when "+1" is selected.
    const second = render(<ScoringModeToggle value="+1" onChange={() => {}} />);
    const flipped = viewsWhere(second, (s) => s.position === "relative");
    expect(flipped[1].zIndex ?? 0).toBeGreaterThan(flipped[0].zIndex ?? 0);
  });

  it("draws the unselected half opaque, so no glow can shine through it", () => {
    const r = render(<ScoringModeToggle value="+1" onChange={() => {}} />);

    // "+10" is unselected here, and it is the first gradient. Any alpha in its
    // colours lets the neighbouring halo bleed through - the original "+1 lights
    // up the whole side" bug.
    const [unselected] = gradientColours(r);
    for (const colour of unselected) {
      expect(colour).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});
