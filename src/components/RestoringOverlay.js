// What the player sees while the app is asking the server whether they are
// still in a game.
//
// It covers Home rather than replacing it, so the startup sequence has no gap:
// the artwork is already the home background, and the pill is the same one the
// lobby uses for "Waiting for host to start the game...". Nothing new is
// introduced - if this appears for a moment and then the lobby opens, it reads
// as the same screen settling rather than a flash of a different app.

import React from "react";
import { ActivityIndicator, ImageBackground, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useScaledStyles } from "../utils/responsive";

export default function RestoringOverlay({ message = "Restoring game..." }) {
  const styles = useScaledStyles(rawStyles);

  return (
    <View style={styles.container} pointerEvents="auto">
      <ImageBackground
        source={require("../../assets/background.png")}
        style={styles.background}
        resizeMode="cover"
      >
        <LinearGradient
          colors={["transparent", "rgba(26, 16, 48, 0.2)", "rgba(26, 16, 48, 0.5)"]}
          style={styles.bottomGradient}
        />

        <View style={styles.pillRow}>
          <View style={styles.pill}>
            <ActivityIndicator size="small" color="#FFD000" />
            <Text style={styles.pillText} accessibilityRole="text">
              {message}
            </Text>
          </View>
        </View>
      </ImageBackground>
    </View>
  );
}

const rawStyles = {
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#1a1030",
  },
  background: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
  bottomGradient: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: "50%",
  },
  // Sits where Home's Create / Join row sits, so the pill occupies space the eye
  // is already resting on rather than jumping to the middle of the artwork.
  pillRow: {
    position: "absolute",
    bottom: "12%",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 22,
    backgroundColor: "rgba(42, 22, 84, 0.8)",
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#5E3A9E",
  },
  pillText: {
    fontSize: 18,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    letterSpacing: 0.5,
    marginLeft: 10,
  },
};
