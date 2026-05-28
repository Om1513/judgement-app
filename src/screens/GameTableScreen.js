import React, { useEffect, useState, useRef, useMemo } from "react";
import {
  View,
  Text,
  ImageBackground,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Alert,
  ScrollView,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { useFonts, Bangers_400Regular } from "@expo-google-fonts/bangers";
import socketService from "../services/socket";

// Suit symbols
const SUIT_SYMBOLS = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};

// Card position offsets for trick area (4 players)
const TRICK_POSITIONS = [
  { top: 0, left: "50%", transform: [{ translateX: -30 }] }, // Top player
  { top: "50%", right: 0, transform: [{ translateY: -40 }] }, // Right player
  { bottom: 0, left: "50%", transform: [{ translateX: -30 }] }, // Bottom player (me)
  { top: "50%", left: 0, transform: [{ translateY: -40 }] }, // Left player
];

export default function GameTableScreen({ navigation, route }) {
  const {
    gameState: initialGameState,
    currentPlayerId,
    currentPlayerName,
  } = route.params || {};

  const [gameState, setGameState] = useState(initialGameState);
  const [selectedCard, setSelectedCard] = useState(null);
  const [isPlayingCard, setIsPlayingCard] = useState(false);

  // Animations
  const turnGlow = useRef(new Animated.Value(0.6)).current;

  const [fontsLoaded] = useFonts({
    Bangers_400Regular,
  });

  // Extract state values
  const roundState = gameState?.roundState;
  const players = gameState?.players || [];
  const myHand = gameState?.myHand || [];
  const currentRound = roundState?.roundNumber || gameState?.currentRound || 1;
  const totalRounds = gameState?.totalRounds || 4;
  const trump = roundState?.trump;
  const currentTrick = roundState?.currentTrick;
  const trickNumber = roundState?.trickNumber || 1;
  const handSize = roundState?.cardsPerPlayer || 1;
  const isMyTurn = gameState?.isMyTurn;
  const leadSuit = currentTrick?.leadSuit;

  // Arrange players in seat positions (4 player layout)
  // Current player is always at bottom (position 2)
  const arrangedPlayers = useMemo(() => {
    if (!players.length) return [];

    const myIndex = players.findIndex(p => p.id === currentPlayerId);
    if (myIndex === -1) return players;

    // Rotate array so current player is at index 2 (bottom)
    const arranged = [];
    for (let i = 0; i < players.length; i++) {
      const actualIndex = (myIndex + i - 2 + players.length) % players.length;
      arranged.push({
        ...players[actualIndex],
        seatIndex: i, // 0=top, 1=right, 2=bottom, 3=left
      });
    }

    // For 2 players, put opponent at top
    if (players.length === 2) {
      return [
        { ...players[(myIndex + 1) % 2], seatIndex: 0 }, // Opponent at top
        null, // Right empty
        { ...players[myIndex], seatIndex: 2 }, // Me at bottom
        null, // Left empty
      ];
    }

    // For 3 players, use top, bottom-left, bottom-right
    if (players.length === 3) {
      return [
        { ...players[(myIndex + 2) % 3], seatIndex: 0 }, // Top
        { ...players[(myIndex + 1) % 3], seatIndex: 1 }, // Right
        { ...players[myIndex], seatIndex: 2 }, // Me at bottom
        null, // Left empty
      ];
    }

    return arranged;
  }, [players, currentPlayerId]);

  // Calculate playable cards
  const playableCards = useMemo(() => {
    if (!isMyTurn || gameState?.status !== "PLAYING") return [];

    // If no lead suit, all cards are playable
    if (!leadSuit) {
      return myHand.map((_, i) => i);
    }

    // Check if we have the lead suit
    const hasLeadSuit = myHand.some(c => c.suit === leadSuit);

    if (hasLeadSuit) {
      // Must follow suit
      return myHand.map((c, i) => (c.suit === leadSuit ? i : -1)).filter(i => i !== -1);
    }

    // Don't have lead suit - can play anything
    return myHand.map((_, i) => i);
  }, [myHand, leadSuit, isMyTurn, gameState?.status]);

  // Turn glow animation
  useEffect(() => {
    const pulseTurn = () => {
      Animated.sequence([
        Animated.timing(turnGlow, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(turnGlow, {
          toValue: 0.6,
          duration: 800,
          useNativeDriver: true,
        }),
      ]).start(() => pulseTurn());
    };
    pulseTurn();
  }, []);

  // Socket event listeners
  useEffect(() => {
    const unsubscribeUpdate = socketService.on("game:update", (data) => {
      console.log("Game update:", data.gameState?.status);
      setGameState(data.gameState);
      setIsPlayingCard(false);
      setSelectedCard(null);

      // Navigate back to bidding screen for new round
      if (data.gameState.status === "BIDDING") {
        console.log("New round starting, going to bidding screen.");
        navigation.replace("Bidding", {
          gameState: data.gameState,
          currentPlayerId,
          currentPlayerName,
        });
      }
    });

    const unsubscribeError = socketService.on("game:error", (data) => {
      Alert.alert("Error", data.message);
      setIsPlayingCard(false);
    });

    const unsubscribeTrickComplete = socketService.on("game:trick-completed", (data) => {
      console.log(`Trick ${data.trickNumber} won by ${data.winnerName}`);
      // Brief notification - you could add a toast/animation here
    });

    const unsubscribeRoundComplete = socketService.on("game:round-complete", (data) => {
      console.log(`Round ${data.roundNumber} complete`);
    });

    const unsubscribeScoreboard = socketService.on("scoreboard:state", (data) => {
      console.log("Scoreboard state received, navigating to ScoreBoard");
      navigation.replace("ScoreBoard", {
        scoreboard: data.scoreboard,
        currentPlayerId,
        currentPlayerName,
      });
    });

    const unsubscribeGameOver = socketService.on("game:over", (data) => {
      Alert.alert(
        "Game Over!",
        `Winner: ${data.winner.name}`,
        [{ text: "OK", onPress: () => navigation.navigate("Home") }]
      );
    });

    return () => {
      unsubscribeUpdate();
      unsubscribeError();
      unsubscribeTrickComplete();
      unsubscribeRoundComplete();
      unsubscribeScoreboard();
      unsubscribeGameOver();
    };
  }, [navigation, currentPlayerId, currentPlayerName]);

  const handleCardPress = (_card, index) => {
    if (!isMyTurn || isPlayingCard || gameState?.status !== "PLAYING") return;

    if (!playableCards.includes(index)) {
      Alert.alert("Invalid Play", "You must follow the lead suit if you have it.");
      return;
    }

    setSelectedCard(index);
  };

  const handlePlayCard = () => {
    if (selectedCard === null || !isMyTurn || isPlayingCard) return;

    const card = myHand[selectedCard];
    setIsPlayingCard(true);
    socketService.playCard(card);
  };

  const renderPlayerSeat = (player, position) => {
    if (!player) return <View key={position} style={styles.emptySeat} />;

    const isCurrentTurn = player.id === gameState?.currentTurnPlayerId;
    const isMe = player.id === currentPlayerId;

    return (
      <Animated.View
        key={player.id}
        style={[
          styles.playerSeat,
          styles[`seat${position}`],
          isCurrentTurn && { opacity: turnGlow },
        ]}
      >
        <LinearGradient
          colors={
            isCurrentTurn
              ? ["rgba(255, 215, 0, 0.3)", "rgba(255, 215, 0, 0.1)"]
              : ["rgba(42, 22, 84, 0.8)", "rgba(26, 16, 48, 0.8)"]
          }
          style={[
            styles.playerSeatInner,
            isCurrentTurn && styles.currentTurnSeat,
          ]}
        >
          {/* Avatar */}
          <View style={[styles.avatar, isCurrentTurn && styles.avatarGlow]}>
            <Text style={styles.avatarText}>
              {player.name.charAt(0).toUpperCase()}
            </Text>
          </View>

          {/* Name */}
          <Text style={[styles.playerName, isMe && styles.myName]} numberOfLines={1}>
            {isMe ? "You" : player.name}
          </Text>

          {/* Bid / Hands Made */}
          <View style={styles.scoreContainer}>
            <Text style={styles.scoreText}>
              {player.tricksWon} / {player.bid ?? "-"}
            </Text>
          </View>

          {/* Host badge */}
          {player.isHost && (
            <View style={styles.hostBadge}>
              <Text style={styles.hostBadgeText}>HOST</Text>
            </View>
          )}

          {/* Cards remaining indicator */}
          {!isMe && (
            <View style={styles.cardCountBadge}>
              <Text style={styles.cardCountText}>{player.cardCount}</Text>
            </View>
          )}
        </LinearGradient>
      </Animated.View>
    );
  };

  const renderTrickArea = () => {
    const cardsPlayed = currentTrick?.cardsPlayed || [];

    return (
      <View style={styles.trickArea}>
        {cardsPlayed.map((play, index) => {
          // Find player's seat position
          const player = arrangedPlayers.find(p => p && p.id === play.playerId);
          const seatIndex = player?.seatIndex ?? index;
          const isRed = play.card.suit === "hearts" || play.card.suit === "diamonds";

          return (
            <View
              key={`${play.playerId}-${play.card.suit}-${play.card.rank}`}
              style={[styles.trickCard, getTrickCardPosition(seatIndex)]}
            >
              <LinearGradient
                colors={["#FFFFFF", "#F5F5F5", "#EEEEEE"]}
                style={styles.trickCardInner}
              >
                <Text style={[styles.trickCardRank, isRed && styles.redCard]}>
                  {play.card.rank}
                </Text>
                <Text style={[styles.trickCardSuit, isRed && styles.redCard]}>
                  {SUIT_SYMBOLS[play.card.suit]}
                </Text>
              </LinearGradient>
            </View>
          );
        })}

        {/* Show lead suit indicator */}
        {leadSuit && (
          <View style={styles.leadSuitIndicator}>
            <Text style={styles.leadSuitLabel}>LEAD</Text>
            <Text style={[
              styles.leadSuitSymbol,
              (leadSuit === "hearts" || leadSuit === "diamonds") && styles.redCard
            ]}>
              {SUIT_SYMBOLS[leadSuit]}
            </Text>
          </View>
        )}
      </View>
    );
  };

  const getTrickCardPosition = (seatIndex) => {
    switch (seatIndex) {
      case 0: // Top
        return { top: 10 };
      case 1: // Right
        return { right: 10 };
      case 2: // Bottom
        return { bottom: 10 };
      case 3: // Left
        return { left: 10 };
      default:
        return {};
    }
  };

  const renderMyHand = () => {
    return (
      <View style={styles.myHandContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.myHandScroll}
        >
          {myHand.map((card, index) => {
            const isRed = card.suit === "hearts" || card.suit === "diamonds";
            const isPlayable = playableCards.includes(index);
            const isSelected = selectedCard === index;

            return (
              <TouchableOpacity
                key={`${card.suit}-${card.rank}-${index}`}
                onPress={() => handleCardPress(card, index)}
                disabled={!isMyTurn || isPlayingCard || !isPlayable}
                activeOpacity={0.8}
                style={[
                  styles.handCard,
                  isSelected && styles.handCardSelected,
                  !isPlayable && isMyTurn && styles.handCardDisabled,
                ]}
              >
                <LinearGradient
                  colors={
                    isSelected
                      ? ["#FFE55C", "#FFD700", "#F5A623"]
                      : ["#FFFFFF", "#F5F5F5", "#EEEEEE"]
                  }
                  style={styles.handCardInner}
                >
                  <Text style={[
                    styles.handCardRank,
                    isRed && styles.redCard,
                    isSelected && styles.selectedCardText,
                  ]}>
                    {card.rank}
                  </Text>
                  <Text style={[
                    styles.handCardSuit,
                    isRed && styles.redCard,
                    isSelected && styles.selectedCardText,
                  ]}>
                    {SUIT_SYMBOLS[card.suit]}
                  </Text>
                </LinearGradient>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Play button */}
        {selectedCard !== null && isMyTurn && (
          <TouchableOpacity
            onPress={handlePlayCard}
            disabled={isPlayingCard}
            style={styles.playButtonContainer}
          >
            <LinearGradient
              colors={isPlayingCard ? ["#666", "#444"] : ["#4CAF50", "#388E3C"]}
              style={styles.playButton}
            >
              <Text style={styles.playButtonText}>
                {isPlayingCard ? "Playing..." : "Play Card"}
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        )}
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

  // Show bidding screen if still in bidding phase
  if (gameState.status === "BIDDING") {
    return (
      <View style={styles.container}>
        <ImageBackground
          source={require("../../assets/game.png")}
          style={styles.background}
          resizeMode="cover"
        >
          <View style={styles.biddingPhaseOverlay}>
            <Text style={styles.biddingPhaseText}>Bidding Phase</Text>
            <Text style={styles.biddingPhaseSubtext}>
              Waiting for all players to bid...
            </Text>
          </View>
        </ImageBackground>
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
        {/* Round indicator - top right */}
        <View style={styles.roundIndicator}>
          <Text style={styles.roundIndicatorText}>
            Round {currentRound}/{totalRounds}
          </Text>
          <Text style={styles.handIndicatorText}>
            Hand {trickNumber}/{handSize}
          </Text>
        </View>

        {/* Trump indicator - top left */}
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

        {/* Leave button - bottom left */}
        <TouchableOpacity
          style={styles.leaveButton}
          onPress={() => {
            Alert.alert(
              "Leave Game",
              "Are you sure you want to leave the game?",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Leave",
                  style: "destructive",
                  onPress: () => {
                    socketService.leaveLobby();
                    navigation.navigate("Home");
                  },
                },
              ]
            );
          }}
        >
          <Text style={styles.leaveButtonText}>LEAVE</Text>
        </TouchableOpacity>

        {/* Turn indicator */}
        {isMyTurn && gameState.status === "PLAYING" && (
          <View style={styles.turnBanner}>
            <LinearGradient
              colors={["rgba(255, 215, 0, 0.9)", "rgba(245, 166, 35, 0.9)"]}
              style={styles.turnBannerGradient}
            >
              <Text style={styles.turnBannerText}>YOUR TURN</Text>
            </LinearGradient>
          </View>
        )}

        {/* Player seats */}
        <View style={styles.tableArea}>
          {/* Top player (seat 0) */}
          {renderPlayerSeat(arrangedPlayers[0], 0)}

          {/* Right player (seat 1) */}
          {renderPlayerSeat(arrangedPlayers[1], 1)}

          {/* Left player (seat 3) */}
          {renderPlayerSeat(arrangedPlayers[3], 3)}

          {/* Trick area in center */}
          {renderTrickArea()}
        </View>

        {/* My hand at bottom */}
        {renderMyHand()}

        {/* Bottom player info (me) - seat 2 */}
        <View style={styles.myInfoContainer}>
          {arrangedPlayers[2] && (
            <View style={styles.myInfo}>
              <Text style={styles.myInfoName}>You</Text>
              <View style={styles.myScoreContainer}>
                <Text style={styles.myScoreText}>
                  {arrangedPlayers[2].tricksWon} / {arrangedPlayers[2].bid ?? "-"}
                </Text>
              </View>
            </View>
          )}
        </View>

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
    top: 16,
    right: 16,
    backgroundColor: "rgba(42, 22, 84, 0.9)",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#5E3A9E",
    alignItems: "center",
  },
  roundIndicatorText: {
    fontSize: 14,
    fontFamily: "Bangers_400Regular",
    color: "#FFD700",
    letterSpacing: 1,
  },
  handIndicatorText: {
    fontSize: 12,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    opacity: 0.8,
    marginTop: 2,
  },
  trumpIndicator: {
    position: "absolute",
    top: 16,
    left: 16,
    backgroundColor: "rgba(42, 22, 84, 0.9)",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#FFD700",
    flexDirection: "row",
    alignItems: "center",
  },
  trumpIndicatorLabel: {
    fontSize: 12,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    marginRight: 8,
  },
  trumpIndicatorSymbol: {
    fontSize: 20,
    color: "#1a1a2e",
    textShadowColor: "#FFD700",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  trumpIndicatorRed: {
    color: "#e53935",
    textShadowColor: "#e53935",
  },

  // Leave button
  leaveButton: {
    position: "absolute",
    bottom: 16,
    left: 16,
    backgroundColor: "rgba(183, 28, 28, 0.8)",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e53935",
  },
  leaveButtonText: {
    fontSize: 12,
    fontFamily: "Bangers_400Regular",
    color: "#FFF",
    letterSpacing: 1,
  },

  // Turn banner
  turnBanner: {
    position: "absolute",
    top: 60,
    left: "50%",
    transform: [{ translateX: -60 }],
    zIndex: 100,
  },
  turnBannerGradient: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  turnBannerText: {
    fontSize: 14,
    fontFamily: "Bangers_400Regular",
    color: "#2A1654",
    letterSpacing: 2,
  },

  // Table area
  tableArea: {
    flex: 1,
    marginTop: 90,
    marginBottom: 140,
    marginHorizontal: 20,
    position: "relative",
  },

  // Player seats
  playerSeat: {
    position: "absolute",
    width: 90,
    alignItems: "center",
  },
  seat0: { // Top
    top: 0,
    left: "50%",
    transform: [{ translateX: -45 }],
  },
  seat1: { // Right
    right: 0,
    top: "50%",
    transform: [{ translateY: -50 }],
  },
  seat2: { // Bottom (me) - handled separately
    bottom: 0,
    left: "50%",
    transform: [{ translateX: -45 }],
  },
  seat3: { // Left
    left: 0,
    top: "50%",
    transform: [{ translateY: -50 }],
  },
  emptySeat: {
    width: 90,
    height: 100,
  },
  playerSeatInner: {
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255, 215, 0, 0.3)",
    minWidth: 80,
  },
  currentTurnSeat: {
    borderColor: "#FFD700",
    borderWidth: 2,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#5E3A9E",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  avatarGlow: {
    shadowColor: "#FFD700",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
  },
  avatarText: {
    fontSize: 16,
    fontFamily: "Bangers_400Regular",
    color: "#FFF",
  },
  playerName: {
    fontSize: 11,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    textAlign: "center",
    maxWidth: 70,
  },
  myName: {
    color: "#FFD700",
  },
  scoreContainer: {
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 4,
  },
  scoreText: {
    fontSize: 12,
    fontFamily: "Bangers_400Regular",
    color: "#4CAF50",
  },
  hostBadge: {
    position: "absolute",
    top: -6,
    right: -6,
    backgroundColor: "#F5A623",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  hostBadgeText: {
    fontSize: 7,
    fontFamily: "Bangers_400Regular",
    color: "#2A1654",
  },
  cardCountBadge: {
    position: "absolute",
    bottom: -4,
    right: -4,
    backgroundColor: "#5E3A9E",
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#FFD700",
  },
  cardCountText: {
    fontSize: 10,
    fontFamily: "Bangers_400Regular",
    color: "#FFF",
  },

  // Trick area
  trickArea: {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: 140,
    height: 140,
    transform: [{ translateX: -70 }, { translateY: -70 }],
    alignItems: "center",
    justifyContent: "center",
  },
  trickCard: {
    position: "absolute",
    width: 50,
    height: 70,
    borderRadius: 6,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  trickCardInner: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  trickCardRank: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#1a1a2e",
  },
  trickCardSuit: {
    fontSize: 16,
    color: "#1a1a2e",
  },
  redCard: {
    color: "#e53935",
  },
  leadSuitIndicator: {
    position: "absolute",
    top: -30,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    flexDirection: "row",
    alignItems: "center",
  },
  leadSuitLabel: {
    fontSize: 10,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    marginRight: 4,
  },
  leadSuitSymbol: {
    fontSize: 14,
    color: "#1a1a2e",
  },

  // My hand
  myHandContainer: {
    position: "absolute",
    bottom: 10,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  myHandScroll: {
    paddingHorizontal: 20,
    alignItems: "flex-end",
  },
  handCard: {
    marginHorizontal: -8,
    width: 55,
    height: 80,
    borderRadius: 8,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  handCardSelected: {
    transform: [{ translateY: -15 }],
    shadowColor: "#FFD700",
    shadowOpacity: 0.6,
    shadowRadius: 8,
  },
  handCardDisabled: {
    opacity: 0.5,
  },
  handCardInner: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#ddd",
  },
  handCardRank: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#1a1a2e",
  },
  handCardSuit: {
    fontSize: 18,
    color: "#1a1a2e",
  },
  selectedCardText: {
    color: "#2A1654",
  },
  playButtonContainer: {
    marginTop: 8,
  },
  playButton: {
    paddingVertical: 8,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  playButtonText: {
    fontSize: 14,
    fontFamily: "Bangers_400Regular",
    color: "#FFF",
    letterSpacing: 1,
  },

  // My info
  myInfoContainer: {
    position: "absolute",
    bottom: 100,
    left: "50%",
    transform: [{ translateX: -40 }],
  },
  myInfo: {
    alignItems: "center",
  },
  myInfoName: {
    fontSize: 12,
    fontFamily: "Bangers_400Regular",
    color: "#FFD700",
  },
  myScoreContainer: {
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 6,
    marginTop: 2,
  },
  myScoreText: {
    fontSize: 14,
    fontFamily: "Bangers_400Regular",
    color: "#4CAF50",
  },

  // Bidding phase overlay
  biddingPhaseOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  biddingPhaseText: {
    fontSize: 28,
    fontFamily: "Bangers_400Regular",
    color: "#FFD700",
  },
  biddingPhaseSubtext: {
    fontSize: 16,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    marginTop: 8,
  },
});
