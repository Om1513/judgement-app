import React, { useEffect, useRef } from "react";
import { View, Animated, StyleSheet } from "react-native";

const Sparkle = ({ delay, startX, startY, size }) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animate = () => {
      // Reset values
      opacity.setValue(0);
      translateY.setValue(0);
      scale.setValue(0);

      Animated.parallel([
        Animated.sequence([
          Animated.timing(opacity, {
            toValue: 1,
            duration: 500,
            delay,
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0,
            duration: 1500,
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(translateY, {
          toValue: -50,
          duration: 2000,
          delay,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(scale, {
            toValue: 1,
            duration: 500,
            delay,
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 0.3,
            duration: 1500,
            useNativeDriver: true,
          }),
        ]),
      ]).start(() => animate());
    };

    animate();
  }, []);

  return (
    <Animated.View
      style={[
        styles.sparkle,
        {
          left: startX,
          top: startY,
          width: size,
          height: size,
          opacity,
          transform: [{ translateY }, { scale }],
        },
      ]}
    />
  );
};

export default function Sparkles() {
  // Sparkle positions spread horizontally for side-by-side buttons
  const sparkles = [
    // Left button area
    { id: 1, delay: 0, startX: "18%", startY: "75%", size: 5 },
    { id: 2, delay: 400, startX: "25%", startY: "80%", size: 4 },
    { id: 3, delay: 800, startX: "32%", startY: "72%", size: 6 },
    { id: 4, delay: 1200, startX: "22%", startY: "85%", size: 4 },
    // Center area
    { id: 5, delay: 200, startX: "45%", startY: "78%", size: 5 },
    { id: 6, delay: 600, startX: "52%", startY: "82%", size: 4 },
    // Right button area
    { id: 7, delay: 300, startX: "68%", startY: "75%", size: 5 },
    { id: 8, delay: 700, startX: "75%", startY: "80%", size: 6 },
    { id: 9, delay: 1100, startX: "82%", startY: "73%", size: 4 },
    { id: 10, delay: 1500, startX: "78%", startY: "85%", size: 5 },
    // Extra sparkles
    { id: 11, delay: 500, startX: "38%", startY: "76%", size: 3 },
    { id: 12, delay: 900, startX: "62%", startY: "79%", size: 4 },
  ];

  return (
    <View style={styles.container} pointerEvents="none">
      {sparkles.map((sparkle) => (
        <Sparkle
          key={sparkle.id}
          delay={sparkle.delay}
          startX={sparkle.startX}
          startY={sparkle.startY}
          size={sparkle.size}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
  },
  sparkle: {
    position: "absolute",
    backgroundColor: "#FFE566",
    borderRadius: 50,
    shadowColor: "#FFD700",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 10,
    elevation: 5,
  },
});
