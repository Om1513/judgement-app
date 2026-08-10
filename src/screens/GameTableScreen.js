import React, { useEffect, useState, useRef, useMemo, useCallback } from "react";
import {
  View,
  Text,
  ImageBackground,
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
import CircleIconButton, { useCircleButtonMetrics } from "../components/CircleIconButton";
import SoundToggleButton from "../components/SoundToggleButton";
import ScoreboardModal from "../components/ScoreboardModal";
import audioManager from "../services/audioManager";
import PlayedCard from "../components/PlayedCard";
import { arrangeSeats } from "../utils/seating";
import { getPlayableCardIndexes } from "../utils/cardRules";
import { useResponsive, useScaledStyles } from "../utils/responsive";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  SEAT_HEIGHT,
  SEAT_WIDTH,
  TABLE_MARGIN_BOTTOM,
  TABLE_MARGIN_SIDE,
  TABLE_MARGIN_TOP,
  getCardZone,
  getHandCardLayout,
  getSeatPosition,
} from "../utils/tableLayout";

// Suit symbols
const SUIT_SYMBOLS = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};

// Baseline card in the player's own hand. Slightly larger than a played card,
// as in the original design.
const HAND_CARD_WIDTH = 55;
const HAND_CARD_HEIGHT = 80;

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

  // ---------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------
  const r = useResponsive();
  const styles = useScaledStyles(rawStyles);
  const circle = useCircleButtonMetrics();

  // The three top-left circles are laid out from the real button diameter plus
  // a gap, rather than the old fixed 16 / 82 / 148, which only lined up while
  // the circle happened to be 52pt across.
  const buttonStride = circle.stride(14);
  const controlsTop = r.safeTop(16);
  const controlsLeft = r.safeLeft(16);

  // The table's margins: enough room above for the header row and the
  // round/trump indicator, and below for the player's hand.
  const tableMargins = useMemo(
    () => ({
      top: r.safeTop(TABLE_MARGIN_TOP),
      bottom: r.safeBottom(TABLE_MARGIN_BOTTOM),
      left: r.safeLeft(TABLE_MARGIN_SIDE),
      right: r.safeRight(TABLE_MARGIN_SIDE),
    }),
    [r]
  );

  // The table rect every seat and card is positioned inside. Derived from the
  // margins (which is exact - the table is a flexed box filling what is left of
  // the screen) and then corrected by the real measurement, so the first frame
  // is already right instead of collapsing everything onto 0,0.
  const [measuredTable, setMeasuredTable] = useState(null);
  const tableRect = useMemo(() => {
    if (measuredTable && measuredTable.width > 0) return measuredTable;
    return {
      width: Math.max(0, r.width - tableMargins.left - tableMargins.right),
      height: Math.max(0, r.height - tableMargins.top - tableMargins.bottom),
    };
  }, [measuredTable, r.width, r.height, tableMargins]);

  const onTableLayout = useCallback((event) => {
    const { width, height } = event.nativeEvent.layout;
    setMeasuredTable((prev) =>
      prev && prev.width === width && prev.height === height ? prev : { width, height }
    );
  }, []);

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

  // How the hand fans out. Cards tighten their overlap rather than shrinking
  // when the screen is narrow, so a rank is always readable and always tappable.
  const handLayout = useMemo(
    () =>
      getHandCardLayout({
        availableWidth: Math.max(
          0,
          r.width - r.safeLeft(0) - r.safeRight(0) - r.s(40)
        ),
        cardCount: myHand.length,
        cardWidth: r.s(HAND_CARD_WIDTH),
      }),
    [r, myHand.length]
  );

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

  // Where a seat sits. Table seats are placed from normalized coordinates
  // inside the measured table rect (see utils/tableLayout); the two bottom
  // corner seats hang off the screen corners instead, clear of any cutout.
  const seatPlacement = useCallback(
    (seatIndex) => {
      if (seatIndex === 4) {
        return {
          position: "absolute",
          width: r.s(SEAT_WIDTH),
          right: r.safeRight(TABLE_MARGIN_SIDE),
          bottom: r.safeBottom(24),
        };
      }
      const { left, top, width } = getSeatPosition(
        seatIndex,
        players.length,
        tableRect,
        r.scale
      );
      return { position: "absolute", left, top, width };
    },
    [players.length, tableRect, r]
  );

  const renderPlayerSeat = (player, position) => {
    if (!player) return <View key={position} style={styles.emptySeat} />;

    const isCurrentTurn = player.id === gameState?.currentTurnPlayerId;
    const isMe = player.id === currentPlayerId;

    return (
      <View key={player.id} style={[styles.playerSeat, seatPlacement(position)]}>
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
      ? getCardZone(winnerSeat.seatIndex, count, tableRect, r.scale).point
      : null;

    return seated.map((player) => {
      const zone = getCardZone(player.seatIndex, count, tableRect, r.scale);
      const play = cardsPlayed.find((c) => c.playerId === player.id);
      const isTurn = player.id === gameState?.currentTurnPlayerId;

      if (!play) {
        return (
          <View
            key={`slot-${player.id}`}
            pointerEvents="none"
            style={[
              styles.cardSlot,
              {
                left: zone.left,
                top: zone.top,
                width: zone.width,
                height: zone.height,
              },
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
      <View style={[styles.myHandContainer, { bottom: r.safeBottom(10) }]}>
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
                  {
                    width: handLayout.cardWidth,
                    height: r.s(HAND_CARD_HEIGHT),
                    marginHorizontal: handLayout.margin,
                  },
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
        <View
          style={[
            styles.roundIndicator,
            { top: controlsTop, right: r.safeRight(16) },
          ]}
        >
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
          style={{ top: controlsTop, left: controlsLeft }}
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
        <SoundToggleButton
          style={{ top: controlsTop, left: controlsLeft + buttonStride }}
        />

        {/* Scores - completes the row. Opens a read-only peek at the running
            scoreboard without leaving the game. */}
        <CircleIconButton
          glyph="☰"
          glyphStyle={styles.scoresGlyph}
          style={{ top: controlsTop, left: controlsLeft + buttonStride * 2 }}
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


        {/* Player seats. Everything inside here is positioned from the table
            rect, so the whole arrangement follows the table's real size. */}
        <View
          onLayout={onTableLayout}
          style={[
            styles.tableArea,
            {
              marginTop: tableMargins.top,
              marginBottom: tableMargins.bottom,
              marginLeft: tableMargins.left,
              marginRight: tableMargins.right,
            },
          ]}
        >
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
            { bottom: r.safeBottom(100) },
            players.length >= 3 && styles.myInfoLeft,
            players.length >= 3 && {
              left: r.safeLeft(TABLE_MARGIN_SIDE),
              bottom: r.safeBottom(24),
              width: r.s(SEAT_WIDTH),
            },
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

// Baseline (iPhone 17 Pro, 874 x 402) values. useScaledStyles maps the whole
// sheet onto the current viewport; anything genuinely position-dependent is
// computed above from the table rect and the safe-area insets instead of
// living here.
const rawStyles = {
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

  // Table area. The margins are supplied at render time so they can take the
  // device's cutout into account.
  tableArea: {
    flex: 1,
    position: "relative",
  },

  // Player seats. Position comes from utils/tableLayout; only the look is here.
  playerSeat: {
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
  emptySeat: {
    width: SEAT_WIDTH,
    height: SEAT_HEIGHT,
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
    // Capped so a long name cannot widen the seat box and shove the seat next
    // to it out of position; numberOfLines={1} clips it with an ellipsis.
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

  // Played-card placeholder slot (shown until a player plays this trick)
  cardSlot: {
    position: "absolute",
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
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

  // My hand
  myHandContainer: {
    position: "absolute",
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

  // My info
  myInfoContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  // For 3+ players: put our own info in the bottom-left corner so it clears the
  // centered card hand. The offsets themselves are applied at render time, from
  // the safe-area inset.
  myInfoLeft: {
    right: undefined,
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
};
