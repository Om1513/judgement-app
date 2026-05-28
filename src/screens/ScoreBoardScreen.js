import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  ImageBackground,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Dimensions,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { useFonts, Bangers_400Regular } from "@expo-google-fonts/bangers";
import socketService from "../services/socket";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// Trump suit symbols and colors
const TRUMP_DISPLAY = {
  spades: { symbol: "♠", color: "#1a1a2e" },
  hearts: { symbol: "♥", color: "#dc3545" },
  diamonds: { symbol: "♦", color: "#dc3545" },
  clubs: { symbol: "♣", color: "#1a1a2e" },
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
            <Text style={styles.subtitle}>
              Round {scoreboard.currentRound} of {scoreboard.totalRounds}
            </Text>
          </View>

          {/* Scoreboard Table */}
          <View style={styles.tableContainer}>
            <LinearGradient
              colors={["rgba(61, 34, 114, 0.95)", "rgba(42, 22, 84, 0.98)"]}
              style={styles.tableGradient}
            >
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.table}>
                  {/* Header Row */}
                  <View style={styles.headerRow}>
                    <View style={[styles.headerCell, styles.trumpCell]}>
                      <Text style={styles.headerText}>Trump</Text>
                    </View>
                    <View style={[styles.headerCell, styles.roundCell]}>
                      <Text style={styles.headerText}>Round</Text>
                    </View>
                    {scoreboard.players.map((player) => (
                      <View
                        key={player.id}
                        style={[
                          styles.headerCell,
                          styles.playerCell,
                          player.id === currentPlayerId && styles.currentPlayerCell,
                        ]}
                      >
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
                  <ScrollView style={styles.rowsContainer} showsVerticalScrollIndicator={false}>
                    {scoreboard.rows.map((row, index) => {
                      const isCurrentRound = row.roundNumber === scoreboard.currentRound;
                      const isPastRound = row.roundNumber < scoreboard.currentRound;
                      const trumpInfo = TRUMP_DISPLAY[row.trump.suit] || { symbol: "?", color: "#666" };

                      return (
                        <View
                          key={row.roundNumber}
                          style={[
                            styles.dataRow,
                            isCurrentRound && styles.currentRoundRow,
                            index % 2 === 0 && styles.alternateRow,
                          ]}
                        >
                          {/* Trump Cell */}
                          <View style={[styles.dataCell, styles.trumpCell]}>
                            <Text style={[styles.trumpSymbol, { color: trumpInfo.color }]}>
                              {trumpInfo.symbol}
                            </Text>
                            <Text style={styles.trumpName}>
                              {row.trump.name || row.trump.suit}
                            </Text>
                          </View>

                          {/* Round Number Cell */}
                          <View style={[styles.dataCell, styles.roundCell]}>
                            <Text style={styles.roundNumber}>{row.roundNumber}</Text>
                          </View>

                          {/* Player Score Cells */}
                          {row.scores.map((score) => {
                            const hasScore = score.score !== null;
                            const madeBid = hasScore && score.bid === score.handsMade;

                            return (
                              <View
                                key={score.playerId}
                                style={[
                                  styles.dataCell,
                                  styles.playerCell,
                                  score.playerId === currentPlayerId && styles.currentPlayerCell,
                                  isCurrentRound && styles.currentRoundCell,
                                ]}
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
                                  <Text style={styles.scoreEmpty}>-</Text>
                                )}
                              </View>
                            );
                          })}
                        </View>
                      );
                    })}
                  </ScrollView>
                </View>
              </ScrollView>
            </LinearGradient>
          </View>

          {/* Total Row */}
          <View style={styles.totalContainer}>
            <LinearGradient
              colors={["rgba(61, 34, 114, 0.95)", "rgba(42, 22, 84, 0.98)"]}
              style={styles.totalGradient}
            >
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.totalRow}>
                  <View style={[styles.totalCell, styles.totalLabelCell]}>
                    <Text style={styles.totalLabel}>Total</Text>
                  </View>
                  {scoreboard.players.map((player) => {
                    const isLeading = player.id === leadingPlayer?.id;
                    const isCurrentPlayer = player.id === currentPlayerId;

                    return (
                      <View
                        key={player.id}
                        style={[
                          styles.totalCell,
                          styles.totalScoreCell,
                          isCurrentPlayer && styles.currentPlayerCell,
                        ]}
                      >
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
              </ScrollView>
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
    paddingVertical: 10,
  },
  titleContainer: {
    alignItems: "center",
    marginBottom: 15,
  },
  title: {
    fontSize: 36,
    fontFamily: "Bangers_400Regular",
    color: "#FFD700",
    textShadowColor: "rgba(255, 165, 0, 0.5)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
    letterSpacing: 3,
  },
  subtitle: {
    fontSize: 16,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    letterSpacing: 1,
    opacity: 0.8,
  },
  tableContainer: {
    flex: 1,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "#5E3A9E",
    maxHeight: "55%",
  },
  tableGradient: {
    flex: 1,
    padding: 10,
  },
  table: {
    minWidth: SCREEN_WIDTH - 50,
  },
  headerRow: {
    flexDirection: "row",
    borderBottomWidth: 2,
    borderBottomColor: "#FFD700",
    paddingBottom: 10,
    marginBottom: 5,
  },
  headerCell: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    justifyContent: "center",
    alignItems: "center",
  },
  trumpCell: {
    width: 90,
  },
  roundCell: {
    width: 60,
  },
  playerCell: {
    width: 80,
  },
  currentPlayerCell: {
    backgroundColor: "rgba(255, 215, 0, 0.15)",
    borderRadius: 8,
  },
  headerText: {
    fontSize: 14,
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
  },
  dataRow: {
    flexDirection: "row",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(94, 58, 158, 0.3)",
  },
  alternateRow: {
    backgroundColor: "rgba(42, 22, 84, 0.3)",
  },
  currentRoundRow: {
    backgroundColor: "rgba(255, 215, 0, 0.1)",
    borderWidth: 1,
    borderColor: "#FFD700",
    borderRadius: 8,
  },
  dataCell: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    justifyContent: "center",
    alignItems: "center",
  },
  currentRoundCell: {
    backgroundColor: "rgba(255, 140, 0, 0.1)",
  },
  trumpSymbol: {
    fontSize: 18,
    fontWeight: "bold",
  },
  trumpName: {
    fontSize: 10,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    opacity: 0.8,
  },
  roundNumber: {
    fontSize: 16,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
  },
  scoreText: {
    fontSize: 16,
    fontFamily: "Bangers_400Regular",
  },
  scorePositive: {
    color: "#FFD700",
  },
  scoreZero: {
    color: "#888888",
  },
  scoreEmpty: {
    fontSize: 16,
    color: "#555555",
  },
  totalContainer: {
    marginTop: 10,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "#FFD700",
  },
  totalGradient: {
    padding: 10,
  },
  totalRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  totalCell: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  totalLabelCell: {
    width: 150,
  },
  totalScoreCell: {
    width: 80,
  },
  totalLabel: {
    fontSize: 18,
    fontFamily: "Bangers_400Regular",
    color: "#FFD700",
    letterSpacing: 2,
  },
  totalScoreContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  crownIcon: {
    fontSize: 14,
    marginRight: 4,
  },
  totalScoreText: {
    fontSize: 20,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
  },
  leadingScore: {
    color: "#FFD700",
    textShadowColor: "rgba(255, 215, 0, 0.5)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  buttonContainer: {
    marginTop: 15,
    alignItems: "center",
    paddingBottom: 10,
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
    paddingVertical: 15,
    paddingHorizontal: 60,
    borderRadius: 14,
  },
  continueButtonText: {
    fontSize: 24,
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
