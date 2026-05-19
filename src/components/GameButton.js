import React, { useRef, useEffect } from "react";
import {
  TouchableOpacity,
  Text,
  View,
  Animated,
  StyleSheet,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";

export default function GameButton({ title, onPress, delay = 0, style }) {
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
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
        style={styles.touchable}
      >
        {/* Dark purple border/shadow layer */}
        <View style={styles.shadowLayer}>
          {/* Main button gradient - matching Kachuful logo colors */}
          <LinearGradient
            colors={["#FFE55C", "#FFCC00", "#FFB800", "#F5A623"]}
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
            <Text style={styles.buttonText}>{title}</Text>

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
    paddingHorizontal: 32,
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
  buttonText: {
    fontSize: 24,
    color: "#FFFFFF",
    textShadowColor: "rgba(80, 40, 20, 0.8)",
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 4,
    letterSpacing: 0.5,
    fontFamily: "Bangers_400Regular",
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
