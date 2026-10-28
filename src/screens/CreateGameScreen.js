import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  ImageBackground,
  StyleSheet,
  Animated,
  Alert,
  ActivityIndicator,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { useFonts, Bangers_400Regular } from "@expo-google-fonts/bangers";
import LobbySettingsForm from "../components/LobbySettingsForm";
import GameButton from "../components/GameButton";
import socketService from "../services/socket";
import CircleIconButton from "../components/CircleIconButton";
import SoundToggleButton from "../components/SoundToggleButton";
import ScreenHeader from "../components/ScreenHeader";
import { DEFAULT_SETTINGS } from "../utils/lobbySettings";
import audioManager from "../services/audioManager";
import { useResponsive, useScaledStyles } from "../utils/responsive";

export default function CreateGameScreen({ navigation, route }) {
  const styles = useScaledStyles(rawStyles);
  const r = useResponsive();
  // The content box's own inset. Plainly scaled: adding the landscape cutout
  // inset here pushed the whole page - the header cluster included - inboard by
  // ~59pt on top of the header's own offset, which is what moved the back and
  // sound buttons away from the top-left corner.
  const contentInsets = {
    paddingLeft: r.s(10),
    paddingRight: r.s(10),
    paddingTop: r.s(15),
  };
  const playerName = route.params?.playerName || "Player";
  const [isReady, setIsReady] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  // Game settings. The choices and the one-deck rule live in LobbySettingsForm,
  // shared with the lobby's Game Settings panel.
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

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
          duration: 250,
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
    socketService.disconnect();
    navigation.goBack();
  };

  const handleCreateLobby = async () => {
    if (isCreating) return;

    setIsCreating(true);

    try {
      // Connect to server if not connected
      if (!socketService.isConnected) {
        await socketService.connect(playerName);
      }

      // A returning player may still be attached to a previous lobby/game on
      // the server (stable identity survives reconnects). Creating a NEW game
      // means leaving that one first.
      if (socketService.lastSession?.lobby) {
        await socketService.leaveCurrentSession();
      }

      // Create lobby. If the server still reports an existing membership
      // (race / stale session), leave it and retry once.
      let lobby;
      try {
        lobby = await socketService.createLobby(playerName, settings);
      } catch (err) {
        if (/already in a/i.test(err.message || "")) {
          await socketService.leaveCurrentSession();
          lobby = await socketService.createLobby(playerName, settings);
        } else {
          throw err;
        }
      }


      // Success sting - deliberately here and not in the button handler. The
      // button's own pop already acknowledged the tap; this only fires once the
      // backend has actually returned a lobby, so a failed create stays silent
      // (the catch below never reaches this line).
      audioManager.playSound("createLobby");

      // Navigate to lobby screen with lobby data
      navigation.navigate("Lobby", {
        lobbyCode: lobby.code,
        lobbyId: lobby.id,
        hostName: lobby.hostName,
        hostId: lobby.hostPlayerId,
        isHost: true,
        currentPlayerId: socketService.playerId,
        currentPlayerName: playerName,
        gameSettings: lobby.settings,
        initialPlayers: lobby.players,
      });
    } catch (error) {
      console.error("Error creating lobby:", error);
      Alert.alert(
        "Connection Error",
        error.message || "Failed to create lobby. Please check your connection and try again.",
        [{ text: "OK" }]
      );
    } finally {
      setIsCreating(false);
    }
  };

  if (!fontsLoaded) {
    return (
      <View style={styles.container}>
        <ImageBackground
          source={require("../../assets/background_without_title.jpg")}
          style={styles.background}
          resizeMode="cover"
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ImageBackground
        source={require("../../assets/background_without_title.jpg")}
        style={styles.background}
        imageStyle={styles.backgroundImage}
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
                contentInsets,
                {
                  opacity: fadeAnim,
                  transform: [{ translateY: slideAnim }],
                },
              ]}
            >
              {/* Shared top bar: controls and title on one line. */}
              <ScreenHeader
                title="Game Settings"
                left={
                  <>
                    <CircleIconButton
                      inline
                      glyph="‹"
                      glyphStyle={styles.backGlyph}
                      accessibilityLabel="Go back"
                      onPress={handleGoBack}
                    />
                    <SoundToggleButton inline />
                  </>
                }
              />

              {/* Settings Section - 2x2 Grid */}
              <View style={styles.settingsSection}>
                <LobbySettingsForm value={settings} onChange={setSettings} />
              </View>

              {/* Create Lobby Button */}
              <View style={styles.bottomSection}>
                {isCreating ? (
                  <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color="#FFD700" />
                    <Text style={styles.loadingText}>Creating Lobby...</Text>
                  </View>
                ) : (
                  <GameButton
                    title="Create Lobby"
                    onPress={handleCreateLobby}
                    delay={0}
                  />
                )}
              </View>
            </Animated.View>

          </>
        )}

        <StatusBar style="light" hidden />
      </ImageBackground>
    </View>
  );
}

const rawStyles = {
  container: {
    flex: 1,
    backgroundColor: "#1a1030",
  },
  background: {
    flex: 1,
    width: "100%",
    height: "100%",
    overflow: "visible",
  },
  backgroundImage: {
    opacity: 0.85,
  },
  overlayGradient: {
    ...StyleSheet.absoluteFill,
  },
  content: {
    flex: 1,
    overflow: "visible",
  },
  settingsSection: {
    flex: 1,
    justifyContent: "flex-start",
    alignSelf: "center",
    width: "100%",
    paddingHorizontal: 0,
    paddingTop: 10,
  },
  bottomSection: {
    alignItems: "center",
    paddingBottom: 15,
  },
  // The chevron sits high and small in its em box next to the note glyph, so
  // nudge it onto the optical centre and size it up to match.
  backGlyph: {
    fontSize: 34,
    lineHeight: 38,
    marginTop: -3,
  },
  loadingContainer: {
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  loadingText: {
    fontSize: 18,
    fontFamily: "Bangers_400Regular",
    color: "#FFD700",
    marginTop: 10,
  },
};
