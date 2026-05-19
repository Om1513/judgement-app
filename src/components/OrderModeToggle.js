import React, { useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";

export default function OrderModeToggle({ value, onChange }) {
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const textOpacity = useRef(new Animated.Value(1)).current;

  const handleToggle = () => {
    // Animate rotation
    Animated.timing(rotateAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      rotateAnim.setValue(0);
    });

    // Animate text fade
    Animated.sequence([
      Animated.timing(textOpacity, {
        toValue: 0,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(textOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();

    // Toggle value
    const newValue = value === "Kachuful" ? "Random" : "Kachuful";
    onChange(newValue);
  };

  const rotation = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <View style={styles.container}>
      <Animated.Text style={[styles.valueText, { opacity: textOpacity }]}>
        {value}
      </Animated.Text>

      <TouchableOpacity onPress={handleToggle} style={styles.refreshButton}>
        <LinearGradient
          colors={["#FFE55C", "#F5A623"]}
          style={styles.refreshGradient}
        >
          <Animated.Text
            style={[styles.refreshIcon, { transform: [{ rotate: rotation }] }]}
          >
            🔄
          </Animated.Text>
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
  valueText: {
    fontSize: 22,
    fontFamily: "Bangers_400Regular",
    color: "#FFD700",
    textShadowColor: "rgba(0, 0, 0, 0.5)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
    marginRight: 15,
    minWidth: 100,
    textAlign: "right",
  },
  refreshButton: {
    borderRadius: 10,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  refreshGradient: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#3D2272",
  },
  refreshIcon: {
    fontSize: 22,
  },
});
