import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import LobbySettingsForm from "./LobbySettingsForm";
import audioManager from "../services/audioManager";
import { changedSettings } from "../utils/lobbySettings";
import { useScaledStyles } from "../utils/responsive";

/**
 * The host's Game Settings panel in the lobby.
 *
 * An in-screen overlay rather than a native <Modal>, for the same reason as
 * RemovePlayerModal: a Modal opens its own native window, which flickers the
 * landscape screen through portrait.
 *
 * It edits a draft of `settings`, taken afresh each time it opens. Save hands
 * the parent only what changed; the parent sends it and closes the panel when
 * the lobby comes back with the new settings, or passes the server's `error`
 * back so the host can see why nothing changed.
 */
export default function LobbySettingsPanel({
  visible,
  settings,
  minPlayers,
  saving,
  error,
  onSave,
  onCancel,
}) {
  const styles = useScaledStyles(rawStyles);
  const [draft, setDraft] = useState(settings);

  // A fresh draft every time it opens, from whatever the lobby has now.
  useEffect(() => {
    if (visible) setDraft(settings);
    // Only on opening: a lobby update while it is open must not wipe the edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible) return null;

  const changes = changedSettings(settings, draft);
  const hasChanges = Object.keys(changes).length > 0;

  return (
    <View style={styles.overlay}>
      {/* Tapping the dimmed backdrop cancels, unless a save is in flight. */}
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={1}
        onPress={saving ? undefined : onCancel}
        accessibilityLabel="Close game settings"
      />

      <View style={styles.panelContainer}>
        <LinearGradient
          colors={["rgba(61, 34, 114, 0.97)", "rgba(42, 22, 84, 0.99)"]}
          style={styles.panel}
        >
          <Text style={styles.title}>Game Settings</Text>

          <View
            pointerEvents={saving ? "none" : "auto"}
            style={[styles.form, saving && styles.dimmed]}
          >
            <LobbySettingsForm value={draft} onChange={setDraft} minPlayers={minPlayers} />
          </View>

          {/* Fixed height, so a message appearing does not move the buttons. */}
          <View style={styles.messageSlot}>
            {!!error && (
              <Text style={styles.error} numberOfLines={2}>
                {error}
              </Text>
            )}
          </View>

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={styles.button}
              disabled={saving}
              onPress={() => {
                audioManager.playSound("buttonPop");
                onCancel?.();
              }}
              activeOpacity={0.8}
              accessibilityRole="button"
            >
              <LinearGradient colors={["#5E3A9E", "#3D2272"]} style={styles.buttonGradient}>
                <Text style={styles.cancelText}>Cancel</Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, !hasChanges && styles.buttonDisabled]}
              disabled={saving || !hasChanges}
              onPress={() => {
                audioManager.playSound("buttonPop");
                onSave?.(changes, draft);
              }}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityState={{ disabled: saving || !hasChanges }}
            >
              <LinearGradient colors={["#FFD700", "#F5A623"]} style={styles.buttonGradient}>
                {saving ? (
                  <ActivityIndicator color="#2A1654" />
                ) : (
                  <Text style={styles.saveText}>Save</Text>
                )}
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
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
  },
  panelContainer: {
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
  panel: {
    paddingTop: 12,
    paddingBottom: 14,
    paddingHorizontal: 18,
    alignItems: "center",
  },
  title: {
    fontSize: 24,
    fontFamily: "Bangers_400Regular",
    color: "#FFD700",
    textShadowColor: "rgba(0, 0, 0, 0.5)",
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 4,
    marginBottom: 2,
    letterSpacing: 1,
  },
  // The setting cards flex to fill their row, so the form needs a width of its
  // own. Scaled with the rest of the sheet, so it still fits a small phone.
  form: {
    width: 560,
  },
  dimmed: {
    opacity: 0.6,
  },
  messageSlot: {
    height: 20,
    justifyContent: "center",
    maxWidth: 420,
  },
  error: {
    fontSize: 13,
    fontFamily: "Bangers_400Regular",
    color: "#FF6B6B",
    textAlign: "center",
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
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonGradient: {
    minWidth: 110,
    height: 40,
    paddingHorizontal: 25,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: {
    fontSize: 18,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    letterSpacing: 0.5,
  },
  saveText: {
    fontSize: 18,
    fontFamily: "Bangers_400Regular",
    color: "#2A1654",
    letterSpacing: 0.5,
  },
};
