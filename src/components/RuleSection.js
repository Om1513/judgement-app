// A single rule card on the How to Play screen.
//
// Glass panel in the app's purple/gold treatment: an icon and title on one
// line, then whatever content the caller passes. Sized by the parent so the
// screen can lay cards out in one or two columns depending on width.

import React from "react";
import { View, Text } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useScaledStyles } from "../utils/responsive";

export default function RuleSection({ icon, title, children, style }) {
  const styles = useScaledStyles(rawStyles);
  return (
    <View style={[styles.wrapper, style]}>
      <LinearGradient
        colors={["rgba(61, 34, 114, 0.92)", "rgba(42, 22, 84, 0.95)"]}
        style={styles.card}
      >
        <View style={styles.titleRow}>
          {icon ? <Text style={styles.icon}>{icon}</Text> : null}
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.body}>{children}</View>
      </LinearGradient>
    </View>
  );
}

/** Plain explanatory line inside a card. Kept short by design. */
export function RuleText({ children, style }) {
  const styles = useScaledStyles(rawStyles);
  return <Text style={[styles.text, style]}>{children}</Text>;
}

/** Bulleted point, for lists of conditions. */
export function RuleBullet({ children }) {
  const styles = useScaledStyles(rawStyles);
  return (
    <View style={styles.bulletRow}>
      <Text style={styles.bulletDot}>•</Text>
      <Text style={styles.bulletText}>{children}</Text>
    </View>
  );
}

const rawStyles = {
  wrapper: {
    marginBottom: 12,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "rgba(255, 215, 0, 0.45)",
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  icon: {
    fontSize: 20,
    marginRight: 8,
  },
  title: {
    flex: 1,
    fontSize: 20,
    fontFamily: "Bangers_400Regular",
    color: "#FFD700",
    letterSpacing: 1.5,
  },
  divider: {
    height: 1,
    backgroundColor: "rgba(255, 215, 0, 0.28)",
    marginTop: 7,
    marginBottom: 9,
  },
  body: {
    // Children space themselves; the card just frames them.
  },
  text: {
    fontSize: 14,
    lineHeight: 19,
    fontFamily: "Inter_400Regular",
    color: "#EDE6FA",
  },
  bulletRow: {
    flexDirection: "row",
    marginTop: 4,
  },
  bulletDot: {
    fontSize: 14,
    lineHeight: 19,
    color: "#FFD700",
    marginRight: 6,
  },
  bulletText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
    fontFamily: "Inter_400Regular",
    color: "#EDE6FA",
  },
};
