// Kachuful trump names against their suits, and the fixed Kachuful round order.
//
// The names and symbols mirror the game's own trump handling, so a player can
// map what the table says ("Falli") onto the card they are holding.

import React from "react";
import { View, Text, StyleSheet } from "react-native";

// Local name -> suit. Order here is the display order of the legend.
export const SUITS = [
  { local: "Kari", english: "Spades", symbol: "♠", red: false },
  { local: "Chukat", english: "Diamonds", symbol: "♦", red: true },
  { local: "Falli", english: "Clubs", symbol: "♣", red: false },
  { local: "Lal", english: "Hearts", symbol: "♥", red: true },
];

// The fixed Kachuful trump rotation, repeating past round 4.
export const KACHUFUL_ORDER = [
  { round: 1, local: "Falli", english: "Clubs", symbol: "♣", red: false },
  { round: 2, local: "Chukat", english: "Diamonds", symbol: "♦", red: true },
  { round: 3, local: "Kari", english: "Spades", symbol: "♠", red: false },
  { round: 4, local: "Lal", english: "Hearts", symbol: "♥", red: true },
];

/** One suit tile: symbol above the local name above the English name. */
export function SuitTile({ symbol, local, english, red, round }) {
  return (
    <View style={styles.tile}>
      {round ? <Text style={styles.round}>R{round}</Text> : null}
      <Text style={[styles.symbol, red && styles.symbolRed]}>{symbol}</Text>
      <Text style={styles.local}>{local}</Text>
      <Text style={styles.english}>{english}</Text>
    </View>
  );
}

/** The four suits with their Kachuful names. */
export default function SuitLegend() {
  return (
    <View style={styles.row}>
      {SUITS.map((s) => (
        <SuitTile key={s.local} {...s} />
      ))}
    </View>
  );
}

/** The same suits, labelled with the round they are trump in Kachuful order. */
export function TrumpOrder() {
  return (
    <View style={styles.row}>
      {KACHUFUL_ORDER.map((s) => (
        <SuitTile key={s.round} {...s} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 6,
  },
  tile: {
    alignItems: "center",
    minWidth: 62,
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#5E3A9E",
    backgroundColor: "rgba(16, 9, 32, 0.5)",
    marginRight: 8,
    marginBottom: 6,
  },
  round: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    color: "#C9BEDC",
    letterSpacing: 0.5,
  },
  symbol: {
    fontSize: 22,
    lineHeight: 26,
    color: "#FFF8E7",
  },
  symbolRed: {
    color: "#FF5D6C",
  },
  local: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    color: "#FFD700",
  },
  english: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: "#C9BEDC",
  },
});
