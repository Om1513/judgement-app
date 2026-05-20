import React, { useEffect, useRef, useState, useMemo } from "react";
import {
  View,
  Text,
  ImageBackground,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Alert,
  ScrollView,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { useFonts, Bangers_400Regular } from "@expo-google-fonts/bangers";
import socketService from "../services/socket";

export default function BiddingScreen({ navigation, route }) {
  const {
    gameState: initialGameState,
    currentPlayerId,
    currentPlayerName,
  } = route.params || {};

  const [gameState, setGameState] = useState(initialGameState);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const modalScale = useRef(new Animated.Value(0.9)).current;

  const [fontsLoaded] = useFonts({
    Bangers_400Regular,
  });

  // Get current round state
  const roundState = gameState?.roundState;
  const players = gameState?.players || [];
  const myHand = gameState?.myHand || [];
  const isMyTurn = roundState?.currentBidderId === currentPlayerId;
  const handSize = roundState?.cardsPerPlayer || 1;
  const trump = roundState?.trump;
  const currentRound = roundState?.roundNumber || 1;
  const totalRounds = gameState?.totalRounds || 4;

  // Calculate forbidden bid for last bidder
  const forbiddenBid = useMemo(() => {
    if (!roundState?.isLastBidder) return null;
    const totalBidsSoFar = roundState.totalBidsSoFar || 0;
    const forbidden = handSize - totalBidsSoFar;
    if (forbidden >= 0 && forbidden <= handSize) {
      return forbidden;
    }
    return null;
  }, [roundState, handSize]);

  // Socket event listeners
  useEffect(() => {
    const unsubscribeUpdate = socketService.on("game:update", (data) => {
      console.log("Game update:", data.gameState?.status);
      setGameState(data.gameState);
      setIsSubmitting(false);

      // Navigate to game table when playing phase begins
      if (data.gameState.status === "PLAYING") {
        console.log("All bids complete! Navigating to game table.");
        navigation.replace("GameTable", {
          gameState: data.gameState,
          currentPlayerId,
          currentPlayerName,
        });
      }
    });

    const unsubscribeError = socketService.on("game:error", (data) => {
      Alert.alert("Error", data.message);
      setIsSubmitting(false);
    });

    return () => {
      unsubscribeUpdate();
      unsubscribeError();
    };
  }, [navigation, currentPlayerId, currentPlayerName]);

  // Entrance animations
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
      Animated.spring(modalScale, {
        toValue: 1,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);


  const handleSubmitBid = (bid) => {
    if (!isMyTurn || isSubmitting) return;

    if (forbiddenBid !== null && bid === forbiddenBid) {
      Alert.alert(
        "Invalid Bid",
        `You cannot bid ${bid}. Total bids cannot equal ${handSize}.`
      );
      return;
    }

    setIsSubmitting(true);
    socketService.submitBid(bid);
  };

  const renderBidButtons = () => {
    const bidOptions = [];
    for (let i = 0; i <= handSize; i++) {
      bidOptions.push(i);
    }

    return (
      <View style={styles.bidButtonsContainer}>
        {bidOptions.map((bid) => {
          const isForbidden = forbiddenBid !== null && bid === forbiddenBid;

          return (
            <TouchableOpacity
              key={bid}
              onPress={() => handleSubmitBid(bid)}
              disabled={isForbidden || !isMyTurn || isSubmitting || gameState?.status !== "BIDDING"}
              activeOpacity={0.7}
              style={styles.bidButtonWrapper}
            >
              <LinearGradient
                colors={
                  isForbidden
                    ? ["#4A4A4A", "#3A3A3A"]
                    : ["#5E3A9E", "#3D2272"]
                }
                style={[
                  styles.bidButton,
                  isForbidden && styles.bidButtonForbidden,
                ]}
              >
                <Text
                  style={[
                    styles.bidButtonText,
                    isForbidden && styles.bidButtonTextForbidden,
                  ]}
                >
                  {bid}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  const renderTrumpDisplay = () => {
    if (!trump) return null;

    const suitSymbol = trump.symbol;
    const isRed = trump.suit === "hearts" || trump.suit === "diamonds";

    return (
      <View style={styles.trumpDisplayContainer}>
        <View style={styles.trumpDivider} />
        <View style={styles.trumpContent}>
          <Text style={styles.trumpLabel}>TRUMP SUIT</Text>
          <Text style={[styles.trumpSymbol, isRed && styles.trumpSymbolRed]}>
            {suitSymbol}
          </Text>
          <Text style={styles.trumpName}>{trump.name}</Text>
        </View>
        <View style={styles.trumpDivider} />
      </View>
    );
  };

  const renderBiddingTable = () => {
    return (
      <View style={styles.tableContainer}>
        {/* Header Row */}
        <View style={styles.tableRow}>
          <View style={[styles.tableCell, styles.tableLabelCell]}>
            <Text style={styles.tableLabelText}>Player</Text>
          </View>
          {players.map((player) => (
            <View
              key={player.id}
              style={[
                styles.tableCell,
                styles.tablePlayerCell,
                player.id === currentPlayerId && styles.tableCurrentPlayerCell,
              ]}
            >
              <Text
                style={[
                  styles.tablePlayerName,
                  player.id === currentPlayerId && styles.tableCurrentPlayerName,
                ]}
                numberOfLines={1}
              >
                {player.id === currentPlayerId ? "You" : player.name}
              </Text>
              {player.isHost && (
                <View style={styles.hostBadge}>
                  <Text style={styles.hostBadgeText}>HOST</Text>
                </View>
              )}
            </View>
          ))}
        </View>

        {/* Divider */}
        <View style={styles.tableDivider} />

        {/* Bids Row */}
        <View style={styles.tableRow}>
          <View style={[styles.tableCell, styles.tableLabelCell]}>
            <Text style={styles.tableLabelText}>Bid</Text>
          </View>
          {players.map((player) => {
            const hasBid = player.hasBid;
            const bid = player.bid;
            const isCurrentBidder = roundState?.currentBidderId === player.id;

            return (
              <View
                key={player.id}
                style={[
                  styles.tableCell,
                  styles.tableBidCell,
                  player.id === currentPlayerId && styles.tableCurrentPlayerCell,
                ]}
              >
                {isCurrentBidder ? (
                  <View style={styles.biddingIndicator}>
                    <Text style={styles.biddingDots}>...</Text>
                  </View>
                ) : hasBid ? (
                  <View style={styles.bidValueContainer}>
                    <Text style={styles.bidValueText}>{bid}</Text>
                  </View>
                ) : (
                  <Text style={styles.noBidText}>-</Text>
                )}
              </View>
            );
          })}
        </View>
      </View>
    );
  };

  const renderMyCards = () => {
    return (
      <View style={styles.myCardsContainer}>
        <Text style={styles.myCardsLabel}>Your Cards</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.myCardsScroll}
        >
          {myHand.map((card, index) => {
            const isRed = card.suit === "hearts" || card.suit === "diamonds";
            const suitSymbol =
              card.suit === "spades" ? "♠" :
              card.suit === "hearts" ? "♥" :
              card.suit === "diamonds" ? "♦" : "♣";

            return (
              <View key={`${card.suit}-${card.rank}-${index}`} style={styles.cardMini}>
                <LinearGradient
                  colors={["#FFFFFF", "#F5F5F5", "#EEEEEE"]}
                  style={styles.cardMiniGradient}
                >
                  <Text style={[styles.cardMiniRank, isRed && styles.cardMiniRed]}>
                    {card.rank}
                  </Text>
                  <Text style={[styles.cardMiniSuit, isRed && styles.cardMiniRed]}>
                    {suitSymbol}
                  </Text>
                </LinearGradient>
              </View>
            );
          })}
        </ScrollView>
      </View>
    );
  };

  if (!fontsLoaded || !gameState) {
    return (
      <View style={styles.container}>
        <ImageBackground
          source={require("../../assets/game.png")}
          style={styles.background}
          resizeMode="cover"
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ImageBackground
        source={require("../../assets/game.png")}
        style={styles.background}
        resizeMode="cover"
      >
        {/* Round indicator - bottom right */}
        <View style={styles.roundIndicator}>
          <Text style={styles.roundIndicatorText}>
            Round {currentRound}/{totalRounds}
          </Text>
        </View>

        {/* Trump indicator - bottom right corner */}
        <View style={styles.trumpIndicator}>
          <Text style={styles.trumpIndicatorLabel}>TRUMP</Text>
          <Text
            style={[
              styles.trumpIndicatorSymbol,
              (trump?.suit === "hearts" || trump?.suit === "diamonds") &&
                styles.trumpIndicatorRed,
            ]}
          >
            {trump?.symbol}
          </Text>
        </View>

        {/* Modal Overlay */}
        <Animated.View
          style={[
            styles.modalOverlay,
            {
              opacity: fadeAnim,
              transform: [{ scale: modalScale }],
            },
          ]}
        >
          {/* Modal Container */}
          <View style={styles.modalContainer}>
            <LinearGradient
              colors={["rgba(42, 22, 84, 0.95)", "rgba(26, 16, 48, 0.98)"]}
              style={styles.modalGradient}
            >
              {/* Title */}
              <View style={styles.titleContainer}>
                <Text style={styles.titleText}>
                  Select Expected Number of Hands
                </Text>
              </View>

              {/* Bid Buttons */}
              {isMyTurn && gameState?.status === "BIDDING" ? (
                <>
                  {renderBidButtons()}
                  {isSubmitting && (
                    <View style={styles.submittingContainer}>
                      <Text style={styles.submittingText}>Submitting...</Text>
                    </View>
                  )}
                </>
              ) : gameState?.status === "PLAYING" ? (
                <View style={styles.waitingMessageContainer}>
                  <LinearGradient
                    colors={["rgba(76, 175, 80, 0.3)", "rgba(56, 142, 60, 0.3)"]}
                    style={styles.completedMessage}
                  >
                    <Text style={styles.completedText}>All Bids Complete!</Text>
                    <Text style={styles.completedSubtext}>
                      Starting play phase...
                    </Text>
                  </LinearGradient>
                </View>
              ) : (
                <View style={styles.waitingMessageContainer}>
                  <Text style={styles.waitingText}>
                    Waiting for{" "}
                    <Text style={styles.waitingPlayerName}>
                      {players.find((p) => p.id === roundState?.currentBidderId)?.name || "player"}
                    </Text>
                    {" "}to bid...
                  </Text>
                </View>
              )}

              {/* Trump Display */}
              {renderTrumpDisplay()}

              {/* Bidding Table */}
              {renderBiddingTable()}
            </LinearGradient>
          </View>
        </Animated.View>

        {/* My Cards - Bottom */}
        {renderMyCards()}

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

  // Round & Trump Indicators
  roundIndicator: {
    position: "absolute",
    bottom: 100,
    right: 20,
    backgroundColor: "rgba(42, 22, 84, 0.9)",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#5E3A9E",
  },
  roundIndicatorText: {
    fontSize: 14,
    fontFamily: "Bangers_400Regular",
    color: "#FFD700",
    letterSpacing: 1,
  },
  trumpIndicator: {
    position: "absolute",
    bottom: 55,
    right: 20,
    backgroundColor: "rgba(42, 22, 84, 0.9)",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#FFD700",
    flexDirection: "row",
    alignItems: "center",
  },
  trumpIndicatorLabel: {
    fontSize: 12,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    marginRight: 6,
  },
  trumpIndicatorSymbol: {
    fontSize: 18,
    color: "#1a1a2e",
  },
  trumpIndicatorRed: {
    color: "#e53935",
  },

  // Modal
  modalOverlay: {
    position: "absolute",
    top: 20,
    left: 16,
    right: 16,
    bottom: 90,
    justifyContent: "center",
    alignItems: "center",
  },
  modalContainer: {
    width: "100%",
    maxWidth: 500,
    maxHeight: "100%",
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255, 215, 0, 0.4)",
    backgroundColor: "rgba(26, 16, 48, 0.98)",
  },
  modalGradient: {
    paddingVertical: 16,
    paddingHorizontal: 16,
  },

  // Title
  titleContainer: {
    alignItems: "center",
    marginBottom: 12,
  },
  titleText: {
    fontSize: 20,
    fontFamily: "Bangers_400Regular",
    color: "#FFD700",
    textAlign: "center",
    letterSpacing: 1,
  },

  // Bid Buttons
  bidButtonsContainer: {
    flexDirection: "row",
    justifyContent: "center",
    flexWrap: "wrap",
    marginBottom: 10,
  },
  bidButtonWrapper: {
    margin: 4,
  },
  bidButton: {
    width: 48,
    height: 48,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#3D2272",
  },
  bidButtonForbidden: {
    opacity: 0.4,
    borderColor: "#555",
  },
  bidButtonText: {
    fontSize: 20,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
  },
  bidButtonTextForbidden: {
    color: "#888",
  },

  // Submitting Indicator
  submittingContainer: {
    alignItems: "center",
    marginBottom: 16,
  },
  submittingText: {
    fontSize: 16,
    fontFamily: "Bangers_400Regular",
    color: "#FFD700",
    letterSpacing: 1,
  },

  // Waiting Message
  waitingMessageContainer: {
    alignItems: "center",
    marginVertical: 16,
  },
  waitingText: {
    fontSize: 16,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
  },
  waitingPlayerName: {
    color: "#FFD700",
  },
  completedMessage: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(76, 175, 80, 0.5)",
  },
  completedText: {
    fontSize: 20,
    fontFamily: "Bangers_400Regular",
    color: "#4CAF50",
    textAlign: "center",
  },
  completedSubtext: {
    fontSize: 14,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    textAlign: "center",
    marginTop: 4,
  },

  // Trump Display
  trumpDisplayContainer: {
    alignItems: "center",
    marginVertical: 10,
  },
  trumpDivider: {
    width: "60%",
    height: 1,
    backgroundColor: "rgba(255, 215, 0, 0.3)",
    borderRadius: 1,
  },
  trumpContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
  },
  trumpLabel: {
    fontSize: 14,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    letterSpacing: 2,
    marginRight: 10,
  },
  trumpSymbol: {
    fontSize: 24,
    color: "#1a1a2e",
    marginRight: 6,
    textShadowColor: "#FFD700",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  trumpSymbolRed: {
    color: "#e53935",
    textShadowColor: "#e53935",
  },
  trumpName: {
    fontSize: 14,
    fontFamily: "Bangers_400Regular",
    color: "#FFD700",
  },

  // Bidding Table
  tableContainer: {
    backgroundColor: "rgba(0, 0, 0, 0.3)",
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 215, 0, 0.2)",
  },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  tableDivider: {
    height: 1,
    backgroundColor: "rgba(255, 215, 0, 0.3)",
    marginVertical: 6,
  },
  tableCell: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  tableLabelCell: {
    flex: 0.6,
    alignItems: "flex-start",
    paddingLeft: 8,
  },
  tableLabelText: {
    fontSize: 12,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    opacity: 0.7,
  },
  tablePlayerCell: {
    borderLeftWidth: 1,
    borderLeftColor: "rgba(255, 215, 0, 0.2)",
  },
  tableCurrentPlayerCell: {
    backgroundColor: "rgba(255, 215, 0, 0.1)",
  },
  tablePlayerName: {
    fontSize: 12,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    textAlign: "center",
  },
  tableCurrentPlayerName: {
    color: "#FFD700",
  },
  hostBadge: {
    backgroundColor: "#F5A623",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 2,
  },
  hostBadgeText: {
    fontSize: 8,
    fontFamily: "Bangers_400Regular",
    color: "#2A1654",
  },
  tableBidCell: {
    borderLeftWidth: 1,
    borderLeftColor: "rgba(255, 215, 0, 0.2)",
    minHeight: 32,
  },
  biddingIndicator: {
    backgroundColor: "#F5A623",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 6,
  },
  biddingDots: {
    fontSize: 14,
    fontFamily: "Bangers_400Regular",
    color: "#2A1654",
  },
  bidValueContainer: {
    backgroundColor: "#4CAF50",
    paddingHorizontal: 12,
    paddingVertical: 3,
    borderRadius: 6,
  },
  bidValueText: {
    fontSize: 16,
    fontFamily: "Bangers_400Regular",
    color: "#FFF",
  },
  noBidText: {
    fontSize: 16,
    fontFamily: "Bangers_400Regular",
    color: "#666",
  },

  // My Cards
  myCardsContainer: {
    position: "absolute",
    bottom: 10,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  myCardsLabel: {
    fontSize: 12,
    fontFamily: "Bangers_400Regular",
    color: "#FFD700",
    marginBottom: 6,
    letterSpacing: 1,
  },
  myCardsScroll: {
    paddingHorizontal: 10,
  },
  cardMini: {
    marginHorizontal: 3,
    borderRadius: 6,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  cardMiniGradient: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    alignItems: "center",
  },
  cardMiniRank: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#1a1a2e",
  },
  cardMiniSuit: {
    fontSize: 12,
    color: "#1a1a2e",
  },
  cardMiniRed: {
    color: "#e53935",
  },
});
