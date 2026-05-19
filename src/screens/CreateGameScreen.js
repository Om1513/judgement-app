import React, { useEffect, useRef, useState, useMemo } from "react";
import {
  View,
  Text,
  ImageBackground,
  StyleSheet,
  Animated,
  TouchableOpacity,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { useFonts, Bangers_400Regular } from "@expo-google-fonts/bangers";
import LobbyCode from "../components/LobbyCode";
import SettingCard from "../components/SettingCard";
import RoundSelector from "../components/RoundSelector";
import OrderModeToggle from "../components/OrderModeToggle";
import ScoringModeToggle from "../components/ScoringModeToggle";
import GameButton from "../components/GameButton";

// Generate random 6-character alphanumeric code
const generateLobbyCode = () => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

export default function CreateGameScreen({ navigation, route }) {
  const playerName = route.params?.playerName || "Player";
  const [isReady, setIsReady] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  // Game settings state
  const [players, setPlayers] = useState(4);
  const [rounds, setRounds] = useState(4);
  const [orderMode, setOrderMode] = useState("Kachuful");
  const [scoringMode, setScoringMode] = useState("+10");

  // Generate lobby code once on mount
  const lobbyCode = useMemo(() => generateLobbyCode(), []);

  const [fontsLoaded] = useFonts({
    Bangers_400Regular,
  });

  useEffect(() => {
    // Wait for screen transition to complete before showing content
    const unsubscribe = navigation.addListener("transitionEnd", () => {
      setIsReady(true);
    });

    // Fallback timeout in case transitionEnd doesn't fire
    const timeout = setTimeout(() => {
      setIsReady(true);
    }, 500);

    return () => {
      unsubscribe();
      clearTimeout(timeout);
    };
  }, [navigation]);

  useEffect(() => {
    // Animate content after transition is complete
    if (isReady) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.spring(slideAnim, {
          toValue: 0,
          friction: 8,
          tension: 40,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [isReady]);

  const handleGoBack = () => {
    navigation.goBack();
  };

  const handleCreateLobby = () => {
    // Navigate to lobby screen with host data
    navigation.navigate("Lobby", {
      lobbyCode: lobbyCode,
      hostName: playerName,
      hostId: `host-${Date.now()}`,
      isHost: true,
      currentPlayerId: `host-${Date.now()}`,
      currentPlayerName: playerName,
      gameSettings: {
        maxPlayers: players,
        rounds,
        orderMode,
        scoringMode,
      },
    });
  };

  if (!fontsLoaded) {
    return (
      <View style={styles.container}>
        <ImageBackground
          source={require("../../assets/background_without_title.png")}
          style={styles.background}
          resizeMode="cover"
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ImageBackground
        source={require("../../assets/background_without_title.png")}
        style={styles.background}
        resizeMode="cover"
      >
        {/* Only show content after transition completes */}
        {isReady && (
          <>
            {/* Top gradient for better visibility */}
            <LinearGradient
              colors={["rgba(26, 16, 48, 0.7)", "transparent", "rgba(26, 16, 48, 0.5)"]}
              locations={[0, 0.4, 1]}
              style={styles.overlayGradient}
            />

            {/* Main content */}
            <Animated.View
              style={[
                styles.content,
                {
                  opacity: fadeAnim,
                  transform: [{ translateY: slideAnim }],
                },
              ]}
            >
              {/* Lobby Code Section */}
              <View style={styles.topSection}>
                <LobbyCode code={lobbyCode} />
              </View>

              {/* Settings Section - 2x2 Grid */}
              <View style={styles.settingsSection}>
                <View style={styles.settingsRow}>
                  <SettingCard label="Players" compact>
                    <RoundSelector
                      value={players}
                      onChange={setPlayers}
                      min={3}
                      max={8}
                    />
                  </SettingCard>

                  <SettingCard label="Rounds" compact>
                    <RoundSelector
                      value={rounds}
                      onChange={setRounds}
                      min={4}
                      max={8}
                    />
                  </SettingCard>
                </View>

                <View style={styles.settingsRow}>
                  <SettingCard label="Order" compact>
                    <OrderModeToggle
                      value={orderMode}
                      onChange={setOrderMode}
                    />
                  </SettingCard>

                  <SettingCard label="Scoring" compact>
                    <ScoringModeToggle
                      value={scoringMode}
                      onChange={setScoringMode}
                    />
                  </SettingCard>
                </View>
              </View>

              {/* Create Lobby Button */}
              <View style={styles.bottomSection}>
                <GameButton
                  title="Create Lobby"
                  onPress={handleCreateLobby}
                  delay={0}
                />
              </View>
            </Animated.View>

            {/* Back button */}
            <Animated.View
              style={[
                styles.backButtonContainer,
                { opacity: fadeAnim },
              ]}
            >
              <TouchableOpacity style={styles.backButton} onPress={handleGoBack}>
                <LinearGradient
                  colors={["#5E3A9E", "#3D2272"]}
                  style={styles.backButtonGradient}
                >
                  <Text style={styles.backButtonText}>Back</Text>
                </LinearGradient>
              </TouchableOpacity>
            </Animated.View>
          </>
        )}

        <StatusBar style="light" hidden />
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0612",
  },
  background: {
    flex: 1,
    width: "100%",
    height: "100%",
    overflow: "visible",
  },
  overlayGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  content: {
    flex: 1,
    paddingHorizontal: 30,
    paddingTop: 15,
    overflow: "visible",
  },
  topSection: {
    alignItems: "center",
    marginBottom: 5,
  },
  settingsSection: {
    flex: 1,
    justifyContent: "flex-start",
    alignSelf: "center",
    width: "100%",
    paddingHorizontal: 10,
    paddingTop: 10,
  },
  settingsRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "stretch",
    marginVertical: 5,
  },
  bottomSection: {
    alignItems: "center",
    paddingBottom: 15,
  },
  backButtonContainer: {
    position: "absolute",
    bottom: "5%",
    left: "3%",
  },
  backButton: {
    borderRadius: 12,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 8,
  },
  backButtonGradient: {
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 12,
  },
  backButtonText: {
    fontSize: 18,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
  },
});
