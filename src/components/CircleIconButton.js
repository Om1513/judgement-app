// Round glyph button in the Kachuful style: dark purple gradient, gold border,
// soft glow, spring press feedback.
//
// Shared by the sound toggle and the in-game back button so the two are
// genuinely identical rather than two lookalike copies that drift apart.
//
// `dimmed` renders the inactive treatment (no glow, muted border and glyph);
// `children` is for anything drawn over the glyph, such as the mute slash.

import React, { useRef } from "react";
import { View, Text, StyleSheet, Pressable, Animated } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import audioManager from "../services/audioManager";

export const CIRCLE_BUTTON_SIZE = 52;

export default function CircleIconButton({
  glyph,
  onPress,
  dimmed = false,
  children,
  style,
  glyphStyle,
  accessibilityLabel,
  accessibilityRole = "button",
  accessibilityState,
}) {
  const pressScale = useRef(new Animated.Value(1)).current;

  const animateTo = (value) => {
    Animated.spring(pressScale, {
      toValue: value,
      friction: 6,
      tension: 160,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View style={[styles.wrapper, style, { transform: [{ scale: pressScale }] }]}>
      {/* Glow only in the active state, so dimmed reads as visibly quieter. */}
      {!dimmed && <View style={styles.glow} pointerEvents="none" />}

      <Pressable
        // Press sound lives here so back / sound / add-bot all get it once.
        // Note this fires before onPress, which matters for the sound toggle:
        // muting still gives you the pop that confirms the tap, and unmuting
        // stays silent because sound was off at press time.
        onPress={(event) => {
          audioManager.playSound("buttonPop");
          onPress?.(event);
        }}
        onPressIn={() => animateTo(0.92)}
        onPressOut={() => animateTo(1)}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole={accessibilityRole}
        accessibilityState={accessibilityState}
        accessibilityLabel={accessibilityLabel}
        style={styles.pressable}
      >
        <LinearGradient
          colors={
            dimmed
              ? ["rgba(38, 24, 66, 0.9)", "rgba(26, 16, 48, 0.95)"]
              : ["rgba(61, 34, 114, 0.95)", "rgba(42, 22, 84, 0.97)"]
          }
          style={[styles.circle, dimmed && styles.circleDimmed]}
        >
          <Text style={[styles.glyph, dimmed && styles.glyphDimmed, glyphStyle]}>
            {glyph}
          </Text>
          {children}
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

const SIZE = CIRCLE_BUTTON_SIZE;

const styles = StyleSheet.create({
  // Positioning is the caller's job; these buttons are always placed absolutely
  // by the screen that owns them.
  wrapper: {
    position: "absolute",
    zIndex: 600,
    elevation: 12,
  },
  glow: {
    position: "absolute",
    top: -4,
    left: -4,
    right: -4,
    bottom: -4,
    borderRadius: (SIZE + 8) / 2,
    backgroundColor: "rgba(255, 215, 0, 0.15)",
    shadowColor: "#FFD700",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 10,
    elevation: 8,
  },
  pressable: {
    borderRadius: SIZE / 2,
    overflow: "hidden",
  },
  circle: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#FFD700",
  },
  circleDimmed: {
    borderColor: "#5E3A9E",
  },
  glyph: {
    fontSize: 26,
    lineHeight: 30,
    color: "#FFD700",
    textShadowColor: "rgba(255, 215, 0, 0.6)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  glyphDimmed: {
    color: "#8B7BA8",
    textShadowColor: "transparent",
  },
});
