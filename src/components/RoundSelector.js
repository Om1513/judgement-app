import React, { useRef, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";

export default function RoundSelector({
  value,
  onChange,
  min = 4,
  max = 8,
}) {
  const numberAnim = useRef(new Animated.Value(1)).current;

  const animateNumber = () => {
    Animated.sequence([
      Animated.timing(numberAnim, {
        toValue: 1.2,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.spring(numberAnim, {
        toValue: 1,
        friction: 4,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const handleDecrease = () => {
    if (value > min) {
      onChange(value - 1);
      animateNumber();
    }
  };

  const handleIncrease = () => {
    if (value < max) {
      onChange(value + 1);
      animateNumber();
    }
  };

  const isMinDisabled = value <= min;
  const isMaxDisabled = value >= max;

  return (
    <View style={styles.container}>
      {/* Decrease button */}
      <TouchableOpacity
        onPress={handleDecrease}
        disabled={isMinDisabled}
        style={[styles.button, isMinDisabled && styles.buttonDisabled]}
      >
        <LinearGradient
          colors={isMinDisabled
            ? ["#4A4A4A", "#3A3A3A"]
            : ["#FFE55C", "#F5A623"]
          }
          style={styles.buttonGradient}
        >
          <Text style={[styles.buttonText, isMinDisabled && styles.buttonTextDisabled]}>
            −
          </Text>
        </LinearGradient>
      </TouchableOpacity>

      {/* Number display */}
      <Animated.View style={[styles.numberContainer, { transform: [{ scale: numberAnim }] }]}>
        <Text style={styles.numberText}>{value}</Text>
      </Animated.View>

      {/* Increase button */}
      <TouchableOpacity
        onPress={handleIncrease}
        disabled={isMaxDisabled}
        style={[styles.button, isMaxDisabled && styles.buttonDisabled]}
      >
        <LinearGradient
          colors={isMaxDisabled
            ? ["#4A4A4A", "#3A3A3A"]
            : ["#FFE55C", "#F5A623"]
          }
          style={styles.buttonGradient}
        >
          <Text style={[styles.buttonText, isMaxDisabled && styles.buttonTextDisabled]}>
            +
          </Text>
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
  },
  button: {
    borderRadius: 10,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonGradient: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#3D2272",
  },
  buttonText: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#3D2272",
  },
  buttonTextDisabled: {
    color: "#666",
  },
  numberContainer: {
    width: 50,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 8,
  },
  numberText: {
    fontSize: 32,
    fontFamily: "Bangers_400Regular",
    color: "#FFD700",
    textShadowColor: "rgba(0, 0, 0, 0.5)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
    paddingRight: 4,
  },
});
