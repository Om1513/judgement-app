import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  ImageBackground,
  StyleSheet,
  Animated,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { useFonts, Bangers_400Regular } from "@expo-google-fonts/bangers";
import { Inter_400Regular, Inter_700Bold } from "@expo-google-fonts/inter";
import socketService from "../services/socket";
import CircleIconButton from "../components/CircleIconButton";
import SoundToggleButton from "../components/SoundToggleButton";
import ScreenHeader, { useHeaderMetrics } from "../components/ScreenHeader";
import { useResponsive, useScaledStyles } from "../utils/responsive";

// Layout is a mirror of ScoreBoardScreen - same constants, same sizing rules,
// same styles. The only intended differences are the title, the controls being
// on the right instead of the left, the winner's crown, and flat round scores.
// Keep the two in step if either is retuned.
const BASE_PLAYERS = 4;
const BASE_ROW_HEIGHT = 34;
const ROW_HEIGHT_PER_PLAYER = 2; // subtracted per player above BASE_PLAYERS
const MIN_ROW_HEIGHT = 22;

function maxRowHeightFor(playerCount) {
  const shrunk = BASE_ROW_HEIGHT - Math.max(0, playerCount - BASE_PLAYERS) * ROW_HEIGHT_PER_PLAYER;
  return Math.max(MIN_ROW_HEIGHT, shrunk);
}

// Column flex ratios, mirrored from the styles below.
const FLEX_TRUMP = 2.4;
const FLEX_ROUND = 1.4;
const FLEX_PLAYER = 1.2;

// Card chrome either side of the columns: content padding 4x2, border 2x2,
// gradient padding 5x2.
const TABLE_SIDE_CHROME = 22;

// Everything above/around the score rows, in BASELINE points. The measured
// content box is in real pixels, so these are put through the scale before
// being subtracted from it.
const CONTENT_PADDING = 6; // content paddingTop 4 + paddingBottom 2
const CARD_CHROME = 10; // border 2x2 + tableGradient paddingTop 4 + paddingBottom 2
const TABLE_HEADER_ROW = 30; // paddingVertical 3x2 + border 2 + text at max size

// Trump suit symbols and colors (tuned for the dark card background)
const TRUMP_DISPLAY = {
  spades: { symbol: "♠", color: "#FFF8E7" },
  hearts: { symbol: "♥", color: "#FF5D6C" },
  diamonds: { symbol: "♦", color: "#FF5D6C" },
  clubs: { symbol: "♣", color: "#FFF8E7" },
};

/**
 * Read-only final scoreboard for a completed game. Shows every round's scores
 * plus totals, with the winning player marked by a crown.
 * Winner(s) come from the backend (authoritative) - never recomputed here.
 */
export default function FinalScoreboardScreen({ navigation, route }) {
  const styles = useScaledStyles(rawStyles);
  const r = useResponsive();
  // The content box's own inset, widened where a display cutout would
  // otherwise sit under it. A no-op on a device with no cutout.
  const contentInsets = {
    paddingLeft: r.safeLeft(4),
    paddingRight: r.safeRight(4),
    paddingTop: r.safeTop(4),
  };
  const header = useHeaderMetrics();
  const {
    currentPlayerId = "",
    winnerIds: initialWinnerIds = [],
  } = route.params || {};

  const [scoreboard, setScoreboard] = useState(null);
  const [winnerIds, setWinnerIds] = useState(initialWinnerIds);

  // Measured content area. Rows are sized from what is left of it after the
  // header and card chrome, so the table fits on one screen for any round count.
  const [contentHeight, setContentHeight] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  const [fontsLoaded] = useFonts({
    Bangers_400Regular,
    Inter_400Regular,
    Inter_700Bold,
  });

  useEffect(() => {
    socketService.getFinalScoreboard();

    const unsubscribe = socketService.on("game:final-scoreboard", (data) => {
      setScoreboard(data.scoreboard);
      if (Array.isArray(data.winnerIds)) {
        setWinnerIds(data.winnerIds);
      }
    });

    return () => unsubscribe();
  }, []);

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

  const isWinner = (playerId) => winnerIds.includes(playerId);

  // Identical sizing to ScoreBoardScreen. The +1 accounts for the Total row,
  // which is the same height as a data row.
  const rowCount = scoreboard.rows.length + 1;
  const rowsChrome =
    r.s(CONTENT_PADDING + CARD_CHROME + TABLE_HEADER_ROW) + header.block;
  const availableForRows = contentHeight > 0 ? Math.max(0, contentHeight - rowsChrome) : 0;
  const playerCount = scoreboard.players.length;
  const rowHeight = availableForRows > 0
    ? Math.min(r.s(maxRowHeightFor(playerCount)), availableForRows / rowCount)
    : 0;

  // Whichever limit is tighter wins: height in a long game, column width in an
  // eight-player one.
  const columnUnits = FLEX_TRUMP + FLEX_ROUND + FLEX_PLAYER * playerCount;
  const playerColumnWidth = contentWidth > 0
    ? ((contentWidth - r.s(TABLE_SIDE_CHROME)) * FLEX_PLAYER) / columnUnits
    : 0;
  const fontFromHeight = rowHeight > 0 ? Math.floor(rowHeight * 0.5) : 14;
  const fontFromWidth = playerColumnWidth > 0 ? Math.floor(playerColumnWidth * 0.32) : 99;
  // The floor and ceiling follow the font curve, so the table stays readable
  // on a small phone without ballooning on a tablet.
  const cellFontSize = Math.max(
    r.f(9),
    Math.min(r.f(18), fontFromHeight, fontFromWidth)
  );
  const cellText = { fontSize: cellFontSize, lineHeight: Math.round(cellFontSize * 1.15) };
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
            contentInsets,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >

          <ScreenHeader
            title="FINAL RESULTS"
            right={
              <>
                <SoundToggleButton inline />
                <CircleIconButton
                  inline
                  glyph="›"
                  glyphStyle={styles.backGlyph}
                  accessibilityLabel="Return to home"
                  onPress={() => navigation.navigate("Home")}
                />
              </>
            }
          />

          {/* Fills the space left under the header and centres the card in it. */}
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
                    <View style={styles.headerNameWrap}>
                      {isWinner(player.id) && <Text style={styles.crownHeader}>👑</Text>}
                      <Text
                        style={[
                          styles.headerText,
                          cellText,
                          styles.playerHeaderText,
                          player.id === currentPlayerId && styles.currentPlayerText,
                          isWinner(player.id) && styles.winnerHeaderText,
                        ]}
                        numberOfLines={1}
                      >
                        {player.name}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>

              {/* Score Rows */}
              <View style={styles.rowsContainer}>
                {scoreboard.rows.map((row, index) => {
                  const trumpInfo = TRUMP_DISPLAY[row.trump.suit] || { symbol: "?", color: "#FFF8E7" };

                  return (
                    <View
                      key={row.roundNumber}
                      style={[
                        styles.dataRow,
                        rowSize,
                        index % 2 === 1 && styles.alternateRow,
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

                      {/* Player scores - flat, no per-round highlighting. The
                          crown and the total carry the result here. */}
                      {row.scores.map((score) => {
                        const hasScore = score.score !== null;

                        return (
                          <View key={score.playerId} style={[styles.cell, styles.playerCell]}>
                            {hasScore ? (
                              <Text style={[styles.scoreText, cellText, styles.scoreNeutral]}>
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

                {/* Total - an equal-height row after the rounds, below a divider. */}
                <View style={[styles.totalRow, rowSize]}>
                  <View style={[styles.cell, styles.trumpCell]}>
                    <Text style={[styles.totalLabel, cellText]} numberOfLines={1}>Total</Text>
                  </View>
                  <View style={[styles.cell, styles.roundCell]} />
                  {scoreboard.players.map((player) => (
                    <View key={player.id} style={[styles.cell, styles.playerCell]}>
                      <Text
                        style={[
                          styles.totalScoreText,
                          cellText,
                          isWinner(player.id) && styles.leadingScore,
                        ]}
                      >
                        {player.totalScore}
                      </Text>
                    </View>
                  ))}
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
  overlayGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  content: {
    flex: 1,
    paddingBottom: 2,
  },
  // Mirror of the round scoreboard's left-hand pair: exit outermost, sound
  // inboard of it, same 64px stride.
  // The chevron sits high and small in its em box next to the note glyph, so
  // nudge it onto the optical centre and size it up to match.
  backGlyph: {
    fontSize: 34,
    lineHeight: 38,
    marginTop: -3,
  },

  tableArea: {
    flex: 1,
    justifyContent: "center",
  },
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
  headerNameWrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  crownHeader: {
    fontSize: 12,
    marginRight: 3,
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
  winnerHeaderText: {
    color: "#FFD700",
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
  // One colour for every round score - the crown and total mark the winner.
  scoreNeutral: {
    color: "#FFF8E7",
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
};
