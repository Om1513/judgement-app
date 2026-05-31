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

  const [fontsLoaded] = useFonts({ Bangers_400Regular });

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
                  <Text style={styles.headerText}>Trump</Text>
                </View>
                <View style={[styles.cell, styles.roundCell]}>
                  <Text style={styles.headerText}>Round</Text>
                </View>
                {scoreboard.players.map((player) => (
                  <View key={player.id} style={[styles.cell, styles.playerCell]}>
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
              </View>
            </LinearGradient>
          </View>

          {/* Total Row */}
          <View style={styles.totalContainer}>
            <LinearGradient
              colors={["rgba(61, 34, 114, 0.95)", "rgba(42, 22, 84, 0.98)"]}
              style={styles.totalGradient}
            >
              <View style={styles.totalRow}>
                <View style={[styles.cell, styles.totalLabelCell]}>
                  <Text style={styles.totalLabel}>Total</Text>
                </View>
                {scoreboard.players.map((player) => {
                  const winnerCol = isWinner(player.id);
                  return (
                    <View
                      key={player.id}
                      style={[styles.cell, styles.playerCell, winnerCol && styles.winnerColumn]}
                    >
                      <View style={styles.totalScoreContainer}>
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
    paddingHorizontal: 15,
    paddingTop: 20,
    paddingBottom: 10,
  },
  titleContainer: {
    alignItems: "center",
    marginBottom: 8,
  },
  title: {
    fontSize: 32,
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
    paddingVertical: 8,
  },
  cell: {
    paddingHorizontal: 4,
    justifyContent: "center",
    alignItems: "center",
  },
  trumpCell: {
    flex: 1.8,
    flexDirection: "row",
    justifyContent: "flex-start",
  },
  roundCell: {
    flex: 1,
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
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: "#FFD700",
  },
  headerText: {
    fontSize: 16,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    letterSpacing: 1,
    textAlign: "center",
    paddingHorizontal: 5,
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
  crownHeader: {
    fontSize: 14,
    marginBottom: 2,
  },
  rowsContainer: {
    flex: 1,
    paddingVertical: 4,
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
    fontSize: 20,
    fontWeight: "bold",
    marginRight: 8,
  },
  trumpName: {
    fontSize: 15,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    letterSpacing: 0.5,
    paddingHorizontal: 4,
  },
  roundNumber: {
    fontSize: 17,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    textAlign: "center",
    paddingHorizontal: 5,
  },
  scoreText: {
    fontSize: 18,
    lineHeight: 26,
    fontFamily: "Bangers_400Regular",
    textAlign: "center",
    paddingHorizontal: 5,
  },
  scorePositive: {
    color: "#FFD700",
  },
  scoreZero: {
    color: "#C9BEDC",
  },
  scoreEmpty: {
    fontSize: 16,
    color: "#6E5C94",
  },
  totalContainer: {
    marginTop: 4,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "#FFD700",
  },
  totalGradient: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  totalRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  totalLabelCell: {
    flex: 2.8,
    alignItems: "flex-start",
  },
  totalLabel: {
    fontSize: 20,
    fontFamily: "Bangers_400Regular",
    color: "#FFD700",
    letterSpacing: 2,
    paddingHorizontal: 5,
  },
  totalScoreContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  crownIcon: {
    fontSize: 15,
    marginRight: 4,
  },
  totalScoreText: {
    fontSize: 22,
    lineHeight: 30,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    textAlign: "center",
    paddingHorizontal: 5,
  },
  leadingScore: {
    color: "#FFD700",
    textShadowColor: "rgba(255, 215, 0, 0.5)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  buttonContainer: {
    marginTop: 16,
    alignItems: "center",
    paddingBottom: 16,
  },
  homeButton: {
    borderRadius: 14,
    overflow: "hidden",
    shadowColor: "#FF6600",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 10,
  },
  homeButtonGradient: {
    paddingVertical: 11,
    paddingHorizontal: 50,
    borderRadius: 12,
  },
  homeButtonText: {
    fontSize: 19,
    fontFamily: "Bangers_400Regular",
    color: "#FFFFFF",
    textShadowColor: "rgba(0, 0, 0, 0.5)",
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 4,
    letterSpacing: 3,
  },
});
