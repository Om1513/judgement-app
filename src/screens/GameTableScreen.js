import React, { useEffect, useState, useRef, useMemo, useCallback } from "react";
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
import CircleIconButton from "../components/CircleIconButton";
import SoundToggleButton from "../components/SoundToggleButton";
import ScoreboardModal from "../components/ScoreboardModal";
import audioManager from "../services/audioManager";
import PlayedCard from "../components/PlayedCard";
import { arrangeSeats } from "../utils/seating";
import { getPlayableCardIndexes } from "../utils/cardRules";

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

  // Trick counts frozen at their pre-trick values, or null when the live values
  // should show. The server increments tricksWon the moment a trick resolves,
  // which is ~1.9s before the winner popup appears, so an avatar would flip
  // "0/1" -> "1/1" well before the animation that explains it. Holding the old
  // counts here lets the number tick up as the popup lands instead.
  const [heldTricks, setHeldTricks] = useState(null);
  // Counts carried by the previous game:update - i.e. what is still on screen
  // at the moment a trick-resolved update arrives.
  const prevTrickCountsRef = useRef({});

  // Who had already played into the current trick as of the last update, used
  // to spot new cards and sound them. Seeded from the state we arrived with so
  // joining or reconnecting mid-trick doesn't replay the cards already down.
  const playedCardIdsRef = useRef(
    (initialGameState?.roundState?.currentTrick?.cardsPlayed || []).map((c) => c.playerId)
  );

  // Read-only scoreboard peek, opened from the header button.
  const [peekOpen, setPeekOpen] = useState(false);
  const [peekScoreboard, setPeekScoreboard] = useState(null);
  // Set while a peek request is in flight so the shared scoreboard:state
  // listener can tell our reply apart from the round-end broadcast.
  const peekPendingRef = useRef(false);

  // Latest round number, kept in a ref because the socket listeners below are
  // registered once and would otherwise close over a stale gameState.
  const currentRoundRef = useRef(initialGameState?.roundState?.roundNumber ?? 1);

  // Which trick last played the hand-won sting, as "round:trick". Trick numbers
  // restart every round, so the round has to be part of the key. Seeded from
  // the state we arrive with: if that trick is already resolved we are
  // reconnecting into a finished hand and must not replay its sound.
  const lastHandWonKeyRef = useRef(
    initialGameState?.roundState?.currentTrick?.winnerId
      ? `${initialGameState?.roundState?.roundNumber}:${initialGameState?.roundState?.trickNumber}`
      : null
  );

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
  const isMyTurn = gameState?.isMyTurn;
  const leadSuit = currentTrick?.leadSuit;

  // Fired by the winner popup once its entrance animation settles. That is the
  // beat the new count belongs on: the player sees "X wins the hand!" and their
  // tally ticks up underneath it.
  const handleWinnerShown = useCallback(() => setHeldTricks(null), []);

  // Tricks to show for a seat: the frozen count while a win is being announced,
  // otherwise whatever the server last sent.
  const displayedTricks = (player) =>
    heldTricks && heldTricks[player.id] !== undefined
      ? heldTricks[player.id]
      : player.tricksWon;

  // Seat everyone around the table with the local player at the bottom.
  // The rotation itself lives in ../utils/seating so it can be unit tested.
  const arrangedPlayers = useMemo(
    () => arrangeSeats(players, currentPlayerId),
    [players, currentPlayerId]
  );

  // Which cards the player may tap. Mirrors the server follow-suit rule;
  // see ../utils/cardRules.
  const playableCards = useMemo(
    () =>
      getPlayableCardIndexes(myHand, leadSuit, {
        isMyTurn,
        status: gameState?.status,
      }),
    [myHand, leadSuit, isMyTurn, gameState?.status]
  );

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

      // A resolved trick (currentTrick already has a winner) is the update that
      // carries the bumped tricksWon. Pin the avatars to the counts we were
      // already showing; they are released when the winner popup finishes
      // animating in. Any other update means nothing is pending, so show live.
      const incomingPlayers = data.gameState?.players || [];
      if (data.gameState?.roundState?.currentTrick?.winnerId) {
        setHeldTricks((held) => held ?? prevTrickCountsRef.current);
      } else {
        setHeldTricks(null);
      }
      prevTrickCountsRef.current = Object.fromEntries(
        incomingPlayers.map((p) => [p.id, p.tricksWon])
      );

      if (data.gameState?.roundState?.roundNumber) {
        currentRoundRef.current = data.gameState.roundState.roundNumber;
      }

      // Sound anyone else's card hitting the table - humans and bots alike.
      // My own card already sounded on tap, so it is excluded here rather than
      // played twice. Comparing player ids (not a count) means the reset to an
      // empty trick between hands can't be mistaken for a play.
      const playedNow =
        data.gameState?.roundState?.currentTrick?.cardsPlayed || [];
      const idsNow = playedNow.map((c) => c.playerId);
      const idsBefore = playedCardIdsRef.current;
      const newIds = idsNow.filter((id) => !idsBefore.includes(id));
      playedCardIdsRef.current = idsNow;
      // One hit per update even if several arrive at once, so a burst of bot
      // plays doesn't stack into a clatter.
      if (newIds.some((id) => id !== currentPlayerId)) {
        audioManager.playSound("cardPlay");
      }

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

      // One sting per completed trick. A re-emitted or duplicated event for a
      // trick we have already sounded still shows the popup (harmless and
      // idempotent) but stays silent.
      const trickKey = `${currentRoundRef.current}:${data.trickNumber}`;
      const isNewTrick = lastHandWonKeyRef.current !== trickKey;
      if (isNewTrick) lastHandWonKeyRef.current = trickKey;

      // Hold the completed trick on screen briefly so the last card played is
      // visible before the winner popup appears.
      if (winnerTimerRef.current) clearTimeout(winnerTimerRef.current);
      winnerTimerRef.current = setTimeout(() => {
        winnerTimerRef.current = null;
        // Fires with the popup, not with the event 900ms earlier, so the sound
        // lands on the announcement.
        if (isNewTrick) audioManager.playSound("handWon");
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
      // A peek we asked for arrives on the same event as the round-end
      // broadcast. Without this the score button would navigate the player out
      // of the game. The flag is consumed here so only the reply to our own
      // request is diverted; a genuine round-end still advances.
      if (peekPendingRef.current) {
        peekPendingRef.current = false;
        setPeekScoreboard(data.scoreboard);
        return;
      }
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
      // No-ops when sound is off; purely local feedback, nothing is sent.
      audioManager.playSound("cardPlay");
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
              {displayedTricks(player)} / {player.bid ?? 0}
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
    // Keep showing the cards on the table not only during active play, but also
    // once the final trick of a round has completed. When the last card of a
    // round is played the server flips status to ROUND_SCOREBOARD (or GAME_OVER
    // on the final round) before the hand-winner popup; if we stopped rendering
    // here, that last card would never be seen - the trick would just vanish and
    // the winner would appear. Keep the completed trick visible through those
    // wrap-up states so the last play is shown just like every other trick.
    const status = gameState?.status;
    if (status !== "PLAYING" && status !== "ROUND_SCOREBOARD" && status !== "GAME_OVER") {
      return null;
    }

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

        {/* Back (leave) then sound, paired in the top-left. Same pairing as the
            bidding screen, same confirmation as the old LEAVE button. */}
        <CircleIconButton
          glyph="‹"
          glyphStyle={styles.backGlyph}
          style={styles.backButton}
          accessibilityLabel="Leave game"
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
        />

        {/* Sound toggle - immediately right of the back button */}
        <SoundToggleButton style={styles.soundButton} />

        {/* Scores - completes the row. Opens a read-only peek at the running
            scoreboard without leaving the game. */}
        <CircleIconButton
          glyph="☰"
          glyphStyle={styles.scoresGlyph}
          style={styles.scoresButton}
          accessibilityLabel="Show scores"
          onPress={() => {
            peekPendingRef.current = true;
            setPeekOpen(true);
            socketService.getScoreboardState();
          }}
        />

        <ScoreboardModal
          visible={peekOpen}
          scoreboard={peekScoreboard}
          currentPlayerId={currentPlayerId}
          onClose={() => {
            peekPendingRef.current = false;
            setPeekOpen(false);
          }}
        />


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
                  {displayedTricks(arrangedPlayers[2])} / {arrangedPlayers[2].bid ?? 0}
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
          onShown={handleWinnerShown}
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
    backgroundColor: "#1a1030",
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

  // Back and sound sit as a pair in the top-left, back on the outside. The
  // offsets are the 52px circle plus a 12px gap, matching the bidding screen.
  backButton: {
    top: 16,
    left: 16,
  },
  soundButton: {
    top: 16,
    left: 82,
  },
  // Third in the row, same 66px stride as back -> sound.
  scoresButton: {
    top: 16,
    left: 148,
  },
  scoresGlyph: {
    fontSize: 22,
    lineHeight: 26,
  },
  // The chevron sits high and small in its em box next to the note glyph, so
  // nudge it onto the optical centre and size it up to match.
  backGlyph: {
    fontSize: 34,
    lineHeight: 38,
    marginTop: -3,
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
