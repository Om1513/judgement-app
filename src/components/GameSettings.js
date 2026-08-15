// Gear button + settings panel shown during a game.
//
// Self-contained: drop <GameSettings /> into any in-game screen and pass a
// `style` to place it. It reads and writes the shared audioManager directly, so
// screens carry no sound state of their own and every copy stays in sync.

import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Pressable,
  Animated,
  Easing,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import audioManager from "../services/audioManager";
import useSoundEnabled from "../hooks/useSoundEnabled";
import { touchSlop, useResponsive, useScaledStyles } from "../utils/responsive";

const SOUND_OPTIONS = ["ON", "OFF"];

export default function GameSettings({ style }) {
  const styles = useScaledStyles(rawStyles);
  const { touch } = useResponsive();
  // Floored at the platform minimum: the gear may look smaller on a small
  // phone, but it must not get harder to hit.
  const gearSize = touch(44);
  const [open, setOpen] = useState(false);
  const soundEnabled = useSoundEnabled();

  const panelScale = useRef(new Animated.Value(0.85)).current;
  const panelOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!open) return;
    panelScale.setValue(0.85);
    panelOpacity.setValue(0);
    Animated.parallel([
      Animated.timing(panelOpacity, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.spring(panelScale, {
        toValue: 1,
        friction: 7,
        tension: 80,
        useNativeDriver: true,
      }),
    ]).start();
  }, [open]);

  // Animate out first, then unmount, so the panel doesn't just blink away.
  const close = () => {
    Animated.parallel([
      Animated.timing(panelOpacity, {
        toValue: 0,
        duration: 150,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(panelScale, {
        toValue: 0.9,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) setOpen(false);
    });
  };

  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        activeOpacity={0.8}
        style={[styles.gearButton, { width: gearSize, height: gearSize }, style]}
        // Widens the tap area without growing the visual button.
        hitSlop={touchSlop(gearSize)}
        accessibilityRole="button"
        accessibilityLabel="Settings"
      >
        <View style={styles.gearGlow} pointerEvents="none" />
        <Text style={styles.gearIcon}>⚙</Text>
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="none"
        onRequestClose={close}
        supportedOrientations={["landscape", "landscape-left", "landscape-right"]}
      >
        {/* Tapping the scrim closes; the panel swallows its own taps. */}
        <Pressable style={styles.backdrop} onPress={close}>
          <Pressable onPress={() => {}}>
            <Animated.View
              style={[
                styles.panelWrapper,
                { opacity: panelOpacity, transform: [{ scale: panelScale }] },
              ]}
            >
              <View style={styles.panelGlow} pointerEvents="none" />
              <LinearGradient
                colors={["rgba(61, 34, 114, 0.97)", "rgba(26, 16, 48, 0.98)"]}
                style={styles.panel}
              >
                <Text style={styles.panelTitle}>SETTINGS</Text>
                <View style={styles.panelDivider} />

                <View style={styles.settingRow}>
                  <Text style={styles.settingLabel}>Sound</Text>

                  <View style={styles.toggle}>
                    {SOUND_OPTIONS.map((option, index) => {
                      const isSelected =
                        (option === "ON") === soundEnabled;

                      return (
                        <TouchableOpacity
                          key={option}
                          onPress={() => audioManager.setSoundEnabled(option === "ON")}
                          activeOpacity={0.8}
                        >
                          <LinearGradient
                            colors={
                              isSelected
                                ? ["#FFE55C", "#FFCC00", "#F5A623"]
                                : ["rgba(61, 34, 114, 0.8)", "rgba(42, 22, 84, 0.9)"]
                            }
                            style={[
                              styles.toggleOption,
                              isSelected && styles.toggleOptionSelected,
                              index === 0 && styles.toggleOptionFirst,
                              index === SOUND_OPTIONS.length - 1 && styles.toggleOptionLast,
                            ]}
                          >
                            <Text
                              style={[
                                styles.toggleText,
                                isSelected && styles.toggleTextSelected,
                              ]}
                            >
                              {option}
                            </Text>
                          </LinearGradient>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                <TouchableOpacity onPress={close} activeOpacity={0.8} style={styles.closeButton}>
                  <Text style={styles.closeButtonText}>CLOSE</Text>
                </TouchableOpacity>
              </LinearGradient>
            </Animated.View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const rawStyles = {
  // Default placement; screens override via the `style` prop. zIndex keeps it
  // over avatars, cards and animations.
  gearButton: {
    position: "absolute",
    top: 16,
    left: 16,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(42, 22, 84, 0.9)",
    borderWidth: 1.5,
    borderColor: "#FFD700",
    zIndex: 600,
    elevation: 12,
  },
  gearGlow: {
    position: "absolute",
    top: -3,
    left: -3,
    right: -3,
    bottom: -3,
    borderRadius: 14,
    shadowColor: "#FFD700",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 8,
    elevation: 8,
  },
  gearIcon: {
    fontSize: 22,
    color: "#FFD700",
    textShadowColor: "rgba(255, 215, 0, 0.6)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
    // Nudges the glyph onto the optical centre of the button.
    lineHeight: 26,
  },

  backdrop: {
    flex: 1,
    backgroundColor: "rgba(10, 6, 18, 0.75)",
    alignItems: "center",
    justifyContent: "center",
  },
  panelWrapper: {
    alignItems: "center",
    justifyContent: "center",
  },
  panelGlow: {
    position: "absolute",
    top: -8,
    left: -8,
    right: -8,
    bottom: -8,
    borderRadius: 24,
    backgroundColor: "rgba(255, 215, 0, 0.12)",
    shadowColor: "#FFD700",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 20,
    elevation: 14,
  },
  panel: {
    minWidth: 300,
    paddingVertical: 18,
    paddingHorizontal: 24,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: "#FFD700",
    alignItems: "center",
  },
  panelTitle: {
    fontSize: 24,
    fontFamily: "Bangers_400Regular",
    color: "#FFD700",
    letterSpacing: 3,
    textShadowColor: "rgba(255, 165, 0, 0.5)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 14,
  },
  panelDivider: {
    width: "100%",
    height: 1,
    backgroundColor: "rgba(255, 215, 0, 0.35)",
    marginTop: 8,
    marginBottom: 14,
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
  },
  settingLabel: {
    fontSize: 20,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    letterSpacing: 1.5,
    marginRight: 18,
  },

  toggle: {
    flexDirection: "row",
    alignItems: "center",
  },
  toggleOption: {
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderWidth: 2,
    borderColor: "#5E3A9E",
  },
  toggleOptionSelected: {
    borderColor: "#3D2272",
  },
  toggleOptionFirst: {
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
    borderRightWidth: 1,
  },
  toggleOptionLast: {
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
    borderLeftWidth: 1,
  },
  toggleText: {
    fontSize: 18,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    letterSpacing: 1,
    textShadowColor: "rgba(0, 0, 0, 0.5)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  toggleTextSelected: {
    color: "#3D2272",
    textShadowColor: "rgba(255, 255, 255, 0.3)",
  },

  closeButton: {
    marginTop: 18,
    paddingVertical: 8,
    paddingHorizontal: 32,
    borderRadius: 10,
    backgroundColor: "rgba(94, 58, 158, 0.6)",
    borderWidth: 1.5,
    borderColor: "#5E3A9E",
  },
  closeButtonText: {
    fontSize: 17,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    letterSpacing: 2,
  },
};
