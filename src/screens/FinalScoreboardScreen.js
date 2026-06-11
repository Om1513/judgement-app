import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  ImageBackground,
  StyleSheet,
  TouchableOpacity,
  Animated,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { useFonts, Bangers_400Regular } from "@expo-google-fonts/bangers";
import { Inter_400Regular, Inter_700Bold } from "@expo-google-fonts/inter";
import socketService from "../services/socket";

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
        duration: 400,
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
                  <Text style={styles.headerText} numberOfLines={1}>Trump</Text>
                </View>
                <View style={[styles.cell, styles.roundCell]}>
                  <Text style={styles.headerText} numberOfLines={1}>Round</Text>
                </View>
                {scoreboard.players.map((player) => (
                  <View key={player.id} style={[styles.cell, styles.playerCell]}>
                    <View style={styles.headerNameWrap}>
                      {isWinner(player.id) && <Text style={styles.crownHeader}>👑</Text>}
                      <Text
                        style={[
                          styles.headerText,
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
              <View style={styles.rowsContainer}>
                {scoreboard.rows.map((row, index) => {
                  const trumpInfo = TRUMP_DISPLAY[row.trump.suit] || { symbol: "?", color: "#FFF8E7" };

                  return (
                    <View
                      key={row.roundNumber}
                      style={[styles.dataRow, index % 2 === 1 && styles.alternateRow]}
                    >
                      <View style={[styles.cell, styles.trumpCell]}>
                        <Text style={[styles.trumpSymbol, { color: trumpInfo.color }]}>
                          {trumpInfo.symbol}
                        </Text>
                        <Text style={styles.trumpName} numberOfLines={1}>
                          {row.trump.name || row.trump.suit}
                        </Text>
                      </View>

                      <View style={[styles.cell, styles.roundCell]}>
                        <Text style={styles.roundNumber}>{row.roundNumber}</Text>
                      </View>

                      {row.scores.map((score) => {
                        const hasScore = score.score !== null;
                        const madeBid = hasScore && score.bid === score.handsMade;
                        const winnerCol = isWinner(score.playerId);

                        return (
                          <View
                            key={score.playerId}
                            style={[styles.cell, styles.playerCell, winnerCol && styles.winnerColumn]}
                          >
                            {hasScore ? (
                              <Text
                                style={[
                                  styles.scoreText,
                                  madeBid ? styles.scorePositive : styles.scoreZero,
                                ]}
                              >
                                {score.score}
                              </Text>
                            ) : (
                              <Text style={styles.scoreEmpty}>–</Text>
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
                    <Text style={styles.totalLabel} numberOfLines={1}>Total</Text>
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
                            style={[styles.totalScoreText, winnerCol && styles.leadingScore]}
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

          {/* Home button */}
          <View style={styles.buttonContainer}>
            <TouchableOpacity
              onPress={() => navigation.navigate("Home")}
              activeOpacity={0.8}
              style={styles.homeButton}
            >
              <LinearGradient
                colors={["#FF8C00", "#FF6600", "#E65500"]}
                style={styles.homeButtonGradient}
              >
                <Text style={styles.homeButtonText}>RETURN TO HOME</Text>
              </LinearGradient>
            </TouchableOpacity>
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
    backgroundColor: "#0a0612",
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
  titleContainer: {
    alignItems: "center",
    marginBottom: 4,
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
  scorePositive: {
    color: "#FFD700",
  },
  scoreZero: {
    color: "#C9BEDC",
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
  buttonContainer: {
    position: "absolute",
    top: 10,
    right: 10,
    zIndex: 10,
  },
  homeButton: {
    borderRadius: 10,
    overflow: "hidden",
    shadowColor: "#FF6600",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 8,
  },
  homeButtonGradient: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  homeButtonText: {
    fontSize: 14,
    fontFamily: "Bangers_400Regular",
    color: "#FFFFFF",
    textShadowColor: "rgba(0, 0, 0, 0.5)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
    letterSpacing: 1.5,
  },
});
