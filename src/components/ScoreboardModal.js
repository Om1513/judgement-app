// Read-only scoreboard peek, shown over the game.
//
// Deliberately renders its own compact table rather than reusing the one in
// ScoreBoardScreen: that table is tuned to fill a whole screen, and this needs
// to sit inside a modal without dragging that screen's sizing rules along.
//
// The parent owns fetching - it passes whatever scoreboard payload it already
// has, so this component never touches the socket.

import React from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import audioManager from "../services/audioManager";
import { useScaledStyles } from "../utils/responsive";

const TRUMP_DISPLAY = {
  spades: { symbol: "♠", color: "#FFF8E7" },
  hearts: { symbol: "♥", color: "#FF5D6C" },
  diamonds: { symbol: "♦", color: "#FF5D6C" },
  clubs: { symbol: "♣", color: "#FFF8E7" },
};

export default function ScoreboardModal({ visible, onClose, scoreboard, currentPlayerId = "" }) {
  const styles = useScaledStyles(rawStyles);
  const players = scoreboard?.players || [];
  const rows = scoreboard?.rows || [];

  const close = () => {
    audioManager.playSound("buttonPop");
    onClose?.();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={close}
      supportedOrientations={["landscape", "landscape-left", "landscape-right"]}
    >
      {/* Scrim closes on tap; the panel swallows its own presses. */}
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={styles.panelPress} onPress={() => {}}>
          <LinearGradient
            colors={["rgba(61, 34, 114, 0.98)", "rgba(26, 16, 48, 0.99)"]}
            style={styles.panel}
          >
            <View style={styles.titleRow}>
              <Text style={styles.title}>SCOREBOARD</Text>
              <Pressable
                onPress={close}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityRole="button"
                accessibilityLabel="Close scoreboard"
                style={styles.closeButton}
              >
                <Text style={styles.closeGlyph}>✕</Text>
              </Pressable>
            </View>

            {!scoreboard ? (
              <Text style={styles.loading}>Loading scores…</Text>
            ) : (
              <>
                {/* Header */}
                <View style={styles.headerRow}>
                  <View style={[styles.cell, styles.trumpCell]}>
                    <Text style={styles.headerText} numberOfLines={1}>Trump</Text>
                  </View>
                  <View style={[styles.cell, styles.roundCell]}>
                    <Text style={styles.headerText} numberOfLines={1}>Rd</Text>
                  </View>
                  {players.map((player) => (
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

                {/* Scrolls rather than shrinking to fit - a peek can be taller
                    than the modal without needing the screen's sizing maths. */}
                <ScrollView style={styles.rowsScroll} showsVerticalScrollIndicator={false}>
                  {rows.map((row, index) => {
                    const trumpInfo = TRUMP_DISPLAY[row.trump.suit] || { symbol: "?", color: "#FFF8E7" };
                    return (
                      <View
                        key={row.roundNumber}
                        style={[styles.dataRow, index % 2 === 1 && styles.alternateRow]}
                      >
                        <View style={[styles.cell, styles.trumpCell]}>
                          <Text style={[styles.trumpSymbol, { color: trumpInfo.color }]}>
                            {trumpInfo.symbol}
                          </Text>
                          <Text style={styles.trumpName} numberOfLines={1}>
                            {row.trump.name || row.trump.suit}
                          </Text>
                        </View>
                        <View style={[styles.cell, styles.roundCell]}>
                          <Text style={styles.bodyText}>{row.roundNumber}</Text>
                        </View>
                        {row.scores.map((score) => (
                          <View key={score.playerId} style={[styles.cell, styles.playerCell]}>
                            <Text style={styles.bodyText}>
                              {score.score !== null ? score.score : "–"}
                            </Text>
                          </View>
                        ))}
                      </View>
                    );
                  })}
                </ScrollView>

                {/* Total */}
                <View style={styles.totalRow}>
                  <View style={[styles.cell, styles.trumpCell]}>
                    <Text style={styles.totalLabel} numberOfLines={1}>Total</Text>
                  </View>
                  <View style={[styles.cell, styles.roundCell]} />
                  {players.map((player) => (
                    <View key={player.id} style={[styles.cell, styles.playerCell]}>
                      <Text style={styles.totalScore}>{player.totalScore}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}
          </LinearGradient>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const rawStyles = {
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(10, 6, 18, 0.8)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  panelPress: {
    width: "100%",
    maxWidth: 900,
    maxHeight: "100%",
  },
  panel: {
    borderRadius: 18,
    borderWidth: 2,
    borderColor: "#FFD700",
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
    shadowColor: "#FFD700",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 18,
    elevation: 16,
  },

  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  title: {
    fontSize: 22,
    fontFamily: "Bangers_400Regular",
    color: "#FFD700",
    letterSpacing: 3,
    textShadowColor: "rgba(255, 165, 0, 0.5)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 14,
  },
  closeButton: {
    position: "absolute",
    right: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(42, 22, 84, 0.9)",
    borderWidth: 1.5,
    borderColor: "#5E3A9E",
  },
  closeGlyph: {
    fontSize: 16,
    lineHeight: 19,
    color: "#FFF8E7",
    fontFamily: "Inter_700Bold",
  },

  loading: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: "#C9BEDC",
    textAlign: "center",
    paddingVertical: 24,
  },

  cell: {
    paddingHorizontal: 2,
    justifyContent: "center",
    alignItems: "center",
  },
  trumpCell: {
    flex: 2.2,
    flexDirection: "row",
    justifyContent: "flex-start",
  },
  roundCell: {
    flex: 1,
  },
  playerCell: {
    flex: 1.2,
  },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    borderBottomWidth: 2,
    borderBottomColor: "#FFD700",
  },
  headerText: {
    fontSize: 14,
    lineHeight: 17,
    fontFamily: "Inter_700Bold",
    color: "#FFF8E7",
    textAlign: "center",
    includeFontPadding: false,
  },
  playerHeaderText: {
    color: "#FFD700",
  },
  currentPlayerText: {
    color: "#FF8C00",
  },

  rowsScroll: {
    flexGrow: 0,
  },
  dataRow: {
    flexDirection: "row",
    alignItems: "center",
    height: 26,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(94, 58, 158, 0.4)",
  },
  alternateRow: {
    backgroundColor: "rgba(42, 22, 84, 0.4)",
  },
  bodyText: {
    fontSize: 14,
    lineHeight: 17,
    fontFamily: "Inter_400Regular",
    color: "#FFF8E7",
    textAlign: "center",
    includeFontPadding: false,
  },
  trumpSymbol: {
    fontSize: 14,
    lineHeight: 17,
    marginRight: 5,
    includeFontPadding: false,
  },
  trumpName: {
    fontSize: 14,
    lineHeight: 17,
    fontFamily: "Inter_400Regular",
    color: "#FFF8E7",
    includeFontPadding: false,
  },

  totalRow: {
    flexDirection: "row",
    alignItems: "center",
    height: 28,
    borderTopWidth: 1,
    borderTopColor: "#FFD700",
  },
  totalLabel: {
    fontSize: 14,
    lineHeight: 17,
    fontFamily: "Inter_700Bold",
    color: "#FFD700",
    letterSpacing: 1,
    includeFontPadding: false,
  },
  totalScore: {
    fontSize: 15,
    lineHeight: 18,
    fontFamily: "Inter_700Bold",
    color: "#FFF8E7",
    textAlign: "center",
    includeFontPadding: false,
  },
};
