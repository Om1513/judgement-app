import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";

/**
 * In-screen confirmation overlay for removing a player from the lobby.
 *
 * Rendered as a plain absolutely-positioned View (NOT a react-native <Modal>).
 * A <Modal> mounts its own native window, which on this app forces an
 * orientation re-layout (the landscape screen flickers to portrait and back)
 * and previously crashed the app. A regular overlay lives inside the existing
 * landscape layout, so there is no orientation change and no extra window.
 */
export default function RemovePlayerModal({
  visible,
  playerName,
  onConfirm,
  onCancel,
}) {
  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      {/* Tapping the dimmed backdrop cancels. */}
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={1}
        onPress={onCancel}
      />

      <View style={styles.modalContainer}>
        <LinearGradient
          colors={["rgba(61, 34, 114, 0.95)", "rgba(42, 22, 84, 0.98)"]}
          style={styles.modal}
        >
          {/* Title */}
          <Text style={styles.title}>Remove Player</Text>

          {/* Message */}
          <Text style={styles.message}>
            Remove {playerName} from the lobby?
          </Text>

          {/* Buttons */}
          <View style={styles.buttonRow}>
            {/* Cancel button */}
            <TouchableOpacity
              style={styles.button}
              onPress={onCancel}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={["#5E3A9E", "#3D2272"]}
                style={styles.cancelButtonGradient}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </LinearGradient>
            </TouchableOpacity>

            {/* Confirm button */}
            <TouchableOpacity
              style={styles.button}
              onPress={onConfirm}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={["#FF6B6B", "#CC5555"]}
                style={styles.confirmButtonGradient}
              >
                <Text style={styles.confirmButtonText}>Remove</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </LinearGradient>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
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
    paddingVertical: 25,
    paddingHorizontal: 30,
    alignItems: "center",
    minWidth: 280,
  },
  title: {
    fontSize: 28,
    fontFamily: "Bangers_400Regular",
    color: "#FFD700",
    textShadowColor: "rgba(0, 0, 0, 0.5)",
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 4,
    marginBottom: 15,
    letterSpacing: 1,
  },
  message: {
    fontSize: 18,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    textAlign: "center",
    marginBottom: 25,
    letterSpacing: 0.5,
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
  cancelButtonGradient: {
    paddingVertical: 12,
    paddingHorizontal: 25,
    borderRadius: 12,
  },
  cancelButtonText: {
    fontSize: 18,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    letterSpacing: 0.5,
  },
  confirmButtonGradient: {
    paddingVertical: 12,
    paddingHorizontal: 25,
    borderRadius: 12,
  },
  confirmButtonText: {
    fontSize: 18,
    fontFamily: "Bangers_400Regular",
    color: "#FFF",
    letterSpacing: 0.5,
  },
});
