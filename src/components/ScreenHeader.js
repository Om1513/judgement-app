// The app's top bar.
//
// One bar used by every screen that has a title and/or corner controls, so the
// title always sits on the same line as the buttons, at the same height, in the
// same type. Previously each screen rolled its own and they had drifted to
// three different title sizes and four different vertical positions.
//
// Buttons go in via `left` / `right` and should be rendered with the `inline`
// prop so they lay out in a row rather than pinning themselves to a corner.
//
//   <ScreenHeader
//     title="Game Settings"
//     left={<><CircleIconButton inline .../><SoundToggleButton inline /></>}
//   />

import React, { useMemo } from "react";
import { View, Text } from "react-native";
import { useResponsive, useScaledStyles } from "../utils/responsive";
import { getCircleButtonSize } from "./CircleIconButton";

// Baseline (iPhone 17 Pro) metrics. Tall enough for the 52px circle buttons
// with a little breathing room. Screens that compute their own layout budget
// (the scoreboards) should call useHeaderMetrics() rather than using these
// directly, since the rendered bar scales with the viewport.
export const HEADER_HEIGHT = 54;
export const HEADER_MARGIN_BOTTOM = 12;
// Horizontal inset for the button clusters, so they don't sit hard against the
// screen edge.
export const HEADER_SIDE_INSET = 10;

/**
 * The bar's real height on this viewport, plus the total vertical space it
 * occupies. The scoreboards subtract `block` from the screen to work out how
 * much room the score table has.
 */
export function useHeaderMetrics() {
  const { scale, s } = useResponsive();

  return useMemo(() => {
    // Never shorter than the circles it contains, which on a small phone stop
    // scaling at the minimum tap target while the rest of the bar keeps going.
    const height = Math.max(s(HEADER_HEIGHT), getCircleButtonSize(scale) + s(2));
    const marginBottom = s(HEADER_MARGIN_BOTTOM);
    // Plainly scaled, NOT widened by the safe-area inset. In landscape the
    // cutout inset falls on a side and runs to ~59pt, which dragged the corner
    // clusters most of an inch inboard - and on the screens that also pad their
    // content box it was applied twice, so the back button ended up nearer the
    // title than the edge. The buttons are round, inset, and sit over artwork,
    // so the corner radius is not a real collision.
    const sideInset = s(HEADER_SIDE_INSET);
    return {
      height,
      marginBottom,
      block: height + marginBottom,
      leftInset: sideInset,
      rightInset: sideInset,
    };
  }, [scale, s]);
}

export default function ScreenHeader({ title, left, right, titleStyle, style }) {
  const { s } = useResponsive();
  const styles = useScaledStyles(rawStyles);
  const metrics = useHeaderMetrics();

  // The title is centred on the screen, so it needs clearance from BOTH button
  // clusters - a long title (a player name plus "'s Lobby") would otherwise run
  // under them. The side inset plus room for two circle buttons.
  const titleClearance = useMemo(
    () => ({ paddingHorizontal: metrics.leftInset + s(130) }),
    [metrics.leftInset, s]
  );

  return (
    <View
      style={[
        styles.bar,
        { height: metrics.height, marginBottom: metrics.marginBottom },
        style,
      ]}
    >
      {/* Slots are absolute so the title stays centred on the screen rather
          than in the gap between whatever buttons happen to be present. */}
      {left ? (
        <View style={[styles.slot, { left: metrics.leftInset }]}>{left}</View>
      ) : null}

      {title ? (
        <Text style={[styles.title, titleClearance, titleStyle]} numberOfLines={1}>
          {title}
        </Text>
      ) : null}

      {right ? (
        <View style={[styles.slot, { right: metrics.rightInset }]}>{right}</View>
      ) : null}
    </View>
  );
}

const rawStyles = {
  bar: {
    alignItems: "center",
    justifyContent: "center",
  },
  slot: {
    position: "absolute",
    top: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 12,
  },
  title: {
    fontSize: 38,
    fontFamily: "Bangers_400Regular",
    color: "#FFD700",
    letterSpacing: 2,
    textShadowColor: "rgba(255, 165, 0, 0.5)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 18,
    // Sized to the bar so the text block matches the buttons' height.
    lineHeight: 46,
    includeFontPadding: false,
    textAlign: "center",
  },
};
