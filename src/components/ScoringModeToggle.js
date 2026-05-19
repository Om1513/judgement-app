import React, { useRef, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";

const OPTIONS = ["+10", "+1"];

export default function ScoringModeToggle({ value, onChange }) {
  const glowAnims = useRef(OPTIONS.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    // Animate glow for selected option
    OPTIONS.forEach((option, index) => {
      Animated.timing(glowAnims[index], {
        toValue: option === value ? 1 : 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    });
  }, [value]);

  return (
    <View style={styles.container}>
      {OPTIONS.map((option, index) => {
        const isSelected = option === value;

        return (
          <TouchableOpacity
            key={option}
            onPress={() => onChange(option)}
            style={styles.optionButton}
          >
            {/* Glow effect for selected */}
            <Animated.View
              style={[
                styles.glow,
                { opacity: glowAnims[index] },
              ]}
            />

            <LinearGradient
              colors={isSelected
                ? ["#FFE55C", "#FFCC00", "#F5A623"]
                : ["rgba(61, 34, 114, 0.8)", "rgba(42, 22, 84, 0.9)"]
              }
              style={[
                styles.optionGradient,
                isSelected && styles.optionSelected,
                index === 0 && styles.optionFirst,
                index === OPTIONS.length - 1 && styles.optionLast,
              ]}
            >
              <Text
                style={[
                  styles.optionText,
                  isSelected && styles.optionTextSelected,
                ]}
              >
                {option}
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    overflow: "visible",
  },
  optionButton: {
    position: "relative",
  },
  glow: {
    position: "absolute",
    top: -5,
    left: -5,
    right: -5,
    bottom: -5,
    backgroundColor: "#FFD700",
    borderRadius: 14,
    shadowColor: "#FFD700",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 10,
    elevation: 8,
  },
  optionGradient: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderWidth: 2,
    borderColor: "#5E3A9E",
  },
  optionSelected: {
    borderColor: "#3D2272",
  },
  optionFirst: {
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
    borderRightWidth: 1,
  },
  optionLast: {
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
    borderLeftWidth: 1,
  },
  optionText: {
    fontSize: 20,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    textShadowColor: "rgba(0, 0, 0, 0.5)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  optionTextSelected: {
    color: "#3D2272",
    textShadowColor: "rgba(255, 255, 255, 0.3)",
  },
});
