// Responsive behaviour, exercised through real components rather than the
// helpers in isolation.
//
// The maths is covered in src/utils/__tests__; what this file protects is the
// wiring - that a component actually consults the viewport, that the reference
// device still gets the reference numbers, and that the rules which exist for
// usability (minimum tap targets, readable type) survive on a small screen.

import React from "react";
import { Dimensions, StyleSheet, Text, View } from "react-native";
import { render } from "@testing-library/react-native";

import CircleIconButton, { getCircleButtonSize } from "../CircleIconButton";
import RuleSection, { RuleText, RuleBullet } from "../RuleSection";
import SuitLegend, { TrumpOrder } from "../SuitLegend";
import RuleExample, { Chip, CounterExample, ExampleLine } from "../RuleExample";
import ScoringExample from "../ScoringExample";
import { MIN_TOUCH_TARGET, getScaleFactor, useScaledStyles } from "../../utils/responsive";

const BASELINE = { width: 874, height: 402, scale: 3, fontScale: 1 };
const SMALL_PHONE = { width: 640, height: 360, scale: 2, fontScale: 1 };
const TABLET = { width: 1024, height: 768, scale: 2, fontScale: 1 };

function setViewport(viewport) {
  Dimensions.set({ window: viewport, screen: viewport });
}

afterEach(() => setViewport(BASELINE));

describe("a component reads the live viewport", () => {
  const rawStyles = { box: { width: 100, fontSize: 20 } };

  function Probe() {
    const styles = useScaledStyles(rawStyles);
    const flat = StyleSheet.flatten(styles.box);
    return (
      <View>
        <Text testID="width">{String(flat.width)}</Text>
        <Text testID="fontSize">{String(flat.fontSize)}</Text>
      </View>
    );
  }

  const measure = (viewport) => {
    setViewport(viewport);
    const { getByTestId, unmount } = render(<Probe />);
    const out = {
      width: Number(getByTestId("width").children[0]),
      fontSize: Number(getByTestId("fontSize").children[0]),
    };
    unmount();
    return out;
  };

  it("renders the reference numbers untouched on the reference device", () => {
    expect(measure(BASELINE)).toEqual({ width: 100, fontSize: 20 });
  });

  it("shrinks geometry on a small phone, and type by less", () => {
    const small = measure(SMALL_PHONE);
    expect(small.width).toBeLessThan(100);
    expect(small.fontSize).toBeLessThan(20);
    expect(20 - small.fontSize).toBeLessThan(100 - small.width);
  });

  it("grows on a tablet", () => {
    const tablet = measure(TABLET);
    expect(tablet.width).toBeGreaterThan(100);
    expect(tablet.fontSize).toBeGreaterThan(20);
  });
});

describe("circle buttons", () => {
  it("are exactly the designed 52pt on the reference device", () => {
    expect(getCircleButtonSize(getScaleFactor(BASELINE.width, BASELINE.height))).toBe(52);
  });

  it("stop shrinking at the minimum tap target", () => {
    for (const viewport of [BASELINE, SMALL_PHONE, TABLET, { width: 480, height: 320 }]) {
      const size = getCircleButtonSize(getScaleFactor(viewport.width, viewport.height));
      expect(size).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    }
  });

  it("keep a hitSlop that clears the minimum however small they render", () => {
    setViewport(SMALL_PHONE);
    const { getByLabelText } = render(
      <CircleIconButton glyph="?" accessibilityLabel="How to play" />
    );
    const slop = getByLabelText("How to play").props.hitSlop;
    const size = getCircleButtonSize(getScaleFactor(SMALL_PHONE.width, SMALL_PHONE.height));
    expect(size + slop.left + slop.right).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  });

  it("space a row of three evenly from the rendered diameter", () => {
    // What every screen's control row does: stride = diameter + gap.
    for (const viewport of [BASELINE, SMALL_PHONE, TABLET]) {
      const scale = getScaleFactor(viewport.width, viewport.height);
      const size = getCircleButtonSize(scale);
      const stride = size + 12 * scale;
      // No overlap between neighbours, and no runaway gap.
      expect(stride).toBeGreaterThan(size);
      expect(stride - size).toBeLessThan(size);
    }
  });
});

describe("the shared rule components render at every viewport", () => {
  // These all share one stylesheet across several exported components, which is
  // exactly the shape that breaks if one of them is not wired to the scaled
  // sheet. Rendering them is the cheapest way to catch that.
  const tree = (
    <View>
      <RuleSection icon="🎯" title="Objective">
        <RuleText>Predict how many hands you will win.</RuleText>
        <RuleBullet>Follow the lead suit if you hold it.</RuleBullet>
        <RuleExample label="Successful judgement" tone="good">
          <ExampleLine left="Bid 2" right="Win exactly 2" tone="good" />
        </RuleExample>
        <Chip highlighted>1</Chip>
        <CounterExample won={1} bid={2} />
        <SuitLegend />
        <TrumpOrder />
        <ScoringExample mode="+10 mode" score={(bid) => bid * 10} />
      </RuleSection>
    </View>
  );

  for (const [name, viewport] of Object.entries({
    baseline: BASELINE,
    smallPhone: SMALL_PHONE,
    tablet: TABLET,
  })) {
    it(`renders on ${name} without a missing stylesheet`, () => {
      setViewport(viewport);
      const { getByText } = render(tree);
      expect(getByText("Objective")).toBeTruthy();
    });
  }
});
