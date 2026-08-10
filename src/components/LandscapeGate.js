// Landscape is the only layout this game has.
//
// Native builds are locked to it (app.json `orientation: "landscape"`), so this
// never fires there. It exists for the web build, where the browser window can
// be any shape at all and a portrait viewport would otherwise render the table
// squashed into an unplayable ribbon. Rather than shipping a second design for
// a case that cannot happen on a phone, it asks for the rotation.

import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useResponsive } from "../utils/responsive";

export default function LandscapeGate({ children }) {
  const { isLandscape } = useResponsive();

  if (isLandscape) return children;

  return (
    <View style={styles.container}>
      <Text style={styles.glyph}>⟳</Text>
      <Text style={styles.title}>Rotate your device</Text>
      <Text style={styles.subtitle}>Judgement is played in landscape.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1030",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  glyph: {
    fontSize: 56,
    color: "#FFD700",
    marginBottom: 12,
  },
  title: {
    fontSize: 24,
    fontFamily: "Bangers_400Regular",
    color: "#FFD700",
    letterSpacing: 2,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: "#C9BEDC",
    textAlign: "center",
    marginTop: 6,
  },
});
