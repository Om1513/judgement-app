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

// Trump suit symbols and colors (tuned for the dark card background)
const TRUMP_DISPLAY = {
  spades: { symbol: "♠", color: "#FFF8E7" },
  hearts: { symbol: "♥", color: "#FF5D6C" },
  diamonds: { symbol: "♦", color: "#FF5D6C" },
  clubs: { symbol: "♣", color: "#FFF8E7" },
};

export default function ScoreBoardScreen({ navigation, route }) {
  const {
    scoreboard: initialScoreboard,
    currentPlayerId = "",
    currentPlayerName = "",
  } = route.params || {};

  const [scoreboard, setScoreboard] = useState(initialScoreboard || null);

  // Check if current player has already continued based on initial scoreboard
  const initialContinued = initialScoreboard?.players?.find(p => p.id === currentPlayerId)?.hasContinued || false;
  const [hasContinued, setHasContinued] = useState(initialContinued);
  const [isWaiting, setIsWaiting] = useState(initialContinued);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const buttonPulse = useRef(new Animated.Value(1)).current;

  const [fontsLoaded] = useFonts({
    Bangers_400Regular,
  });

  // Listen for socket events
  useEffect(() => {
    // Request scoreboard state only if we don't have initial data
    if (!initialScoreboard) {
      socketService.getScoreboardState();
    }

    // Listen for scoreboard updates
    const unsubscribeState = socketService.on('scoreboard:state', (data) => {
      console.log('Scoreboard state:', data.scoreboard);
      setScoreboard(data.scoreboard);

      // Check if current player has already continued
      const currentPlayer = data.scoreboard.players.find(p => p.id === currentPlayerId);
      if (currentPlayer?.hasContinued) {
        setHasContinued(true);
        setIsWaiting(true);
      }
    });

    // Listen for player continued
    const unsubscribeContinued = socketService.on('scoreboard:player-continued', (data) => {
      console.log('Player continued:', data.playerName);
    });

    // Listen for all continued - navigate to next round
    const unsubscribeAllContinued = socketService.on('scoreboard:all-continued', () => {
      console.log('All players continued');
    });

    // Listen for round bidding started
    const unsubscribeBidding = socketService.on('round:bidding-started', (data) => {
      console.log('Next round bidding started');
      navigation.replace('Bidding', {
        gameState: data.gameState,
        currentPlayerId,
        currentPlayerName,
      });
    });

    // Listen for game completed
    const unsubscribeCompleted = socketService.on('game:completed', (data) => {
      console.log('Game completed:', data);
      navigation.replace('GameComplete', {
        finalScores: data.finalScores,
        winner: data.winner,
        currentPlayerId,
        currentPlayerName,
      });
    });

    return () => {
      unsubscribeState();
      unsubscribeContinued();
      unsubscribeAllContinued();
      unsubscribeBidding();
      unsubscribeCompleted();
    };
  }, [navigation, currentPlayerId, currentPlayerName]);

  // Animations
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

  // Button pulse animation
  useEffect(() => {
    if (!hasContinued) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(buttonPulse, {
            toValue: 1.05,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(buttonPulse, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
  }, [hasContinued]);

  const handleContinue = () => {
    if (hasContinued) return;
    setHasContinued(true);
    setIsWaiting(true);
    socketService.scoreboardContinue();
  };

  // Find leading player
  const getLeadingPlayer = () => {
    if (!scoreboard?.players?.length) return null;
    return scoreboard.players.reduce((max, p) =>
      p.totalScore > (max?.totalScore || 0) ? p : max
    , scoreboard.players[0]);
  };

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

  const leadingPlayer = getLeadingPlayer();

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
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          {/* Title */}
          <View style={styles.titleContainer}>
            <Text style={styles.title}>Score Board</Text>
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
                    <Text
                      style={[
                        styles.headerText,
                        styles.playerHeaderText,
                        player.id === currentPlayerId && styles.currentPlayerText,
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
                  const isCurrentRound = row.roundNumber === scoreboard.currentRound;
                  const trumpInfo = TRUMP_DISPLAY[row.trump.suit] || { symbol: "?", color: "#FFF8E7" };

                  return (
                    <View
                      key={row.roundNumber}
                      style={[
                        styles.dataRow,
                        index % 2 === 1 && styles.alternateRow,
                        isCurrentRound && styles.currentRoundRow,
                      ]}
                    >
                      {/* Trump */}
                      <View style={[styles.cell, styles.trumpCell]}>
                        <Text style={[styles.trumpSymbol, { color: trumpInfo.color }]}>
                          {trumpInfo.symbol}
                        </Text>
                        <Text style={styles.trumpName} numberOfLines={1}>
                          {row.trump.name || row.trump.suit}
                        </Text>
                      </View>

                      {/* Round number */}
                      <View style={[styles.cell, styles.roundCell]}>
                        <Text style={styles.roundNumber}>{row.roundNumber}</Text>
                      </View>

                      {/* Player scores */}
                      {row.scores.map((score) => {
                        const hasScore = score.score !== null;
                        const madeBid = hasScore && score.bid === score.handsMade;

                        return (
                          <View key={score.playerId} style={[styles.cell, styles.playerCell]}>
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
                  const isLeading = player.id === leadingPlayer?.id;

                  return (
                    <View key={player.id} style={[styles.cell, styles.playerCell]}>
                      <View style={styles.totalScoreContainer}>
                        {isLeading && <Text style={styles.crownIcon}>👑</Text>}
                        <Text
                          style={[
                            styles.totalScoreText,
                            isLeading && styles.leadingScore,
                          ]}
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

          {/* Continue Button */}
          <View style={styles.buttonContainer}>
            {!hasContinued ? (
              <Animated.View style={{ transform: [{ scale: buttonPulse }] }}>
                <TouchableOpacity
                  onPress={handleContinue}
                  activeOpacity={0.8}
                  style={styles.continueButton}
                >
                  <LinearGradient
                    colors={["#FF8C00", "#FF6600", "#E65500"]}
                    style={styles.continueButtonGradient}
                  >
                    <Text style={styles.continueButtonText}>CONTINUE</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </Animated.View>
            ) : (
              <View style={styles.waitingContainer}>
                <Text style={styles.waitingText}>Waiting for other players...</Text>
                <View style={styles.continuedList}>
                  {scoreboard.players.map((player) => (
                    <View key={player.id} style={styles.continuedItem}>
                      <Text style={styles.continuedName}>{player.name}</Text>
                      <Text
                        style={[
                          styles.continuedStatus,
                          player.hasContinued ? styles.continuedYes : styles.continuedNo,
                        ]}
                      >
                        {player.hasContinued ? "Ready" : "..."}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
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

  // Table card
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

  // Shared cell + column widths (flex based so it fills the width)
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
  },
  playerHeaderText: {
    color: "#FFD700",
  },
  currentPlayerText: {
    color: "#FF8C00",
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
  currentRoundRow: {
    backgroundColor: "rgba(255, 215, 0, 0.12)",
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
  },
  roundNumber: {
    fontSize: 17,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
  },
  scoreText: {
    fontSize: 18,
    lineHeight: 26,
    fontFamily: "Bangers_400Regular",
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

  // Total row
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
  },
  leadingScore: {
    color: "#FFD700",
    textShadowColor: "rgba(255, 215, 0, 0.5)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },

  // Continue button
  buttonContainer: {
    marginTop: 16,
    alignItems: "center",
    paddingBottom: 16,
  },
  continueButton: {
    borderRadius: 14,
    overflow: "hidden",
    shadowColor: "#FF6600",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 10,
  },
  continueButtonGradient: {
    paddingVertical: 11,
    paddingHorizontal: 50,
    borderRadius: 12,
  },
  continueButtonText: {
    fontSize: 19,
    fontFamily: "Bangers_400Regular",
    color: "#FFFFFF",
    textShadowColor: "rgba(0, 0, 0, 0.5)",
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 4,
    letterSpacing: 3,
  },
  waitingContainer: {
    alignItems: "center",
    backgroundColor: "rgba(42, 22, 84, 0.8)",
    padding: 15,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#5E3A9E",
  },
  waitingText: {
    fontSize: 16,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    marginBottom: 10,
  },
  continuedList: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
  },
  continuedItem: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 8,
    marginVertical: 4,
  },
  continuedName: {
    fontSize: 12,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    marginRight: 5,
  },
  continuedStatus: {
    fontSize: 12,
    fontFamily: "Bangers_400Regular",
  },
  continuedYes: {
    color: "#4CAF50",
  },
  continuedNo: {
    color: "#888888",
  },
});
