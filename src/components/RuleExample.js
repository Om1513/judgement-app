// Small worked examples used inside rule cards, so the rules read as diagrams
// rather than paragraphs.

import React from "react";
import { View, Text } from "react-native";
import { useScaledStyles } from "../utils/responsive";

/**
 * An inset strip for a worked example. `tone` tints the left edge and label:
 * "good" for a successful judgement, "bad" for a missed one, "neutral" otherwise.
 */
export default function RuleExample({ label, children, tone = "neutral" }) {
  const styles = useScaledStyles(rawStyles);
  return (
    <View style={[styles.example, TONE_EDGE[tone]]}>
      {label ? <Text style={[styles.label, TONE_TEXT[tone]]}>{label}</Text> : null}
      <View style={styles.row}>{children}</View>
    </View>
  );
}

/** One "Bid 2 → win exactly 2" style line. */
export function ExampleLine({ left, right, tone = "neutral" }) {
  const styles = useScaledStyles(rawStyles);
  return (
    <View style={styles.line}>
      <Text style={styles.lineLeft}>{left}</Text>
      <Text style={[styles.lineArrow, TONE_TEXT[tone]]}>→</Text>
      <Text style={[styles.lineRight, TONE_TEXT[tone]]}>{right}</Text>
    </View>
  );
}

/** Pill used for bid options, round numbers, card ranks. */
export function Chip({ children, highlighted = false }) {
  const styles = useScaledStyles(rawStyles);
  return (
    <View style={[styles.chip, highlighted && styles.chipHighlighted]}>
      <Text style={[styles.chipText, highlighted && styles.chipTextHighlighted]}>
        {children}
      </Text>
    </View>
  );
}

/** The "1 / 2  Won / Bid" counter shown under each player in game. */
export function CounterExample({ won, bid }) {
  const styles = useScaledStyles(rawStyles);
  return (
    <View style={styles.counter}>
      <Text style={styles.counterValue}>
        {won} / {bid}
      </Text>
      <Text style={styles.counterCaption}>Won / Bid</Text>
    </View>
  );
}

const TONE_EDGE = {
  good: { borderLeftColor: "#4CAF50" },
  bad: { borderLeftColor: "#FF5D6C" },
  neutral: { borderLeftColor: "#5E3A9E" },
};

const TONE_TEXT = {
  good: { color: "#7ED47E" },
  bad: { color: "#FF8A94" },
  neutral: { color: "#FFD700" },
};

const rawStyles = {
  example: {
    marginTop: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderLeftWidth: 3,
    backgroundColor: "rgba(16, 9, 32, 0.55)",
  },
  label: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    letterSpacing: 1,
    marginBottom: 4,
    textTransform: "uppercase",
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
  },

  line: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    marginVertical: 1,
  },
  lineLeft: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: "Inter_400Regular",
    color: "#EDE6FA",
  },
  lineArrow: {
    fontSize: 13,
    lineHeight: 18,
    marginHorizontal: 7,
  },
  lineRight: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: "Inter_700Bold",
  },

  chip: {
    minWidth: 30,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: "#5E3A9E",
    backgroundColor: "rgba(61, 34, 114, 0.85)",
    alignItems: "center",
    marginRight: 6,
    marginTop: 4,
  },
  chipHighlighted: {
    borderColor: "#FFD700",
    backgroundColor: "rgba(255, 215, 0, 0.18)",
  },
  chipText: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    color: "#EDE6FA",
  },
  chipTextHighlighted: {
    color: "#FFD700",
  },

  counter: {
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: "#5E3A9E",
    backgroundColor: "rgba(61, 34, 114, 0.85)",
    marginRight: 8,
    marginTop: 4,
  },
  counterValue: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
    color: "#FFD700",
  },
  counterCaption: {
    fontSize: 9,
    fontFamily: "Inter_400Regular",
    color: "#C9BEDC",
    letterSpacing: 0.5,
  },
};
