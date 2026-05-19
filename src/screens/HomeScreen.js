import React from "react";
import { View, ImageBackground, StyleSheet, ActivityIndicator } from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { useFonts, Bangers_400Regular } from "@expo-google-fonts/bangers";
import GameButton from "../components/GameButton";
import Sparkles from "../components/Sparkles";

export default function HomeScreen() {
  const [fontsLoaded] = useFonts({
    Bangers_400Regular,
  });

  const handleCreateGame = () => {
    console.log("Create Game pressed");
    // TODO: Navigate to create game screen
  };

  const handleJoinGame = () => {
    console.log("Join Game pressed");
    // TODO: Navigate to join game screen
  };

  if (!fontsLoaded) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#FFD000" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ImageBackground
        source={require("../../assets/background.png")}
        style={styles.background}
        resizeMode="cover"
      >
        {/* Sparkle effects */}
        <Sparkles />

        {/* Bottom gradient overlay for better button visibility */}
        <LinearGradient
          colors={["transparent", "rgba(26, 16, 48, 0.2)", "rgba(26, 16, 48, 0.5)"]}
          style={styles.bottomGradient}
        />

        {/* Button container - horizontal layout */}
        <View style={styles.buttonContainer}>
          <View style={styles.buttonRow}>
            <GameButton
              title="Create Game"
              onPress={handleCreateGame}
              delay={200}
            />
            <GameButton
              title="Join Game"
              onPress={handleJoinGame}
              delay={400}
            />
          </View>
        </View>

        <StatusBar style="light" hidden />
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: "#1a1030",
    alignItems: "center",
    justifyContent: "center",
  },
  background: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
  bottomGradient: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: "40%",
  },
  buttonContainer: {
    position: "absolute",
    bottom: "8%",
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
});
