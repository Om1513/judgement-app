// The question asked when a game is still running without its player.
//
// Shown when the server reports REJOIN_AVAILABLE: the seat is still theirs, but
// the bot has been playing it since their grace period ran out, so bids and cards
// exist that they did not make. Dropping them straight back into that hand would
// be disorienting, so they are asked instead - which is the whole reason this
// component exists rather than a silent navigation.
//
// Rendered as a plain absolutely-positioned View, not a react-native <Modal>, for
// the same reason as RemovePlayerModal: a <Modal> mounts its own native window,
// which forces an orientation re-layout in this landscape-only app. There is
// deliberately no backdrop-tap-to-dismiss either - both answers have
// consequences, so the player has to pick one.

import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import audioManager from "../services/audioManager";
import { useScaledStyles } from "../utils/responsive";

// How each phase reads in the prompt, so the player knows what they would be
// walking back into rather than just "a game".
const PHASE_LABEL = {
  BIDDING: "Bidding is under way",
  PLAYING: "A hand is being played",
  HAND_WINNER: "A hand is being played",
  ROUND_COMPLETE: "The round is being scored",
  ROUND_SCOREBOARD: "The scoreboard is up",
};

export default function RejoinPrompt({ visible, offer, busy, onRejoin, onDiscard }) {
  const styles = useScaledStyles(rawStyles);
  if (!visible) return null;

  const phase = PHASE_LABEL[offer?.status];
  const round =
    offer?.currentRound && offer?.totalRounds
      ? `Round ${offer.currentRound} of ${offer.totalRounds}`
      : null;

  return (
    <View style={styles.overlay}>
      <View style={styles.modalContainer}>
        <LinearGradient
          colors={["rgba(61, 34, 114, 0.95)", "rgba(42, 22, 84, 0.98)"]}
          style={styles.modal}
        >
          <Text style={styles.title}>You Were In A Game</Text>

          <Text style={styles.message}>
            Your game is still in progress.{"\n"}Would you like to rejoin?
          </Text>

          {(round || phase) && (
            <View style={styles.detailPill}>
              {round && <Text style={styles.detailText}>{round}</Text>}
              {phase && <Text style={styles.detailSubtext}>{phase}</Text>}
            </View>
          )}

          <View style={styles.buttonRow}>
            {/* Discard sits first and muted: rejoining is the likely answer, so
                it gets the emphasis and the right-hand (thumb) position. */}
            <TouchableOpacity
              style={styles.button}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Discard game"
              onPress={() => {
                audioManager.playSound("buttonPop");
                onDiscard?.();
              }}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={["#5E3A9E", "#3D2272"]}
                style={[styles.buttonGradient, busy && styles.buttonDisabled]}
              >
                <Text style={styles.discardText}>Discard</Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.button}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Rejoin game"
              onPress={() => {
                audioManager.playSound("buttonPop");
                onRejoin?.();
              }}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={["#FFE55C", "#FFD700", "#F5A623"]}
                style={[styles.buttonGradient, busy && styles.buttonDisabled]}
              >
                <Text style={styles.rejoinText}>
                  {busy ? "Rejoining..." : "Rejoin Game"}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </LinearGradient>
      </View>
    </View>
  );
}

const rawStyles = {
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
  },
  modalContainer: {
    borderRadius: 20,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 15,
    elevation: 20,
    borderWidth: 2,
    borderColor: "#5E3A9E",
  },
  modal: {
    paddingVertical: 22,
    paddingHorizontal: 30,
    alignItems: "center",
    minWidth: 320,
  },
  title: {
    fontSize: 28,
    fontFamily: "Bangers_400Regular",
    color: "#FFD700",
    textShadowColor: "rgba(0, 0, 0, 0.5)",
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 4,
    marginBottom: 10,
    letterSpacing: 1,
  },
  message: {
    fontSize: 18,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    textAlign: "center",
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  // Same pill geometry as the round/trump indicator on the table, so the game's
  // details read as game chrome rather than as part of the question.
  detailPill: {
    backgroundColor: "rgba(0, 0, 0, 0.35)",
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: "center",
    marginBottom: 18,
  },
  detailText: {
    fontSize: 15,
    fontFamily: "Bangers_400Regular",
    color: "#FFD700",
    letterSpacing: 1,
  },
  detailSubtext: {
    fontSize: 12,
    fontFamily: "Bangers_400Regular",
    color: "#EFEAFF",
    letterSpacing: 0.5,
    marginTop: 2,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 15,
  },
  button: {
    borderRadius: 12,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
  buttonGradient: {
    paddingVertical: 12,
    paddingHorizontal: 25,
    borderRadius: 12,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  discardText: {
    fontSize: 18,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    letterSpacing: 0.5,
  },
  rejoinText: {
    fontSize: 18,
    fontFamily: "Bangers_400Regular",
    color: "#2A1654",
    letterSpacing: 0.5,
  },
};
