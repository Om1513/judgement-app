import React, { useEffect, useRef } from "react";
import { View, Animated, StyleSheet, Dimensions, Easing } from "react-native";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

// Kachuful theme confetti colors: gold, orange, purple, white.
const COLORS = ["#FFD700", "#FF8C00", "#7E3FF2", "#FFFFFF", "#FF9D2E", "#5E3A9E"];

// Deterministic pseudo-random so we never call Math.random at module scope and
// pieces are stable across re-renders.
function rand(seed) {
  const x = Math.sin(seed * 99.13) * 43758.5453;
  return x - Math.floor(x);
}

function ConfettiPiece({ index, loop }) {
  const fall = useRef(new Animated.Value(0)).current;

  const startX = rand(index + 1) * SCREEN_W;
  const drift = (rand(index + 2) - 0.5) * 120;
  const size = 7 + Math.floor(rand(index + 3) * 8);
  const color = COLORS[index % COLORS.length];
  const delay = Math.floor(rand(index + 4) * 900);
  const duration = 2200 + Math.floor(rand(index + 5) * 900);
  const rounded = rand(index + 6) > 0.5;

  useEffect(() => {
    const run = () => {
      fall.setValue(0);
      Animated.timing(fall, {
        toValue: 1,
        duration,
        delay,
        easing: Easing.linear,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished && loop) run();
      });
    };
    run();
  }, []);

  const translateY = fall.interpolate({
    inputRange: [0, 1],
    outputRange: [-40, SCREEN_H + 40],
  });
  const translateX = fall.interpolate({
    inputRange: [0, 1],
    outputRange: [0, drift],
  });
  const rotate = fall.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", `${rand(index + 7) > 0.5 ? "" : "-"}${360 + Math.floor(rand(index + 8) * 360)}deg`],
  });
  const opacity = fall.interpolate({
    inputRange: [0, 0.1, 0.85, 1],
    outputRange: [0, 1, 1, 0],
  });

  return (
    <Animated.View
      style={[
        styles.piece,
        {
          left: startX,
          width: size,
          height: size * (rounded ? 1 : 1.6),
          borderRadius: rounded ? size : 2,
          backgroundColor: color,
          opacity,
          transform: [{ translateY }, { translateX }, { rotate }],
        },
      ]}
    />
  );
}

/**
 * Lightweight Animated-based confetti burst in the Kachuful theme colors.
 * No native dependency required. Defaults to ~50 pieces.
 */
export default function ConfettiCelebration({ count = 50, loop = true }) {
  const pieces = Array.from({ length: count }, (_, i) => i);
  return (
    <View style={styles.container} pointerEvents="none">
      {pieces.map((i) => (
        <ConfettiPiece key={i} index={i} loop={loop} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
    zIndex: 10,
  },
  piece: {
    position: "absolute",
    top: 0,
  },
});
