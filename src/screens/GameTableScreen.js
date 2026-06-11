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
  Pressable,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { useFonts, Bangers_400Regular } from "@expo-google-fonts/bangers";
import socketService from "../services/socket";
import HandWinnerOverlay from "../components/HandWinnerOverlay";
import PlayedCard from "../components/PlayedCard";

// Suit symbols
const SUIT_SYMBOLS = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};

const CARD_W = 54;
const CARD_H = 76;

// Horizontal center offset (px from the table midline) for a top-row seat's
// played card, lined up under that seat's avatar for 6-8 players.
function topCardCenterX(seatIndex, count) {
  if (count <= 5) return 0; // single, centered top seat
  if (count === 6 || count === 7) {
    if (seatIndex === 0) return -150;
    if (seatIndex === 5) return 150;
    return 0; // seat 6 (top-center, 7 players)
  }
  // count === 8: all four top cards sit under their avatars (far-left,
  // center-left, center-right, far-right).
  if (seatIndex === 0) return -190;
  if (seatIndex === 6) return -65;
  if (seatIndex === 7) return 65;
  if (seatIndex === 5) return 190;
  return 0;
}

// Where a given seat's played card sits, anchored inside the table area and
// pulled toward the center so it never covers the avatar or score badge.
//   style     - absolute anchor within the table area
//   baseX/Y   - static px offset to center the card on its anchor
//   enterFrom - direction the card animates in from (toward its player)
//   point     - approximate center (px from table midline) used to compute the
//               slide direction when cards collect to the trick winner
function getCardZone(seatIndex, count) {
  switch (seatIndex) {
    case 0: // top (single or far-left)
    case 5: // top far-right
    case 6: // top-center / center-left
    case 7: { // top center-right
      // Top avatars sit just above the table; the card hangs directly below.
      const cx = topCardCenterX(seatIndex, count);
      return {
        style: { top: 16, left: "50%" },
        baseX: cx - CARD_W / 2,
        baseY: 0,
        enterFrom: { x: 0, y: -26 },
        point: { x: cx, y: -120 },
      };
    }
    case 1: // right - card sits just inboard of the right avatar (~8px gap),
            // vertically centered in line with that avatar
      return {
        style: { top: "50%", right: 90 },
        baseX: 0,
        baseY: -CARD_H / 2 - 3,
        enterFrom: { x: 30, y: 0 },
        point: { x: 130, y: 0 },
      };
    case 3: // left - card sits just inboard of the left avatar (~8px gap),
            // vertically centered in line with that avatar
      return {
        style: { top: "50%", left: 90 },
        baseX: 0,
        baseY: -CARD_H / 2 - 3,
        enterFrom: { x: -30, y: 0 },
        point: { x: -130, y: 0 },
      };
    case 4: // bottom-right avatar (mirror of "You", e.g. Maya). Card sits in
            // the right column (same line as the right player's card) but down
            // near the bottom, just in front of Maya's bottom-right avatar.
      return {
        style: { bottom: -110, right: 90 },
        baseX: 0,
        baseY: 0,
        enterFrom: { x: 22, y: 24 },
        point: { x: 130, y: 120 },
      };
    case 2: // bottom (me)
    default:
      // The "You" avatar stays in the bottom-left corner, but our played card
      // sits center-bottom - just above our hand and directly below the top
      // player's card - to complete the diamond.
      return {
        style: { bottom: -42, left: "50%" },
        baseX: -CARD_W / 2,
        baseY: 0,
        enterFrom: { x: 0, y: 26 },
        point: { x: 0, y: 130 },
      };
  }
}

export default function GameTableScreen({ navigation, route }) {
  const {
    gameState: initialGameState,
    currentPlayerId,
    currentPlayerName,
  } = route.params || {};

  const [gameState, setGameState] = useState(initialGameState);
  const [selectedCard, setSelectedCard] = useState(null);
  const [isPlayingCard, setIsPlayingCard] = useState(false);
  // Hand (trick) winner popup. Non-null while the popup is shown; card play is
  // disabled during this window (the backend also pauses, so bots wait too).
  const [handWinner, setHandWinner] = useState(null);

  // Animations
  const turnGlow = useRef(new Animated.Value(0.6)).current;

  // Pending timers used to hold the completed trick on screen for a beat so the
  // last card played is visible before the winner popup / scoreboard appears.
  const winnerTimerRef = useRef(null);
  const navTimerRef = useRef(null);

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

    // For 3 players: one on the left, one on the right, me centered at bottom.
    if (players.length === 3) {
      return [
        null, // Top empty
        { ...players[(myIndex + 2) % 3], seatIndex: 1 }, // Right
        { ...players[myIndex], seatIndex: 2 }, // Me at bottom (centered)
        { ...players[(myIndex + 1) % 3], seatIndex: 3 }, // Left
      ];
    }

    // For 5 players: seat everyone in turn order around the table, going
    // clockwise from me (bottom-left): left -> top -> right -> bottom-right.
    if (players.length === 5) {
      return [
        { ...players[(myIndex + 2) % 5], seatIndex: 0 }, // Top
        { ...players[(myIndex + 3) % 5], seatIndex: 1 }, // Right
        { ...players[myIndex], seatIndex: 2 }, // Me (bottom-left)
        { ...players[(myIndex + 1) % 5], seatIndex: 3 }, // Left
        { ...players[(myIndex + 4) % 5], seatIndex: 4 }, // Bottom-right
      ];
    }

    // For 6 players: two players share the top row (clustered toward the
    // center so the top-left leave button and top-right round/trump indicator
    // stay clear). Going clockwise from me (bottom-left): left -> top-left ->
    // top-right -> right -> bottom-right.
    if (players.length === 6) {
      return [
        { ...players[(myIndex + 2) % 6], seatIndex: 0 }, // Top-left
        { ...players[(myIndex + 4) % 6], seatIndex: 1 }, // Right
        { ...players[myIndex], seatIndex: 2 }, // Me (bottom-left)
        { ...players[(myIndex + 1) % 6], seatIndex: 3 }, // Left
        { ...players[(myIndex + 5) % 6], seatIndex: 4 }, // Bottom-right
        { ...players[(myIndex + 3) % 6], seatIndex: 5 }, // Top-right
      ];
    }

    // For 7 players: three players share the top row (top-left, top-center,
    // top-right). Going clockwise from me (bottom-left): left -> top-left ->
    // top-center -> top-right -> right -> bottom-right.
    if (players.length === 7) {
      return [
        { ...players[(myIndex + 2) % 7], seatIndex: 0 }, // Top-left
        { ...players[(myIndex + 5) % 7], seatIndex: 1 }, // Right
        { ...players[myIndex], seatIndex: 2 }, // Me (bottom-left)
        { ...players[(myIndex + 1) % 7], seatIndex: 3 }, // Left
        { ...players[(myIndex + 6) % 7], seatIndex: 4 }, // Bottom-right
        { ...players[(myIndex + 4) % 7], seatIndex: 5 }, // Top-right
        { ...players[(myIndex + 3) % 7], seatIndex: 6 }, // Top-center
      ];
    }

    // For 8 players: four players share the top row (far-left, center-left,
    // center-right, far-right). Going clockwise from me (bottom-left): left ->
    // top far-left -> top center-left -> top center-right -> top far-right ->
    // right -> bottom-right.
    if (players.length === 8) {
      return [
        { ...players[(myIndex + 2) % 8], seatIndex: 0 }, // Top far-left
        { ...players[(myIndex + 6) % 8], seatIndex: 1 }, // Right
        { ...players[myIndex], seatIndex: 2 }, // Me (bottom-left)
        { ...players[(myIndex + 1) % 8], seatIndex: 3 }, // Left
        { ...players[(myIndex + 7) % 8], seatIndex: 4 }, // Bottom-right
        { ...players[(myIndex + 5) % 8], seatIndex: 5 }, // Top far-right
        { ...players[(myIndex + 3) % 8], seatIndex: 6 }, // Top center-left
        { ...players[(myIndex + 4) % 8], seatIndex: 7 }, // Top center-right
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

    const unsubscribeHandWinner = socketService.on("hand:winner-announced", (data) => {
      console.log(`Hand ${data.trickNumber} won by ${data.playerName}`);
      // Clear any pending card selection so play is fully blocked.
      setSelectedCard(null);
      // Hold the completed trick on screen briefly so the last card played is
      // visible before the winner popup appears.
      if (winnerTimerRef.current) clearTimeout(winnerTimerRef.current);
      winnerTimerRef.current = setTimeout(() => {
        winnerTimerRef.current = null;
        setHandWinner({
          playerId: data.playerId,
          playerName: data.playerName,
          trickNumber: data.trickNumber,
        });
      }, 900);
    });

    const unsubscribeHandNext = socketService.on("hand:next-started", () => {
      console.log("Next hand started");
      if (winnerTimerRef.current) {
        clearTimeout(winnerTimerRef.current);
        winnerTimerRef.current = null;
      }
      setHandWinner(null);
    });

    const unsubscribeRoundComplete = socketService.on("game:round-complete", (data) => {
      console.log(`Round ${data.roundNumber} complete`);
    });

    const unsubscribeScoreboard = socketService.on("scoreboard:state", (data) => {
      console.log("Scoreboard state received, navigating to ScoreBoard");
      // Wait a beat so the last card of the final trick is visible first.
      if (navTimerRef.current) clearTimeout(navTimerRef.current);
      navTimerRef.current = setTimeout(() => {
        navTimerRef.current = null;
        navigation.replace("ScoreBoard", {
          scoreboard: data.scoreboard,
          currentPlayerId,
          currentPlayerName,
        });
      }, 1800);
    });

    // Final round skips the scoreboard - go straight to the winner screen.
    const unsubscribeFinalWinner = socketService.on("game:final-winner", (data) => {
      console.log("Final winner:", data);
      // Wait a beat so the last card of the final trick is visible first.
      if (navTimerRef.current) clearTimeout(navTimerRef.current);
      navTimerRef.current = setTimeout(() => {
        navTimerRef.current = null;
        navigation.replace("FinalWinner", {
          winners: data.winners,
          winningScore: data.winningScore,
          isTie: data.isTie,
          finalScores: data.finalScores,
          currentPlayerId,
          currentPlayerName,
        });
      }, 1800);
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
      unsubscribeHandWinner();
      unsubscribeHandNext();
      unsubscribeRoundComplete();
      unsubscribeScoreboard();
      unsubscribeFinalWinner();
      unsubscribeGameOver();
      if (winnerTimerRef.current) clearTimeout(winnerTimerRef.current);
      if (navTimerRef.current) clearTimeout(navTimerRef.current);
    };
  }, [navigation, currentPlayerId, currentPlayerName]);

  const handleCardPress = (card, index) => {
    if (handWinner) return;
    if (!isMyTurn || isPlayingCard || gameState?.status !== "PLAYING") return;

    if (!playableCards.includes(index)) {
      Alert.alert("Invalid Play", "You must follow the lead suit if you have it.");
      return;
    }

    // First tap selects the card; tapping the already-selected card plays it.
    if (selectedCard === index) {
      setIsPlayingCard(true);
      socketService.playCard(card);
    } else {
      setSelectedCard(index);
    }
  };

  const renderPlayerSeat = (player, position) => {
    if (!player) return <View key={position} style={styles.emptySeat} />;

    const isCurrentTurn = player.id === gameState?.currentTurnPlayerId;
    const isMe = player.id === currentPlayerId;

    // For 3 players, nudge the left/right seats a bit higher.
    const isThreePlayers = players.length === 3;
    const sideUp = isThreePlayers && (position === 1 || position === 3);

    // For 6/7/8 players, the top seat (0) shares the top row with the other
    // top seats, so it sits left of center instead of spanning the full width.
    const isTopRowSplit = players.length >= 6 && players.length <= 8;

    // For 8 players the top-center seat (6) shifts left to make room for the
    // fourth top seat (7); for 7 players it stays centered.
    const isEightPlayers = players.length === 8;

    return (
      <View
        key={player.id}
        style={[
          styles.playerSeat,
          styles[`seat${position}`],
          isTopRowSplit && position === 0 && styles.seat0Six,
          isEightPlayers && position === 0 && styles.seat0Eight,
          isEightPlayers && position === 5 && styles.seat5Eight,
          isEightPlayers && position === 6 && styles.seat6Eight,
          sideUp && styles.seatSideUp,
        ]}
      >
        <View style={[styles.seatBox, isCurrentTurn && styles.seatBoxActive]}>
          {isCurrentTurn && (
            <Animated.View
              pointerEvents="none"
              style={[styles.seatGlowRing, { opacity: turnGlow }]}
            />
          )}
          {/* Avatar */}
          <View
            style={[
              styles.avatar,
              isCurrentTurn && styles.avatarGlow,
              isCurrentTurn && styles.avatarTurnHighlight,
            ]}
          >
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
              {player.tricksWon} / {player.bid ?? 0}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  // Render each played card in front of its own player's seat (never stacked
  // in the center). Empty seats show a faint placeholder slot, highlighted
  // gold while it is that player's turn.
  const renderPlayedCards = () => {
    if (gameState?.status !== "PLAYING") return null;

    const cardsPlayed = currentTrick?.cardsPlayed || [];
    const seated = arrangedPlayers.filter(Boolean);
    const count = players.length;

    // When a trick has a winner, every card slides toward that seat.
    const winnerSeat = handWinner
      ? arrangedPlayers.find((p) => p && p.id === handWinner.playerId)
      : null;
    const winnerPoint = winnerSeat
      ? getCardZone(winnerSeat.seatIndex, count).point
      : null;

    return seated.map((player) => {
      const zone = getCardZone(player.seatIndex, count);
      const play = cardsPlayed.find((c) => c.playerId === player.id);
      const isTurn = player.id === gameState?.currentTurnPlayerId;

      if (!play) {
        return (
          <View
            key={`slot-${player.id}`}
            pointerEvents="none"
            style={[
              styles.cardSlot,
              zone.style,
              { transform: [{ translateX: zone.baseX }, { translateY: zone.baseY }] },
              isTurn && styles.cardSlotActive,
            ]}
          />
        );
      }

      const resolveDelta = winnerPoint
        ? { x: winnerPoint.x - zone.point.x, y: winnerPoint.y - zone.point.y }
        : null;

      return (
        <PlayedCard
          key={`card-${player.id}-${play.card.suit}-${play.card.rank}`}
          card={play.card}
          zone={zone}
          resolving={!!handWinner}
          resolveDelta={resolveDelta}
        />
      );
    });
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
        {/* Tapping any empty area deselects the currently selected card. */}
        <Pressable style={styles.touchableArea} onPress={() => setSelectedCard(null)}>
        {/* Round + Trump indicator - top right */}
        <View style={styles.roundIndicator}>
          <Text style={styles.roundIndicatorText}>
            Round {currentRound}/{totalRounds}
          </Text>
          <View style={styles.trumpRow}>
            <Text style={styles.trumpRowLabel}>TRUMP</Text>
            <Text
              style={[
                styles.trumpRowSymbol,
                (trump?.suit === "hearts" || trump?.suit === "diamonds") &&
                  styles.trumpRowSymbolRed,
              ]}
            >
              {trump?.symbol}
            </Text>
          </View>
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


        {/* Player seats */}
        <View style={styles.tableArea}>
          {/* Top player (seat 0) */}
          {renderPlayerSeat(arrangedPlayers[0], 0)}

          {/* Top-right player (seat 5) - 6/7-player layout */}
          {arrangedPlayers[5] && renderPlayerSeat(arrangedPlayers[5], 5)}

          {/* Top-center player (seat 6) - 7/8-player layout */}
          {arrangedPlayers[6] && renderPlayerSeat(arrangedPlayers[6], 6)}

          {/* Top center-right player (seat 7) - 8-player layout */}
          {arrangedPlayers[7] && renderPlayerSeat(arrangedPlayers[7], 7)}

          {/* Right player (seat 1) */}
          {renderPlayerSeat(arrangedPlayers[1], 1)}

          {/* Left player (seat 3) */}
          {renderPlayerSeat(arrangedPlayers[3], 3)}

          {/* Played cards - one in front of each player's seat */}
          {renderPlayedCards()}
        </View>

        {/* My hand at bottom */}
        {renderMyHand()}

        {/* Bottom player info (me) - seat 2 */}
        <View
          style={[
            styles.myInfoContainer,
            players.length >= 3 && styles.myInfoLeft,
          ]}
        >
          {arrangedPlayers[2] && (
            <View style={[styles.myInfo, isMyTurn && styles.seatBoxActive]}>
              {isMyTurn && (
                <Animated.View
                  pointerEvents="none"
                  style={[styles.seatGlowRing, { opacity: turnGlow }]}
                />
              )}
              <View
                style={[
                  styles.avatar,
                  isMyTurn && styles.avatarGlow,
                  isMyTurn && styles.avatarTurnHighlight,
                ]}
              >
                <Text style={styles.avatarText}>
                  {(currentPlayerName || arrangedPlayers[2].name || "Y")
                    .charAt(0)
                    .toUpperCase()}
                </Text>
              </View>
              <Text style={styles.myInfoName}>You</Text>
              <View style={styles.myScoreContainer}>
                <Text style={styles.myScoreText}>
                  {arrangedPlayers[2].tricksWon} / {arrangedPlayers[2].bid ?? 0}
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* 5th player - bottom-right corner (mirrors "You" at bottom-left) */}
        {arrangedPlayers[4] && renderPlayerSeat(arrangedPlayers[4], 4)}

        {/* Hand winner popup overlay */}
        <HandWinnerOverlay
          visible={!!handWinner}
          winnerName={handWinner?.playerName}
        />
        </Pressable>

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
  touchableArea: {
    flex: 1,
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
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: "#5E3A9E",
    alignItems: "center",
  },
  roundIndicatorText: {
    fontSize: 17,
    fontFamily: "Bangers_400Regular",
    color: "#FFD700",
    letterSpacing: 1.5,
  },
  trumpRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
  },
  trumpRowLabel: {
    fontSize: 14,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    letterSpacing: 1,
    marginRight: 7,
  },
  trumpRowSymbol: {
    fontSize: 21,
    color: "#FFD700",
    textShadowColor: "#FFD700",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  trumpRowSymbolRed: {
    color: "#FF5D6C",
    textShadowColor: "#FF5D6C",
  },

  // Leave button
  leaveButton: {
    position: "absolute",
    top: 16,
    left: 16,
    backgroundColor: "rgba(183, 28, 28, 0.8)",
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: "#e53935",
  },
  leaveButtonText: {
    fontSize: 15,
    fontFamily: "Bangers_400Regular",
    color: "#FFF",
    letterSpacing: 1.5,
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
  seatBox: {
    alignItems: "center",
    backgroundColor: "rgba(42, 22, 84, 0.85)",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "rgba(255, 215, 0, 0.5)",
  },
  seat0: { // Top - span the full table width and center the seat box
    top: -85,
    left: 0,
    right: 0,
    width: "100%",
    alignItems: "center",
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
  seat4: { // Bottom-right (5th player) - mirrors "You" at bottom-left
    bottom: 24,
    right: 20,
  },
  seat0Six: { // Top-left of the two top seats (6-player layout)
    top: -85,
    left: "50%",
    right: undefined,
    width: 90,
    transform: [{ translateX: -195 }], // left of center, with a gap from seat 5
  },
  seat5: { // Top-right of the top seats (6/7-player layout)
    top: -85,
    left: "50%",
    width: 90,
    transform: [{ translateX: 105 }], // right of center, with a gap from seat 0
  },
  seat6: { // Top-center of the three top seats (7-player layout)
    top: -85,
    left: "50%",
    right: undefined,
    width: 90,
    transform: [{ translateX: -45 }], // centered on the table midline
  },
  seat0Eight: { // Top far-left (8-player layout) - wider than 6/7 layout
    transform: [{ translateX: -235 }],
  },
  seat5Eight: { // Top far-right (8-player layout) - wider than 6/7 layout
    transform: [{ translateX: 145 }],
  },
  seat6Eight: { // Top center-left (8-player layout) - left of midline
    transform: [{ translateX: -110 }],
  },
  seat7: { // Top center-right of the four top seats (8-player layout)
    top: -85,
    left: "50%",
    right: undefined,
    width: 90,
    transform: [{ translateX: 20 }], // right of the midline
  },
  // For 3 players: raise the left/right seats above the table center.
  seatSideUp: {
    top: "40%",
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
    // Constant border so the turn highlight doesn't change the avatar size.
    borderWidth: 2.5,
    borderColor: "transparent",
  },
  avatarGlow: {
    shadowColor: "#FFD700",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
  },
  avatarTurnHighlight: {
    borderColor: "#FFD700",
    backgroundColor: "#7E3FF2",
  },
  // Solid gold border on the seat box of the player whose turn it is.
  seatBoxActive: {
    borderColor: "#FFD700",
  },
  // Animated pulsing glow border around the active player's seat box.
  seatGlowRing: {
    position: "absolute",
    top: -4,
    left: -4,
    right: -4,
    bottom: -4,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: "#FFD700",
    shadowColor: "#FFD700",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 14,
  },
  avatarText: {
    fontSize: 16,
    fontFamily: "Bangers_400Regular",
    color: "#FFF",
    textAlign: "center",
    paddingHorizontal: 5,
  },
  playerName: {
    fontSize: 11,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    textAlign: "center",
    maxWidth: 80,
    paddingHorizontal: 5,
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
    textAlign: "center",
    paddingHorizontal: 5,
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

  // Played-card placeholder slot (shown until a player plays this trick)
  cardSlot: {
    position: "absolute",
    width: CARD_W,
    height: CARD_H,
    borderRadius: 7,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: "rgba(255, 255, 255, 0.12)",
  },
  cardSlotActive: {
    borderStyle: "solid",
    borderColor: "rgba(255, 215, 0, 0.8)",
    backgroundColor: "rgba(255, 215, 0, 0.06)",
    shadowColor: "#FFD700",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
    elevation: 6,
  },
  redCard: {
    color: "#e53935",
  },
  // Lead suit banner (top center)
  leadBannerContainer: {
    position: "absolute",
    top: 16,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 90,
  },
  leadBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(42, 22, 84, 0.92)",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#FFD700",
  },
  leadBannerLabel: {
    fontSize: 13,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    letterSpacing: 1,
    marginRight: 8,
  },
  leadBannerSymbol: {
    fontSize: 22,
    color: "#FFD700",
    textShadowColor: "#FFD700",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  leadBannerSymbolRed: {
    color: "#FF5D6C",
    textShadowColor: "#FF5D6C",
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
    // Leave room above the cards so a selected card can rise without being clipped.
    paddingTop: 24,
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
    left: 0,
    right: 0,
    alignItems: "center",
  },
  // For 3-4 players: put our own info in the bottom-left corner (90px wide,
  // starting at the table's left margin) so it clears the centered card hand.
  myInfoLeft: {
    left: 20,
    right: undefined,
    bottom: 24,
    width: 90,
    alignItems: "center",
  },
  myInfo: {
    alignItems: "center",
    backgroundColor: "rgba(42, 22, 84, 0.85)",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "rgba(255, 215, 0, 0.5)",
  },
  myInfoName: {
    fontSize: 12,
    fontFamily: "Bangers_400Regular",
    color: "#FFD700",
    textAlign: "center",
    paddingHorizontal: 5,
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
    textAlign: "center",
    paddingHorizontal: 5,
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
