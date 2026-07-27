// Bid / made / score rows for the two scoring modes, shown as a small ledger
// so the difference between +10 and +1 is obvious at a glance.

import React from "react";
import { View, Text, StyleSheet } from "react-native";

/**
 * One scoring outcome. `made` null means the judgement was missed, which always
 * scores zero in both modes.
 */
export function ScoreRow({ bid, made, points }) {
  const missed = points === 0;
  return (
    <View style={styles.row}>
      <Text style={styles.cell}>Bid {bid}</Text>
      <Text style={styles.cell}>Made {made}</Text>
      <Text style={[styles.points, missed ? styles.pointsMissed : styles.pointsGood]}>
        {missed ? "0" : `+${points}`}
      </Text>
    </View>
  );
}

/**
 * A labelled mode block. `score(bid)` is the points for an exact judgement in
 * this mode, so +10 and +1 share one component. Mirrors calculateScore in
 * server/src/utils/cardUtils.ts - the server is authoritative; this only
 * explains it.
 */
export default function ScoringExample({ mode, score }) {
  return (
    <View style={styles.block}>
      <Text style={styles.mode}>{mode}</Text>
      <View style={styles.header}>
        <Text style={styles.headerCell}>Bid</Text>
        <Text style={styles.headerCell}>Made</Text>
        <Text style={styles.headerPoints}>Score</Text>
      </View>
      {/* A correct zero bid still scores in both modes. */}
      <ScoreRow bid={0} made={0} points={score(0)} />
      <ScoreRow bid={1} made={1} points={score(1)} />
      <ScoreRow bid={2} made={2} points={score(2)} />
      <ScoreRow bid={3} made={3} points={score(3)} />
      <ScoreRow bid={2} made={1} points={0} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: "#5E3A9E",
    backgroundColor: "rgba(16, 9, 32, 0.5)",
  },
  mode: {
    fontSize: 14,
    fontFamily: "Bangers_400Regular",
    color: "#FFD700",
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 215, 0, 0.25)",
    paddingBottom: 3,
    marginBottom: 3,
  },
  headerCell: {
    flex: 1,
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    color: "#C9BEDC",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  headerPoints: {
    width: 52,
    textAlign: "right",
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    color: "#C9BEDC",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 2,
  },
  cell: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#EDE6FA",
  },
  points: {
    width: 52,
    textAlign: "right",
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  pointsGood: {
    color: "#7ED47E",
  },
  pointsMissed: {
    color: "#FF8A94",
  },
});
