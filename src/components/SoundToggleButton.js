// Sound on/off button.
//
// Unlike the in-game settings gear this toggles directly with no menu - one
// tap, and the icon itself reports the state: a gold note when sound is on,
// dimmed and struck through when it is off.
//
// A text glyph plus a drawn slash rather than an icon font, so it tints to the
// theme's gold and needs no extra dependency.

import React from "react";
import { View, StyleSheet } from "react-native";
import audioManager from "../services/audioManager";
import useSoundEnabled from "../hooks/useSoundEnabled";
import CircleIconButton, { CIRCLE_BUTTON_SIZE } from "./CircleIconButton";

export default function SoundToggleButton({ style, inline = false }) {
  const soundEnabled = useSoundEnabled();

  return (
    <CircleIconButton
      glyph="♪"
      dimmed={!soundEnabled}
      onPress={() => audioManager.setSoundEnabled(!soundEnabled)}
      style={style}
      inline={inline}
      accessibilityRole="switch"
      accessibilityState={{ checked: soundEnabled }}
      accessibilityLabel={soundEnabled ? "Mute sound" : "Unmute sound"}
    >
      {/* Struck through when muted - the "slash" half of the state. */}
      {!soundEnabled && <View style={styles.slash} pointerEvents="none" />}
    </CircleIconButton>
  );
}

const styles = StyleSheet.create({
  // No default offsets on purpose. The button is absolutely positioned, so a
  // built-in `bottom`/`left` would survive a caller that only sets `top`/`right`
  // - the box would then be anchored to both edges and stretch into a bar
  // instead of staying a circle. Every screen supplies its own position.
  slash: {
    position: "absolute",
    width: CIRCLE_BUTTON_SIZE * 0.62,
    height: 2.5,
    borderRadius: 2,
    backgroundColor: "#FF5D6C",
    transform: [{ rotate: "-45deg" }],
  },
});
