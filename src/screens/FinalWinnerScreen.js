import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  ImageBackground,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  Dimensions,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { useFonts, Bangers_400Regular } from "@expo-google-fonts/bangers";
import ConfettiCelebration from "../components/ConfettiCelebration";

const { height: SCREEN_H } = Dimensions.get("window");
// The painted gold ring fills most of the screen height; size the winner
// circle to sit just inside it.
const CIRCLE = Math.min(SCREEN_H * 0.62, 360);

// How long the celebration plays before auto-advancing to the scoreboard.
const AUTO_ADVANCE_MS = 7000;

/**
 * Joins winner names: "Om", "Om & Yukta", "Om, Yukta & Raj".
 */
function formatNames(names) {
  if (!names.length) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

export default function FinalWinnerScreen({ navigation, route }) {
  const {
    winners = [],
    winningScore = 0,
    isTie = false,
    currentPlayerId = "",
    currentPlayerName = "",
  } = route.params || {};

  const fade = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.4)).current;
  const glow = useRef(new Animated.Value(0.45)).current;

  const [fontsLoaded] = useFonts({ Bangers_400Regular });

  const names = formatNames(winners.map((w) => w.name));

  const goToScoreboard = () => {
    navigation.replace("FinalScoreboard", {
      currentPlayerId,
      currentPlayerName,
      winnerIds: winners.map((w) => w.id),
    });
  };

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 450,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        friction: 6,
        tension: 60,
        useNativeDriver: true,
      }),
    ]).start();

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 850, useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0.45, duration: 850, useNativeDriver: true }),
      ])
    );
    loop.start();

    const timer = setTimeout(goToScoreboard, AUTO_ADVANCE_MS);
    return () => {
      loop.stop();
      clearTimeout(timer);
    };
  }, []);

  if (!fontsLoaded) {
    return <View style={styles.container} />;
  }

  return (
    <View style={styles.container}>
      <ImageBackground
        source={require("../../assets/winner_screen.png")}
        style={styles.background}
        resizeMode="cover"
      >
        {/* Confetti runs for ~3s in theme colors */}
        <ConfettiCelebration count={60} loop />

        {/* Winner content centered inside the painted gold ring */}
        <View style={styles.center} pointerEvents="box-none">
          <Animated.View
            style={[
              styles.circle,
              { opacity: fade, transform: [{ scale }] },
            ]}
          >
            <Animated.View style={[styles.circleGlow, { opacity: glow }]} />

            <Text style={styles.crown}>👑</Text>
            <Text style={styles.heading}>{isTie ? "Winners!" : "Winner!"}</Text>
            <Text style={styles.winnerName} numberOfLines={2} adjustsFontSizeToFit>
              {names}
            </Text>
            <Text style={styles.sparkle}>✦ ✧ ✦</Text>
            <Text style={styles.finalScore}>Final Score: {winningScore}</Text>
          </Animated.View>
        </View>

        {/* Optional manual transition */}
        <TouchableOpacity
          style={styles.viewButton}
          activeOpacity={0.85}
          onPress={goToScoreboard}
        >
          <LinearGradient
            colors={["#FF8C00", "#FF6600", "#E65500"]}
            style={styles.viewButtonGradient}
          >
            <Text style={styles.viewButtonText}>VIEW SCOREBOARD</Text>
          </LinearGradient>
        </TouchableOpacity>

        <StatusBar style="light" hidden />
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0612",
  },
  background: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: CIRCLE * 0.12,
  },
  circleGlow: {
    position: "absolute",
    width: CIRCLE * 0.92,
    height: CIRCLE * 0.92,
    borderRadius: (CIRCLE * 0.92) / 2,
    backgroundColor: "rgba(255, 215, 0, 0.10)",
    shadowColor: "#FFD700",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 40,
    elevation: 18,
  },
  crown: {
    fontSize: 46,
    marginBottom: 2,
  },
  heading: {
    fontSize: 40,
    fontFamily: "Bangers_400Regular",
    color: "#FFD700",
    letterSpacing: 3,
    textShadowColor: "rgba(255, 165, 0, 0.7)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
  },
  winnerName: {
    fontSize: 44,
    fontFamily: "Bangers_400Regular",
    color: "#FF9D2E",
    letterSpacing: 2,
    textAlign: "center",
    marginTop: 4,
    textShadowColor: "rgba(255, 165, 0, 0.85)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 18,
  },
  sparkle: {
    fontSize: 16,
    color: "#FFE566",
    letterSpacing: 5,
    marginTop: 6,
  },
  finalScore: {
    fontSize: 22,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    letterSpacing: 1.5,
    marginTop: 10,
  },
  viewButton: {
    position: "absolute",
    bottom: 24,
    alignSelf: "center",
    borderRadius: 14,
    overflow: "hidden",
    shadowColor: "#FF6600",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 10,
  },
  viewButtonGradient: {
    paddingVertical: 11,
    paddingHorizontal: 40,
    borderRadius: 12,
  },
  viewButtonText: {
    fontSize: 17,
    fontFamily: "Bangers_400Regular",
    color: "#FFFFFF",
    letterSpacing: 2,
    textShadowColor: "rgba(0, 0, 0, 0.5)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
});
