import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  ImageBackground,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Alert,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { useFonts, Bangers_400Regular } from "@expo-google-fonts/bangers";
import { Inter_400Regular, Inter_700Bold } from "@expo-google-fonts/inter";
import socketService from "../services/socket";
import CircleIconButton from "../components/CircleIconButton";
import SoundToggleButton from "../components/SoundToggleButton";
import ScreenHeader, { HEADER_HEIGHT, HEADER_MARGIN_BOTTOM } from "../components/ScreenHeader";
import audioManager from "../services/audioManager";

// The card always spans the screen. Adding players squeezes more columns into
// that fixed width, so the table gets tighter rather than wider: rows shorten
// and the text shrinks with them.
const BASE_PLAYERS = 4;
const BASE_ROW_HEIGHT = 34;
const ROW_HEIGHT_PER_PLAYER = 2; // subtracted per player above BASE_PLAYERS
const MIN_ROW_HEIGHT = 22;

function maxRowHeightFor(playerCount) {
  const shrunk = BASE_ROW_HEIGHT - Math.max(0, playerCount - BASE_PLAYERS) * ROW_HEIGHT_PER_PLAYER;
  return Math.max(MIN_ROW_HEIGHT, shrunk);
}

// Column flex ratios, mirrored from the styles below. Used to work out how wide
// a single player column ends up, so the text can be capped to fit it - with
// eight columns on one screen the limit is horizontal, not vertical.
const FLEX_TRUMP = 2.4;
const FLEX_ROUND = 1.4;
const FLEX_PLAYER = 1.2;

// Card chrome either side of the columns: content padding 4x2, card border 2x2,
// gradient padding 5x2.
const TABLE_SIDE_CHROME = 22;

// Everything above/around the score rows, totalled from the style values below.
// The card sizes itself to its rows, so the space available for rows has to be
// derived from the content area rather than measured off the card itself -
// measuring the card would be circular once it stops filling the screen.
const CONTENT_PADDING = 6; // content paddingTop 4 + paddingBottom 2
const HEADER_BLOCK = HEADER_HEIGHT + HEADER_MARGIN_BOTTOM; // shared top bar
const CARD_CHROME = 10; // border 2x2 + tableGradient paddingTop 4 + paddingBottom 2
const TABLE_HEADER_ROW = 30; // paddingVertical 3x2 + border 2 + text at max size
const ROWS_CHROME = CONTENT_PADDING + HEADER_BLOCK + CARD_CHROME + TABLE_HEADER_ROW;

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

  // Measured height of the whole content area. Rows are sized from what is left
  // of it after the header and card chrome, so the table fits on one screen for
  // any round count (4 up to ~17) without the card having to fill the screen.
  const [contentHeight, setContentHeight] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);

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
        duration: 250,
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
    audioManager.playSound("buttonPop");
    setHasContinued(true);
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

  // Scale the row text to the space actually available. The rows share the area
  // evenly via flex, so each one gets (area / rowCount); sizing the text off
  // that keeps every round visible without scrolling. The +1 accounts for the
  // Total row, which is the same height as a data row. Clamped so long games
  // stay legible and short ones don't blow the text up.
  const rowCount = scoreboard.rows.length + 1;
  const availableForRows = contentHeight > 0 ? Math.max(0, contentHeight - ROWS_CHROME) : 0;
  // Capped, so a short game gets a compact table instead of rows stretched to
  // fill the screen. Long games compress below the cap to stay on one screen.
  const playerCount = scoreboard.players.length;
  const rowHeight = availableForRows > 0
    ? Math.min(maxRowHeightFor(playerCount), availableForRows / rowCount)
    : 0;

  // Two independent limits on the text, whichever is tighter wins. Height is the
  // binding one in a long game; width is the binding one in an eight-player one,
  // where the columns are narrow enough to clip names before the rows run out of
  // room.
  const columnUnits = FLEX_TRUMP + FLEX_ROUND + FLEX_PLAYER * playerCount;
  const playerColumnWidth = contentWidth > 0
    ? ((contentWidth - TABLE_SIDE_CHROME) * FLEX_PLAYER) / columnUnits
    : 0;
  const fontFromHeight = rowHeight > 0 ? Math.floor(rowHeight * 0.5) : 14;
  const fontFromWidth = playerColumnWidth > 0 ? Math.floor(playerColumnWidth * 0.32) : 99;
  const cellFontSize = Math.max(9, Math.min(18, fontFromHeight, fontFromWidth));
  const cellText = { fontSize: cellFontSize, lineHeight: Math.round(cellFontSize * 1.15) };
  // Explicit height replaces flex:1 on the rows, which is what actually tightens
  // the spacing between them.
  const rowSize = rowHeight > 0 ? { height: rowHeight } : null;

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
          onLayout={(e) => {
            setContentHeight(e.nativeEvent.layout.height);
            setContentWidth(e.nativeEvent.layout.width);
          }}
          style={[
            styles.content,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >

          <ScreenHeader
            title="SCOREBOARD"
            left={
              <>
                <CircleIconButton
                  inline
                  glyph="‹"
                  glyphStyle={styles.backGlyph}
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
                <SoundToggleButton inline />
              </>
            }
            right={
              !hasContinued ? (
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
                <View style={styles.readyPill}>
                  <Text style={styles.readyPillText}>READY ✓</Text>
                </View>
              )
            }
          />

          {/* Fills the space left under the header and centres the card in it,
              so a short table sits in the middle rather than hanging off the
              header with all the gap below. */}
          <View style={styles.tableArea}>
          {/* Scoreboard Table Card */}
          <View style={styles.tableContainer}>
            <LinearGradient
              colors={["rgba(61, 34, 114, 0.95)", "rgba(42, 22, 84, 0.98)"]}
              style={styles.tableGradient}
            >
              {/* Header Row */}
              <View style={styles.headerRow}>
                <View style={[styles.cell, styles.trumpCell]}>
                  <Text style={[styles.headerText, cellText]} numberOfLines={1}>Trump</Text>
                </View>
                <View style={[styles.cell, styles.roundCell]}>
                  <Text style={[styles.headerText, cellText]} numberOfLines={1}>Round</Text>
                </View>
                {scoreboard.players.map((player) => (
                  <View key={player.id} style={[styles.cell, styles.playerCell]}>
                    <Text
                      style={[
                        styles.headerText,
                        cellText,
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
                        rowSize,
                        index % 2 === 1 && styles.alternateRow,
                        isCurrentRound && styles.currentRoundRow,
                      ]}
                    >
                      {/* Trump */}
                      <View style={[styles.cell, styles.trumpCell]}>
                        <Text style={[styles.trumpSymbol, cellText, { color: trumpInfo.color }]}>
                          {trumpInfo.symbol}
                        </Text>
                        <Text style={[styles.trumpName, cellText]} numberOfLines={1}>
                          {row.trump.name || row.trump.suit}
                        </Text>
                      </View>

                      {/* Round number */}
                      <View style={[styles.cell, styles.roundCell]}>
                        <Text style={[styles.roundNumber, cellText]}>{row.roundNumber}</Text>
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
                                  cellText,
                                  madeBid ? styles.scorePositive : styles.scoreZero,
                                ]}
                              >
                                {score.score}
                              </Text>
                            ) : (
                              <Text style={[styles.scoreEmpty, cellText]}>–</Text>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  );
                })}
                {/* Total - an equal-height row after the rounds, below a divider.
                    Uses the same trump + round cell structure as the data rows so
                    the player columns line up exactly with the scores above. */}
                <View style={[styles.totalRow, rowSize]}>
                  <View style={[styles.cell, styles.trumpCell]}>
                    <Text style={[styles.totalLabel, cellText]} numberOfLines={1}>Total</Text>
                  </View>
                  <View style={[styles.cell, styles.roundCell]} />
                  {scoreboard.players.map((player) => {
                    const isLeading = player.id === leadingPlayer?.id;

                    return (
                      <View key={player.id} style={[styles.cell, styles.playerCell]}>
                        <Text
                          style={[
                            styles.totalScoreText,
                            cellText,
                            isLeading && styles.leadingScore,
                          ]}
                        >
                          {player.totalScore}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            </LinearGradient>
          </View>
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
    backgroundColor: "#1a1030",
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
    paddingHorizontal: 4,
    paddingTop: 4,
    paddingBottom: 2,
  },
  // Kept deliberately compact: the app is landscape-locked, so every pixel here
  // comes straight out of the table's height.
  // Tall enough to hold the 52px circles; the table below flexes to whatever is
  // left, so the extra height costs a little row size rather than overflowing.
  // Holds the whole header: back/sound on the left, title centred, Continue on
  // the right. Tall enough for the 52px circles and the Continue pill.
  // Right-anchored and vertically centred, mirroring the circles on the left.
  // Same 52px circle + 12px gap as the other screens, centred in the row.
  // Inset from the content edge so the row doesn't sit hard against the screen.
  // The 64px stride between them is the 52px circle plus a 12px gap.
  // The chevron sits high and small in its em box next to the note glyph, so
  // nudge it onto the optical centre and size it up to match.
  backGlyph: {
    fontSize: 34,
    lineHeight: 38,
    marginTop: -3,
  },

  // Table card. marginTop drops it clear of the header row rather than sitting
  // tight under it.
  // Takes the leftover height under the header and centres the card vertically
  // in it. Horizontally the card stretches to fill the screen.
  tableArea: {
    flex: 1,
    justifyContent: "center",
  },
  // Deliberately not flex:1 - the card hugs its rows so a short game doesn't
  // leave a tall empty panel below the Total row.
  tableContainer: {
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "#5E3A9E",
  },
  tableGradient: {
    borderRadius: 14,
    paddingHorizontal: 5,
    paddingTop: 4,
    paddingBottom: 2,
  },

  // Shared cell + column widths (flex based so it fills the width)
  cell: {
    paddingHorizontal: 2,
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
    paddingVertical: 3,
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
    paddingTop: 2,
    paddingBottom: 0,
  },
  dataRow: {
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
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "#FFD700",
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
  // The number is centered in its cell so it lines up exactly with the
  // per-round score columns above it. The leading total is highlighted gold.
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

  // Continue button. Fixed height on purpose: the table above is flex:1, so any
  // change in this row's height would resize the table. Pinning it keeps the
  // board identical before and after the player commits to the round.
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
    paddingHorizontal: 26,
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
  // Mirrors continueButtonGradient's padding so the swap is pixel-neutral.
  readyPill: {
    paddingVertical: 9,
    paddingHorizontal: 26,
    borderRadius: 12,
    backgroundColor: "rgba(42, 22, 84, 0.8)",
    borderWidth: 1,
    borderColor: "#5E3A9E",
  },
  readyPillText: {
    fontSize: 19,
    fontFamily: "Bangers_400Regular",
    color: "#4CAF50",
    letterSpacing: 3,
    textAlign: "center",
  },
});
