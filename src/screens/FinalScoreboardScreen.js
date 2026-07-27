import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  ImageBackground,
  StyleSheet,
  Animated,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { useFonts, Bangers_400Regular } from "@expo-google-fonts/bangers";
import { Inter_400Regular, Inter_700Bold } from "@expo-google-fonts/inter";
import socketService from "../services/socket";
import CircleIconButton from "../components/CircleIconButton";
import SoundToggleButton from "../components/SoundToggleButton";

const TRUMP_DISPLAY = {
  spades: { symbol: "♠", color: "#FFF8E7" },
  hearts: { symbol: "♥", color: "#FF5D6C" },
  diamonds: { symbol: "♦", color: "#FF5D6C" },
  clubs: { symbol: "♣", color: "#FFF8E7" },
};

/**
 * Read-only final scoreboard for a completed game. Shows every round's scores
 * plus totals, with the winning player column(s) highlighted (crown + glow).
 * Winner(s) come from the backend (authoritative) - never recomputed here.
 */
export default function FinalScoreboardScreen({ navigation, route }) {
  const {
    currentPlayerId = "",
    winnerIds: initialWinnerIds = [],
  } = route.params || {};

  const [scoreboard, setScoreboard] = useState(null);
  const [winnerIds, setWinnerIds] = useState(initialWinnerIds);

  // Measured height of the score-rows area. Row text is scaled to whatever this
  // works out to per row, matching the round scoreboard. It matters more here:
  // this screen always lists every round, so a fixed line height overflows on
  // any decent-length game.
  const [rowsAreaHeight, setRowsAreaHeight] = useState(0);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  const [fontsLoaded] = useFonts({
    Bangers_400Regular,
    Inter_400Regular,
    Inter_700Bold,
  });

  useEffect(() => {
    socketService.getFinalScoreboard();

    const unsubscribe = socketService.on("game:final-scoreboard", (data) => {
      setScoreboard(data.scoreboard);
      if (Array.isArray(data.winnerIds)) {
        setWinnerIds(data.winnerIds);
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  if (!fontsLoaded || !scoreboard) {
    return (
      <View style={styles.container}>
        <ImageBackground
          source={require("../../assets/background_without_title.png")}
          style={styles.background}
          resizeMode="cover"
        />
      </View>
    );
  }

  const isWinner = (playerId) => winnerIds.includes(playerId);

  // Same fit-to-space sizing as the round scoreboard. The +1 accounts for the
  // Total row, which is the same height as a data row.
  const rowCount = scoreboard.rows.length + 1;
  const rowHeight = rowsAreaHeight > 0 ? rowsAreaHeight / rowCount : 0;
  const cellFontSize = rowHeight > 0
    ? Math.max(9, Math.min(18, Math.floor(rowHeight * 0.5)))
    : 14;
  const cellText = { fontSize: cellFontSize, lineHeight: Math.round(cellFontSize * 1.15) };

  return (
    <View style={styles.container}>
      <ImageBackground
        source={require("../../assets/background_without_title.png")}
        style={styles.background}
        resizeMode="cover"
      >
        <LinearGradient
          colors={["rgba(26, 16, 48, 0.7)", "transparent", "rgba(26, 16, 48, 0.6)"]}
          locations={[0, 0.4, 1]}
          style={styles.overlayGradient}
        />

        <Animated.View
          style={[
            styles.content,
            { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
          ]}
        >
          <View style={styles.titleContainer}>
            <Text style={styles.title}>Final Results</Text>

            {/* Exit on the extreme right with sound just inboard of it. Inside
                the title row rather than floating, so they stay off the table's
                last column. The game is already over here, so this goes
                straight home with no "are you sure". */}
            <CircleIconButton
              glyph="›"
              glyphStyle={styles.backGlyph}
              style={styles.backButton}
              accessibilityLabel="Return to home"
              onPress={() => navigation.navigate("Home")}
            />
            <SoundToggleButton style={styles.soundButton} />
          </View>

          {/* Scoreboard Table Card */}
          <View style={styles.tableContainer}>
            <LinearGradient
              colors={["rgba(61, 34, 114, 0.95)", "rgba(42, 22, 84, 0.98)"]}
              style={styles.tableGradient}
            >
              {/* Header Row */}
              <View style={styles.headerRow}>
                <View style={[styles.cell, styles.trumpCell]}>
                  <Text style={[styles.headerText, cellText]} numberOfLines={1}>Trump</Text>
                </View>
                <View style={[styles.cell, styles.roundCell]}>
                  <Text style={[styles.headerText, cellText]} numberOfLines={1}>Round</Text>
                </View>
                {scoreboard.players.map((player) => (
                  <View key={player.id} style={[styles.cell, styles.playerCell]}>
                    <View style={styles.headerNameWrap}>
                      {isWinner(player.id) && <Text style={styles.crownHeader}>👑</Text>}
                      <Text
                        style={[
                          styles.headerText,
                          cellText,
                          styles.playerHeaderText,
                          player.id === currentPlayerId && styles.currentPlayerText,
                          isWinner(player.id) && styles.winnerHeaderText,
                        ]}
                        numberOfLines={1}
                      >
                        {player.name}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>

              {/* Score Rows */}
              <View
                style={styles.rowsContainer}
                onLayout={(e) => setRowsAreaHeight(e.nativeEvent.layout.height)}
              >
                {scoreboard.rows.map((row, index) => {
                  const trumpInfo = TRUMP_DISPLAY[row.trump.suit] || { symbol: "?", color: "#FFF8E7" };

                  return (
                    <View
                      key={row.roundNumber}
                      style={[styles.dataRow, index % 2 === 1 && styles.alternateRow]}
                    >
                      <View style={[styles.cell, styles.trumpCell]}>
                        <Text style={[styles.trumpSymbol, cellText, { color: trumpInfo.color }]}>
                          {trumpInfo.symbol}
                        </Text>
                        <Text style={[styles.trumpName, cellText]} numberOfLines={1}>
                          {row.trump.name || row.trump.suit}
                        </Text>
                      </View>

                      <View style={[styles.cell, styles.roundCell]}>
                        <Text style={[styles.roundNumber, cellText]}>{row.roundNumber}</Text>
                      </View>

                      {/* Per-round scores are rendered flat here: no made-bid
                          colouring and no winner tint. The crown and the total
                          carry the result; highlighting every cell as well made
                          the table hard to read. */}
                      {row.scores.map((score) => {
                        const hasScore = score.score !== null;

                        return (
                          <View key={score.playerId} style={[styles.cell, styles.playerCell]}>
                            {hasScore ? (
                              <Text style={[styles.scoreText, cellText, styles.scoreNeutral]}>
                                {score.score}
                              </Text>
                            ) : (
                              <Text style={[styles.scoreEmpty, cellText]}>–</Text>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  );
                })}

                {/* Total - an equal-height row after the rounds, below a divider */}
                <View style={styles.totalRow}>
                  <View style={[styles.cell, styles.totalLabelCell]}>
                    <Text style={[styles.totalLabel, cellText]} numberOfLines={1}>Total</Text>
                  </View>
                  {scoreboard.players.map((player) => {
                    const winnerCol = isWinner(player.id);
                    return (
                      <View
                        key={player.id}
                        style={[styles.cell, styles.playerCell, winnerCol && styles.winnerColumn]}
                      >
                        <View style={styles.totalScoreWrap}>
                          {winnerCol && <Text style={styles.crownIcon}>👑</Text>}
                          <Text
                            style={[styles.totalScoreText, cellText, winnerCol && styles.leadingScore]}
                          >
                            {player.totalScore}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            </LinearGradient>
          </View>

        </Animated.View>

        <StatusBar style="light" hidden />
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1030",
  },
  background: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
  overlayGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  content: {
    flex: 1,
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 2,
  },
  // Tall enough to hold the 52px circles; the table below flexes to whatever is
  // left over.
  titleContainer: {
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  // Exit sits hard against the right edge, sound immediately inboard of it.
  // 52px circle plus a 12px gap, same spacing as everywhere else.
  backButton: {
    top: 2,
    right: 0,
  },
  soundButton: {
    top: 2,
    right: 64,
  },
  // The chevron sits high and small in its em box next to the note glyph, so
  // nudge it onto the optical centre and size it up to match.
  backGlyph: {
    fontSize: 34,
    lineHeight: 38,
    marginTop: -3,
  },
  title: {
    fontSize: 26,
    fontFamily: "Bangers_400Regular",
    color: "#FFD700",
    textShadowColor: "rgba(255, 165, 0, 0.5)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
    letterSpacing: 3,
  },
  tableContainer: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "#5E3A9E",
  },
  tableGradient: {
    flex: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 2,
  },
  cell: {
    paddingHorizontal: 4,
    justifyContent: "center",
    alignItems: "center",
  },
  trumpCell: {
    flex: 2.4,
    flexDirection: "row",
    justifyContent: "flex-start",
  },
  roundCell: {
    flex: 1.4,
  },
  playerCell: {
    flex: 1.2,
  },
  winnerColumn: {
    backgroundColor: "rgba(255, 215, 0, 0.12)",
    borderRadius: 6,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    borderBottomWidth: 2,
    borderBottomColor: "#FFD700",
  },
  headerText: {
    fontSize: 18,
    lineHeight: 22,
    fontFamily: "Inter_700Bold",
    color: "#FFF8E7",
    letterSpacing: 0.5,
    textAlign: "center",
    textAlignVertical: "center",
    includeFontPadding: false,
    paddingHorizontal: 3,
  },
  playerHeaderText: {
    color: "#FFD700",
  },
  currentPlayerText: {
    color: "#FF8C00",
  },
  winnerHeaderText: {
    color: "#FFD700",
    textShadowColor: "rgba(255, 215, 0, 0.6)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  headerNameWrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  crownHeader: {
    fontSize: 12,
    marginRight: 3,
  },
  rowsContainer: {
    flex: 1,
    paddingTop: 4,
    paddingBottom: 0,
  },
  dataRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(94, 58, 158, 0.4)",
  },
  alternateRow: {
    backgroundColor: "rgba(42, 22, 84, 0.4)",
  },
  trumpSymbol: {
    fontSize: 18,
    lineHeight: 22,
    marginRight: 6,
    textAlignVertical: "center",
    includeFontPadding: false,
  },
  trumpName: {
    fontSize: 18,
    lineHeight: 22,
    fontFamily: "Inter_400Regular",
    color: "#FFF8E7",
    letterSpacing: 0,
    paddingHorizontal: 2,
    textAlignVertical: "center",
    includeFontPadding: false,
  },
  roundNumber: {
    fontSize: 18,
    lineHeight: 22,
    fontFamily: "Inter_400Regular",
    color: "#FFF8E7",
    textAlign: "center",
    textAlignVertical: "center",
    includeFontPadding: false,
    paddingHorizontal: 5,
  },
  scoreText: {
    fontSize: 18,
    lineHeight: 22,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    textAlignVertical: "center",
    includeFontPadding: false,
    paddingHorizontal: 5,
  },
  // One colour for every round score - the crown and total mark the winner.
  scoreNeutral: {
    color: "#FFF8E7",
  },
  scoreEmpty: {
    fontSize: 18,
    lineHeight: 22,
    color: "#6E5C94",
    textAlignVertical: "center",
    includeFontPadding: false,
  },
  // Total - an equal-height row (like the data rows) after the rounds,
  // separated by a gold divider line.
  totalRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "#FFD700",
  },
  totalLabelCell: {
    flex: 3.8,
    alignItems: "flex-start",
  },
  totalLabel: {
    fontSize: 18,
    lineHeight: 22,
    fontFamily: "Inter_700Bold",
    color: "#FFD700",
    letterSpacing: 1,
    paddingHorizontal: 3,
    textAlignVertical: "center",
    includeFontPadding: false,
  },
  totalScoreWrap: {
    justifyContent: "center",
    alignItems: "center",
  },
  crownIcon: {
    position: "absolute",
    left: -16,
    top: 3,
    fontSize: 12,
  },
  totalScoreText: {
    fontSize: 18,
    lineHeight: 22,
    fontFamily: "Inter_700Bold",
    color: "#FFF8E7",
    textAlign: "center",
    textAlignVertical: "center",
    includeFontPadding: false,
    paddingHorizontal: 5,
  },
  leadingScore: {
    color: "#FFD700",
    textShadowColor: "rgba(255, 215, 0, 0.5)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
});
