// Round glyph button in the Kachuful style: dark purple gradient, gold border,
// soft glow, spring press feedback.
//
// Shared by the sound toggle and the in-game back button so the two are
// genuinely identical rather than two lookalike copies that drift apart.
//
// `dimmed` renders the inactive treatment (no glow, muted border and glyph);
// `children` is for anything drawn over the glyph, such as the mute slash.

import React, { useMemo, useRef } from "react";
import { View, Text, Pressable, Animated } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import audioManager from "../services/audioManager";
import {
  MIN_TOUCH_TARGET,
  touchSlop,
  useResponsive,
  useScaledStyles,
} from "../utils/responsive";

export const CIRCLE_BUTTON_SIZE = 52;
// A circle may look smaller on a small phone, but it must never be harder to
// hit: below the minimum tap target the visual size stops shrinking.
const MAX_CIRCLE_SIZE = 72;

/**
 * The circle's rendered diameter for a given scale, and the gap-based stride a
 * screen should use when it puts two or three of them in a row. Screens ask for
 * this rather than hard-coding `left: 82`, which only worked at one size.
 */
export function getCircleButtonSize(scale) {
  return Math.min(Math.max(CIRCLE_BUTTON_SIZE * scale, MIN_TOUCH_TARGET), MAX_CIRCLE_SIZE);
}

/** Hook form: `{ size, stride(gap) }` for laying out a row of circle buttons. */
export function useCircleButtonMetrics() {
  const { scale, s } = useResponsive();
  return useMemo(() => {
    const size = getCircleButtonSize(scale);
    return { size, stride: (gap = 12) => size + s(gap) };
  }, [scale, s]);
}

export default function CircleIconButton({
  glyph,
  onPress,
  dimmed = false,
  children,
  style,
  glyphStyle,
  // Screens that place the button themselves get the default absolute wrapper;
  // `inline` drops that so it can sit in a normal row, which is what ScreenHeader
  // needs.
  inline = false,
  accessibilityLabel,
  accessibilityRole = "button",
  accessibilityState,
}) {
  const pressScale = useRef(new Animated.Value(1)).current;
  const { scale } = useResponsive();
  const styles = useScaledStyles(rawStyles);

  // The circle itself is floored at the minimum tap target rather than scaled
  // freely, so it cannot follow the rest of the design down on a small phone.
  const size = getCircleButtonSize(scale);
  const sizing = useMemo(
    () => ({
      circle: { width: size, height: size, borderRadius: size / 2 },
      pressable: { borderRadius: size / 2 },
      glow: { borderRadius: (size + 8) / 2 },
    }),
    [size]
  );

  const animateTo = (value) => {
    Animated.spring(pressScale, {
      toValue: value,
      friction: 6,
      tension: 160,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View
      style={[
        inline ? styles.wrapperInline : styles.wrapper,
        style,
        { transform: [{ scale: pressScale }] },
      ]}
    >
      {/* Glow only in the active state, so dimmed reads as visibly quieter. */}
      {!dimmed && <View style={[styles.glow, sizing.glow]} pointerEvents="none" />}

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
        hitSlop={touchSlop(size)}
        accessibilityRole={accessibilityRole}
        accessibilityState={accessibilityState}
        accessibilityLabel={accessibilityLabel}
        style={[styles.pressable, sizing.pressable]}
      >
        <LinearGradient
          colors={
            dimmed
              ? ["rgba(38, 24, 66, 0.9)", "rgba(26, 16, 48, 0.95)"]
              : ["rgba(61, 34, 114, 0.95)", "rgba(42, 22, 84, 0.97)"]
          }
          style={[styles.circle, sizing.circle, dimmed && styles.circleDimmed]}
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

const rawStyles = {
  // Positioning is the caller's job; these buttons are always placed absolutely
  // by the screen that owns them.
  wrapper: {
    position: "absolute",
    zIndex: 600,
    elevation: 12,
  },
  // Same button, laid out in normal flow instead of pinned to a corner.
  wrapperInline: {
    zIndex: 600,
    elevation: 12,
  },
  glow: {
    position: "absolute",
    top: -4,
    left: -4,
    right: -4,
    bottom: -4,
    backgroundColor: "rgba(255, 215, 0, 0.15)",
    shadowColor: "#FFD700",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 10,
    elevation: 8,
  },
  pressable: {
    overflow: "hidden",
  },
  circle: {
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
};
