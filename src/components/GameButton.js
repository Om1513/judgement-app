import React, { useRef, useEffect } from "react";
import {
  TouchableOpacity,
  Text,
  View,
  Animated,
  StyleSheet,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import audioManager from "../services/audioManager";

export default function GameButton({ title, onPress, delay = 0, style, disabled = false }) {
  const scaleAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Entry animation
    Animated.spring(scaleAnim, {
      toValue: 1,
      delay,
      friction: 6,
      tension: 40,
      useNativeDriver: true,
    }).start();
  }, []);

  const handlePressIn = () => {
    // No press-in dip when disabled, so the button reads as inert rather than
    // tappable-but-unresponsive.
    if (disabled) return;
    Animated.spring(scaleAnim, {
      toValue: 0.95,
      friction: 5,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 3,
      tension: 40,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View
      style={[
        styles.buttonWrapper,
        style,
        {
          transform: [{ scale: scaleAnim }],
        },
      ]}
    >
      <TouchableOpacity
        // The press sound lives here rather than in each screen's handler, so
        // every GameButton gets it once and screens never double it up.
        onPress={(event) => {
          audioManager.playSound("buttonPop");
          onPress?.(event);
        }}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
        disabled={disabled}
        style={styles.touchable}
      >
        {/* Dark purple border/shadow layer */}
        <View style={[styles.shadowLayer, disabled && styles.shadowLayerDisabled]}>
          {/* Main button gradient - matching Kachuful logo colors */}
          <LinearGradient
            colors={
              disabled
                ? ["#6A6A6A", "#4A4A4A", "#3A3A3A", "#2A2A2A"]
                : ["#FFE55C", "#FFCC00", "#FFB800", "#F5A623"]
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={styles.gradient}
          >
            {/* Glossy highlight overlay */}
            <LinearGradient
              colors={["rgba(255,255,255,0.5)", "rgba(255,255,255,0.2)", "transparent"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 0.6 }}
              style={styles.glossOverlay}
            />

            {/* Button text */}
            <Text style={[styles.buttonText, disabled && styles.buttonTextDisabled]}>
              {title}
            </Text>

            {/* Inner bottom highlight */}
            <View style={styles.innerHighlight} />
          </LinearGradient>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  buttonWrapper: {
    alignItems: "center",
    marginHorizontal: 12,
  },
  touchable: {
    borderRadius: 18,
  },
  shadowLayer: {
    backgroundColor: "#3D2272",
    borderRadius: 18,
    padding: 4,
    shadowColor: "#2A1654",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.8,
    shadowRadius: 12,
    elevation: 15,
    borderWidth: 3,
    borderColor: "#5E3A9E",
  },
  gradient: {
    paddingVertical: 14,
    paddingHorizontal: 45,
    borderRadius: 14,
    minWidth: 180,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  glossOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "55%",
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
  },
  // Disabled keeps the exact same geometry - only colours change - so toggling
  // it never moves anything on screen.
  shadowLayerDisabled: {
    borderColor: "#4A4A4A",
    shadowOpacity: 0.3,
  },
  buttonTextDisabled: {
    color: "#B8B8B8",
    textShadowColor: "rgba(0, 0, 0, 0.6)",
  },
  buttonText: {
    fontSize: 24,
    color: "#FFFFFF",
    textShadowColor: "rgba(80, 40, 20, 0.8)",
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 4,
    letterSpacing: 0.5,
    fontFamily: "Bangers_400Regular",
    textAlign: "center",
    paddingHorizontal: 5,
  },
  innerHighlight: {
    position: "absolute",
    bottom: 4,
    left: 15,
    right: 15,
    height: 2,
    backgroundColor: "rgba(255,255,255,0.3)",
    borderRadius: 2,
  },
});
