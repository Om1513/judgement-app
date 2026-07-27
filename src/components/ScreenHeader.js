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

import React from "react";
import { View, Text, StyleSheet } from "react-native";

// Tall enough for the 52px circle buttons with a little breathing room. Screens
// that compute their own layout budget (the scoreboards) import this rather
// than hard-coding it.
export const HEADER_HEIGHT = 54;
export const HEADER_MARGIN_BOTTOM = 12;
// Horizontal inset for the button clusters, so they don't sit hard against the
// screen edge.
export const HEADER_SIDE_INSET = 10;

export default function ScreenHeader({ title, left, right, titleStyle, style }) {
  return (
    <View style={[styles.bar, style]}>
      {/* Slots are absolute so the title stays centred on the screen rather
          than in the gap between whatever buttons happen to be present. */}
      {left ? <View style={[styles.slot, styles.leftSlot]}>{left}</View> : null}

      {title ? (
        <Text style={[styles.title, titleStyle]} numberOfLines={1}>
          {title}
        </Text>
      ) : null}

      {right ? <View style={[styles.slot, styles.rightSlot]}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: HEADER_HEIGHT,
    marginBottom: HEADER_MARGIN_BOTTOM,
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
  leftSlot: {
    left: HEADER_SIDE_INSET,
  },
  rightSlot: {
    right: HEADER_SIDE_INSET,
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
    // Keeps a long title (a player name plus "'s Lobby") clear of the buttons.
    paddingHorizontal: 140,
    textAlign: "center",
  },
});
