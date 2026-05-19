import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Clipboard from "expo-clipboard";

export default function LobbyCode({ code, onCopy }) {
  const scaleAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Entry animation
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 6,
      tension: 40,
      useNativeDriver: true,
    }).start();
  }, []);

  const handleCopy = async () => {
    await Clipboard.setStringAsync(code);
    Alert.alert("Copied!", "Lobby code copied to clipboard");
    if (onCopy) onCopy();
  };

  return (
    <Animated.View
      style={[
        styles.container,
        { transform: [{ scale: scaleAnim }] },
      ]}
    >
      <Text style={styles.label}>Lobby Code</Text>

      <View style={styles.codeContainer}>
        <LinearGradient
          colors={["rgba(61, 34, 114, 0.9)", "rgba(42, 22, 84, 0.95)"]}
          style={styles.codeBox}
        >
          <Text style={styles.codeText}>{code}</Text>

          <TouchableOpacity style={styles.copyButton} onPress={handleCopy}>
            <LinearGradient
              colors={["#5E3A9E", "#3D2272"]}
              style={styles.copyButtonGradient}
            >
              <Text style={styles.copyIcon}>📋</Text>
            </LinearGradient>
          </TouchableOpacity>
        </LinearGradient>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    marginBottom: 10,
  },
  label: {
    fontSize: 14,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    textShadowColor: "rgba(0, 0, 0, 0.5)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
    marginBottom: 5,
    letterSpacing: 1,
  },
  codeContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  codeBox: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingLeft: 18,
    paddingRight: 8,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#FFD700",
  },
  codeText: {
    fontSize: 26,
    fontFamily: "Bangers_400Regular",
    color: "#FFD700",
    letterSpacing: 6,
    textShadowColor: "rgba(0, 0, 0, 0.5)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
    marginRight: 10,
  },
  copyButton: {
    borderRadius: 8,
    overflow: "hidden",
  },
  copyButtonGradient: {
    padding: 8,
    borderRadius: 8,
  },
  copyIcon: {
    fontSize: 16,
  },
});
