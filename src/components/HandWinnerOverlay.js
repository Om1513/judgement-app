import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Animated, Easing } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

/**
 * Centered "X wins the hand!" announcement shown over the game table after a
 * trick completes. Visibility is fully controlled by the parent (driven by the
 * backend hand:winner-announced / hand:next-started events) so bots and humans
 * stay in sync. Pops in, then fades out when `visible` becomes false.
 */
export default function HandWinnerOverlay({ visible, winnerName }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.6)).current;
  const glow = useRef(new Animated.Value(0.4)).current;

  // Keep the last name on screen during the fade-out animation.
  const [shouldRender, setShouldRender] = useState(visible);
  const [displayName, setDisplayName] = useState(winnerName);

  useEffect(() => {
    if (visible) {
      setShouldRender(true);
      if (winnerName) setDisplayName(winnerName);

      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 220,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.spring(scale, {
          toValue: 1,
          friction: 5,
          tension: 90,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: 280,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 0.85,
          duration: 280,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) {
          setShouldRender(false);
          scale.setValue(0.6);
        }
      });
    }
  }, [visible, winnerName]);

  // Soft pulsing glow on the gold border while visible.
  useEffect(() => {
    if (!visible) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 0.4,
          duration: 700,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [visible]);

  if (!shouldRender) return null;

  return (
    <View style={styles.overlay} pointerEvents="none">
      <Animated.View
        style={[
          styles.cardWrapper,
          { opacity, transform: [{ scale }] },
        ]}
      >
        {/* Glow layer behind the card */}
        <Animated.View style={[styles.glowLayer, { opacity: glow }]} />

        <LinearGradient
          colors={["rgba(74, 38, 130, 0.96)", "rgba(42, 22, 84, 0.97)"]}
          style={styles.card}
        >
          <Text style={styles.crown}>👑</Text>
          <Text style={styles.sparkle}>✦ ✧ ✦</Text>
          <Text style={styles.winnerName} numberOfLines={1}>
            {displayName || "Someone"}
          </Text>
          <Text style={styles.subtitle}>wins the hand!</Text>
        </LinearGradient>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 500,
  },
  cardWrapper: {
    alignItems: "center",
    justifyContent: "center",
  },
  glowLayer: {
    position: "absolute",
    top: -8,
    left: -8,
    right: -8,
    bottom: -8,
    borderRadius: 24,
    backgroundColor: "rgba(255, 215, 0, 0.25)",
    shadowColor: "#FFD700",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 24,
    elevation: 16,
  },
  card: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 22,
    paddingHorizontal: 38,
    borderRadius: 20,
    borderWidth: 2.5,
    borderColor: "#FFD700",
    minWidth: 220,
  },
  crown: {
    fontSize: 34,
    marginBottom: 2,
  },
  sparkle: {
    fontSize: 13,
    color: "#FFE566",
    letterSpacing: 3,
    marginBottom: 8,
  },
  winnerName: {
    fontSize: 30,
    fontFamily: "Bangers_400Regular",
    color: "#FF9D2E",
    letterSpacing: 1.5,
    textShadowColor: "rgba(255, 165, 0, 0.6)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 14,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 18,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    letterSpacing: 1.5,
    marginTop: 2,
  },
});
