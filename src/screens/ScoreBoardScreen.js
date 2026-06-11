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
    Inter_400Regular,
    Inter_700Bold,
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

    // Surface any server-side error (e.g. while finalizing the game).
    const unsubscribeGameError = socketService.on('game:error', (data) => {
      console.warn('Game error on scoreboard:', data.message, data.code);
    });

    // Listen for the final winner - go to the celebration screen.
    const unsubscribeFinalWinner = socketService.on('game:final-winner', (data) => {
      console.log('Final winner:', data);
      navigation.replace('FinalWinner', {
        winners: data.winners,
        winningScore: data.winningScore,
        isTie: data.isTie,
        finalScores: data.finalScores,
        currentPlayerId,
        currentPlayerName,
      });
    });

    return () => {
      unsubscribeState();
      unsubscribeContinued();
      unsubscribeAllContinued();
      unsubscribeBidding();
      unsubscribeGameError();
      unsubscribeFinalWinner();
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
                {/* Total - an equal-height row after the rounds, below a divider */}
                <View style={styles.totalRow}>
                  <View style={[styles.cell, styles.totalLabelCell]}>
                    <Text style={styles.totalLabel} numberOfLines={1}>Total</Text>
                  </View>
                  {scoreboard.players.map((player) => {
                    const isLeading = player.id === leadingPlayer?.id;

                    return (
                      <View key={player.id} style={[styles.cell, styles.playerCell]}>
                        <View style={styles.totalScoreWrap}>
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
    paddingHorizontal: 10,
    paddingTop: 8,
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
    paddingTop: 8,
    paddingBottom: 2,
  },

  // Shared cell + column widths (flex based so it fills the width)
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
  currentRoundRow: {
    backgroundColor: "rgba(255, 215, 0, 0.12)",
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

  // Total row - an equal-height row (like the data rows) after the rounds,
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
  // The number is centered in the cell (aligned with the score columns); the
  // crown is anchored just to the left of the number so they read as a unit.
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

  // Continue button
  buttonContainer: {
    marginTop: 4,
    alignItems: "center",
    paddingBottom: 4,
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
    paddingVertical: 9,
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
