import React, { useEffect, useRef, useState, useMemo } from "react";
import {
  View,
  Text,
  ImageBackground,
  Animated,
  TouchableOpacity,
  Alert,
  ScrollView,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { useFonts, Inter_400Regular, Inter_700Bold } from "@expo-google-fonts/inter";
import socketService from "../services/socket";
import CircleIconButton, { useCircleButtonMetrics } from "../components/CircleIconButton";
import SoundToggleButton from "../components/SoundToggleButton";
import ScoreboardModal from "../components/ScoreboardModal";
import audioManager from "../services/audioManager";
import { useResponsive, useScaledStyles } from "../utils/responsive";

// The bid row's geometry is pinned rather than derived from its contents - see
// tableBidCell below for why. The badge is comfortably inside the cell, so no
// combination of font metrics can make one push the other around.
const BID_CELL_HEIGHT = 32;
const BID_BADGE_HEIGHT = 28;

// Display trump by its English suit name rather than the local name.
const TRUMP_SUIT_NAMES = {
  spades: "Spades",
  hearts: "Hearts",
  diamonds: "Diamonds",
  clubs: "Clubs",
};

export default function BiddingScreen({ navigation, route }) {
  const {
    gameState: initialGameState,
    currentPlayerId,
    currentPlayerName,
  } = route.params || {};

  const [gameState, setGameState] = useState(initialGameState);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Read-only scoreboard peek, opened from the header button.
  const [peekOpen, setPeekOpen] = useState(false);
  const [peekScoreboard, setPeekScoreboard] = useState(null);

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const modalScale = useRef(new Animated.Value(0.9)).current;

  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_700Bold,
  });

  const r = useResponsive();
  const styles = useScaledStyles(rawStyles);
  const circle = useCircleButtonMetrics();

  // Back / sound / scores, bottom-left. Spacing comes from the circle's real
  // diameter rather than the old fixed 18 / 82 / 146.
  //
  // Plainly scaled, not safe-area offsets: in landscape the cutout inset lands
  // on a side and runs to ~59pt, which walked this cluster inboard until it no
  // longer read as a bottom-left corner group.
  const controlsBottom = r.s(18);
  const controlsLeft = r.s(18);
  const buttonStride = circle.stride(12);

  // The round pill mirrors the cluster in the opposite corner, so it shares the
  // same 18pt bottom offset - the two corners then sit on one line.
  const roundPillOffsets = { bottom: r.s(18), right: r.s(20) };

  // The bidding panel is centred in the band between these edges, so shifting
  // the band down by 6pt moves the title, bid buttons, trump and table with it.
  // top and bottom move by the same amount on purpose: the band keeps its
  // height, so an eight-player table has exactly as much room as before, and
  // the panel still clears "Your Cards" underneath.
  const modalBand = {
    top: r.s(18),
    left: r.s(10),
    right: r.s(10),
    bottom: r.s(74),
  };

  // Get current round state
  const roundState = gameState?.roundState;
  const players = gameState?.players || [];
  const myHand = gameState?.myHand || [];
  const isMyTurn = roundState?.currentBidderId === currentPlayerId;
  const handSize = roundState?.cardsPerPlayer || 1;
  const trump = roundState?.trump;
  const currentRound = roundState?.roundNumber || 1;
  const totalRounds = gameState?.totalRounds || 4;

  // With many players the bidding table gets cramped, so shrink text/padding to fit.
  const isCompactTable = players.length >= 7;

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

    // Only ever the reply to our own peek request here - this screen has no
    // round-end navigation hanging off scoreboard:state.
    const unsubscribeScoreboard = socketService.on("scoreboard:state", (data) => {
      setPeekScoreboard(data.scoreboard);
    });

    return () => {
      unsubscribeUpdate();
      unsubscribeError();
      unsubscribeScoreboard();
    };
  }, [navigation, currentPlayerId, currentPlayerName]);

  // Entrance animations
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 250,
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

    audioManager.playSound("buttonPop");
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
          <Text style={styles.trumpName}>
            {TRUMP_SUIT_NAMES[trump.suit] || trump.name}
          </Text>
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
            <Text style={[styles.tableLabelText, isCompactTable && styles.tableLabelTextCompact]}>Player</Text>
          </View>
          {players.map((player) => (
            <View
              key={player.id}
              style={[
                styles.tableCell,
                styles.tablePlayerCell,
                isCompactTable && styles.tableCellCompact,
                player.id === currentPlayerId && styles.tableCurrentPlayerCell,
              ]}
            >
              <Text
                style={[
                  styles.tablePlayerName,
                  isCompactTable && styles.tablePlayerNameCompact,
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
            <Text style={[styles.tableLabelText, isCompactTable && styles.tableLabelTextCompact]}>Bid</Text>
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
                  isCompactTable && styles.tableCellCompact,
                  player.id === currentPlayerId && styles.tableCurrentPlayerCell,
                ]}
                testID="bid-cell"
              >
                {isCurrentBidder ? (
                  <View style={[styles.bidBadge, styles.biddingIndicator, isCompactTable && styles.bidBadgeCompact]}>
                    <Text style={[styles.biddingDots, isCompactTable && styles.biddingDotsCompact]}>...</Text>
                  </View>
                ) : hasBid ? (
                  <View style={[styles.bidBadge, styles.bidValueContainer, isCompactTable && styles.bidBadgeCompact]}>
                    <Text style={[styles.bidValueText, isCompactTable && styles.bidValueTextCompact]}>{bid}</Text>
                  </View>
                ) : (
                  <Text style={[styles.noBidText, isCompactTable && styles.noBidTextCompact]}>-</Text>
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
      <View style={[styles.myCardsContainer, { bottom: r.s(10) }]}>
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
        {/* Round indicator - bottom right corner */}
        <View
          style={[
            styles.roundIndicator,
            roundPillOffsets,
          ]}
        >
          <Text style={styles.roundIndicatorText}>
            Round {currentRound}/{totalRounds}
          </Text>
        </View>

        {/* Modal Overlay */}
        <Animated.View
          style={[
            styles.modalOverlay,
            modalBand,
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
                /* No "submitting" state: the bid landing in the table below is
                   the confirmation. isSubmitting still disables the buttons so
                   a double tap can't send two bids. */
                renderBidButtons()
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

        {/* Back (leave) then sound, paired in the bottom-left. Same
            confirmation as the old LEAVE button. Rendered after the modal so
            both layer above it. */}
        <CircleIconButton
          glyph="‹"
          glyphStyle={styles.backGlyph}
          style={{ bottom: controlsBottom, left: controlsLeft }}
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
          style={{ bottom: controlsBottom, left: controlsLeft + buttonStride }}
        />

        {/* Scores - completes the row. Opens a read-only peek at the running
            scoreboard without leaving the round. */}
        <CircleIconButton
          glyph="☰"
          glyphStyle={styles.scoresGlyph}
          style={{ bottom: controlsBottom, left: controlsLeft + buttonStride * 2 }}
          accessibilityLabel="Show scores"
          onPress={() => {
            setPeekOpen(true);
            socketService.getScoreboardState();
          }}
        />

        <ScoreboardModal
          visible={peekOpen}
          scoreboard={peekScoreboard}
          currentPlayerId={currentPlayerId}
          onClose={() => setPeekOpen(false)}
        />

        <StatusBar style="light" hidden />
      </ImageBackground>
    </View>
  );
}

// Baseline (iPhone 17 Pro, 874 x 402) values; useScaledStyles maps them onto
// the current viewport. Edge offsets are applied at render time so they can
// clear a device cutout.
const rawStyles = {
  container: {
    flex: 1,
    backgroundColor: "#1a1030",
  },
  background: {
    flex: 1,
    width: "100%",
    height: "100%",
  },

  // Round Indicator
  roundIndicator: {
    position: "absolute",
    backgroundColor: "rgba(42, 22, 84, 0.9)",
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#5E3A9E",
  },
  roundIndicatorText: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: "#FFD700",
    letterSpacing: 1.5,
  },

  scoresGlyph: {
    fontSize: 22,
    lineHeight: 26,
  },
  // The chevron sits high in its em box, so nudge it onto the optical centre
  // and size it up to balance the note glyph on the sound button.
  backGlyph: {
    fontSize: 34,
    lineHeight: 38,
    marginTop: -3,
  },

  // Modal. Its inset edges are supplied at render time from the safe area.
  modalOverlay: {
    position: "absolute",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContainer: {
    width: "100%",
    maxWidth: 960,
    maxHeight: "100%",
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255, 215, 0, 0.4)",
    backgroundColor: "rgba(26, 16, 48, 0.98)",
  },
  modalGradient: {
    paddingVertical: 20,
    paddingHorizontal: 20,
  },

  // Title
  titleContainer: {
    alignItems: "center",
    marginBottom: 6,
  },
  titleText: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    color: "#FFD700",
    textAlign: "center",
    letterSpacing: 1,
  },

  // Bid Buttons
  bidButtonsContainer: {
    flexDirection: "row",
    justifyContent: "center",
    flexWrap: "wrap",
    marginBottom: 4,
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
    fontFamily: "Inter_700Bold",
    color: "#FFF8E7",
    textAlign: "center",
    paddingHorizontal: 5,
  },
  bidButtonTextForbidden: {
    color: "#888",
  },

  // Waiting Message
  waitingMessageContainer: {
    alignItems: "center",
    marginVertical: 16,
  },
  waitingText: {
    fontSize: 22,
    fontFamily: "Inter_400Regular",
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
    fontFamily: "Inter_700Bold",
    color: "#4CAF50",
    textAlign: "center",
  },
  completedSubtext: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
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
    fontFamily: "Inter_700Bold",
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
    fontFamily: "Inter_700Bold",
    color: "#FFD700",
    textAlign: "center",
    paddingHorizontal: 5,
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
  tableCellCompact: {
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  tableLabelCell: {
    flex: 0.6,
    alignItems: "flex-start",
    paddingLeft: 8,
  },
  tableLabelText: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: "#FFF8E7",
    opacity: 0.7,
  },
  tableLabelTextCompact: {
    fontSize: 15,
  },
  tablePlayerCell: {
    borderLeftWidth: 1,
    borderLeftColor: "rgba(255, 215, 0, 0.2)",
  },
  tableCurrentPlayerCell: {
    backgroundColor: "rgba(255, 215, 0, 0.1)",
  },
  tablePlayerName: {
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    color: "#FFF8E7",
    textAlign: "center",
  },
  tablePlayerNameCompact: {
    fontSize: 15,
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
    fontFamily: "Inter_700Bold",
    color: "#2A1654",
  },
  // A FIXED height, not a minimum. The three things this cell can hold - "...",
  // a green bid box, or "-" - are all different natural heights, and the green
  // one is tall enough that its line box tipped past the old 32pt minimum once
  // font metrics and Android's font padding were added. The row then grew the
  // moment the first player bid, and the whole panel grew with it. Pinning the
  // height takes the cell's contents out of the calculation entirely.
  tableBidCell: {
    borderLeftWidth: 1,
    borderLeftColor: "rgba(255, 215, 0, 0.2)",
    height: BID_CELL_HEIGHT,
  },
  // One shared box for the "..." and green-bid badges. Identical height means a
  // player going from "waiting to bid" to "bid placed" swaps the badge in place
  // with no reflow - previously the green box was ~7pt taller than the amber one.
  bidBadge: {
    height: BID_BADGE_HEIGHT,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  biddingIndicator: {
    backgroundColor: "#F5A623",
    paddingHorizontal: 10,
  },
  biddingDots: {
    fontSize: 14,
    lineHeight: 17,
    fontFamily: "Inter_700Bold",
    color: "#2A1654",
    includeFontPadding: false,
  },
  bidValueContainer: {
    backgroundColor: "#4CAF50",
    paddingHorizontal: 12,
  },
  bidBadgeCompact: {
    paddingHorizontal: 6,
  },
  // Explicit lineHeight on all three, and includeFontPadding off: without them
   // the cell's height depends on the platform's font metrics, which is how this
   // row came to be a different size on device than in the design.
  bidValueText: {
    fontSize: 20,
    lineHeight: 24,
    fontFamily: "Inter_700Bold",
    color: "#FFF",
    textAlign: "center",
    paddingHorizontal: 5,
    includeFontPadding: false,
  },
  bidValueTextCompact: {
    fontSize: 18,
    lineHeight: 22,
    paddingHorizontal: 2,
  },
  biddingDotsCompact: {
    fontSize: 16,
    lineHeight: 19,
  },
  noBidText: {
    fontSize: 16,
    lineHeight: 20,
    fontFamily: "Inter_400Regular",
    color: "#666",
    includeFontPadding: false,
  },
  noBidTextCompact: {
    fontSize: 16,
  },

  // My Cards
  myCardsContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  myCardsLabel: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
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
};
