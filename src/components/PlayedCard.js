import React, { useEffect, useRef, memo } from "react";
import { Animated, Easing, Text } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useScaledStyles } from "../utils/responsive";

const SUIT_SYMBOLS = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};

/**
 * A single played card that lives in a player's seat card-zone.
 *
 * - On mount it animates in from the player's side (a small "lift + travel"),
 *   settles with a spring bounce, and flashes a gold glow.
 * - When `resolving` flips true (the trick has a winner) it slides toward the
 *   winner's seat (via `resolveDelta`) and fades out before unmounting.
 *
 * Positioning is supplied by `zone`, already resolved against the measured
 * table rect by utils/tableLayout:
 *   left/top      - absolute pixel position within the table area
 *   width/height  - the card's scaled size
 *   enterFrom     - direction the card slides in from (px), toward its player
 */
function PlayedCard({ card, zone, resolving, resolveDelta }) {
  const enter = useRef(new Animated.Value(0)).current; // 0 -> 1 entrance
  const resolve = useRef(new Animated.Value(0)).current; // 0 -> 1 collect-to-winner
  const glow = useRef(new Animated.Value(0)).current;
  const styles = useScaledStyles(rawStyles);

  const isRed = card.suit === "hearts" || card.suit === "diamonds";

  useEffect(() => {
    Animated.parallel([
      Animated.spring(enter, {
        toValue: 1,
        friction: 6,
        tension: 70,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 0.4,
          duration: 420,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, []);

  useEffect(() => {
    if (resolving) {
      Animated.timing(resolve, {
        toValue: 1,
        duration: 600,
        delay: 250,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [resolving]);

  const { enterFrom = { x: 0, y: 0 } } = zone;
  const dx = resolveDelta?.x || 0;
  const dy = resolveDelta?.y || 0;

  const translateX = Animated.add(
    enter.interpolate({ inputRange: [0, 1], outputRange: [enterFrom.x, 0] }),
    resolve.interpolate({ inputRange: [0, 1], outputRange: [0, dx] })
  );
  const translateY = Animated.add(
    enter.interpolate({ inputRange: [0, 1], outputRange: [enterFrom.y, 0] }),
    resolve.interpolate({ inputRange: [0, 1], outputRange: [0, dy] })
  );
  const scale = enter.interpolate({ inputRange: [0, 1], outputRange: [1.12, 1] });
  const opacity = resolve.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.card,
        {
          left: zone.left,
          top: zone.top,
          width: zone.width,
          height: zone.height,
          opacity,
          transform: [{ translateX }, { translateY }, { scale }],
        },
      ]}
    >
      <Animated.View style={[styles.glowBorder, { opacity: glow }]} />
      <LinearGradient
        colors={["#FFFFFF", "#F7F7F7", "#E9E9E9"]}
        style={styles.inner}
      >
        <Text style={[styles.rank, isRed && styles.red]}>{card.rank}</Text>
        <Text style={[styles.suit, isRed && styles.red]}>
          {SUIT_SYMBOLS[card.suit]}
        </Text>
      </LinearGradient>
    </Animated.View>
  );
}

// Settled cards keep stable visuals, so only re-render when this card's own
// identity, its collect-to-winner state, or its slide target changes. Without
// this, mounting one new card re-renders every other played card — at 8 players
// that re-render storm (plus the new gradient/elevated view) can flash the
// whole table black for a frame.
function areEqual(prev, next) {
  return (
    prev.card?.suit === next.card?.suit &&
    prev.card?.rank === next.card?.rank &&
    prev.resolving === next.resolving &&
    (prev.resolveDelta?.x ?? null) === (next.resolveDelta?.x ?? null) &&
    (prev.resolveDelta?.y ?? null) === (next.resolveDelta?.y ?? null) &&
    // A resize moves every card, so the zone has to be part of the comparison -
    // otherwise the table would keep the old positions until something else
    // forced a re-render.
    prev.zone?.left === next.zone?.left &&
    prev.zone?.top === next.zone?.top &&
    prev.zone?.width === next.zone?.width
  );
}

export default memo(PlayedCard, areEqual);

// Baseline (iPhone 17 Pro) numbers; useScaledStyles maps them onto the current
// viewport. Width/height are overridden per card from the resolved zone so the
// card and its slot can never disagree.
const rawStyles = {
  card: {
    position: "absolute",
    width: 54,
    height: 76,
    borderRadius: 7,
    // Solid surface so Android renders the elevation shadow correctly instead
    // of painting it as a black box during the entrance transform.
    backgroundColor: "#FFFFFF",
    zIndex: 50,
    elevation: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.45,
    shadowRadius: 5,
  },
  glowBorder: {
    position: "absolute",
    top: -3,
    left: -3,
    right: -3,
    bottom: -3,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: "#FFD700",
    shadowColor: "#FFD700",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 12,
  },
  inner: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 7,
    overflow: "hidden",
  },
  rank: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#1a1a2e",
  },
  suit: {
    fontSize: 18,
    color: "#1a1a2e",
  },
  red: {
    color: "#e53935",
  },
};
