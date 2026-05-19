import React, { useEffect, useRef, useState, useMemo } from "react";
import {
  View,
  Text,
  ImageBackground,
  StyleSheet,
  Animated,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import * as Clipboard from "expo-clipboard";
import { useFonts, Bangers_400Regular } from "@expo-google-fonts/bangers";

import PlayerCard from "../components/PlayerCard";
import RemovePlayerModal from "../components/RemovePlayerModal";

export default function LobbyScreen({ navigation, route }) {
  // Get params from navigation
  const {
    lobbyCode = "ABC123",
    hostName = "Player",
    hostId = "host-1",
    isHost = true,
    gameSettings = {},
    currentPlayerId = "host-1",
    currentPlayerName = "Player",
  } = route.params || {};

  const [isReady, setIsReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const [removeModalVisible, setRemoveModalVisible] = useState(false);
  const [playerToRemove, setPlayerToRemove] = useState(null);

  // Mock players state - in real app this would come from realtime backend
  const [players, setPlayers] = useState([
    { id: hostId, name: hostName, isHost: true, joinedAt: Date.now() },
  ]);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const buttonGlowAnim = useRef(new Animated.Value(0.5)).current;

  const [fontsLoaded] = useFonts({
    Bangers_400Regular,
  });

  const canStartGame = players.length >= 3;
  const isCurrentUserHost = isHost;

  // Button glow animation
  useEffect(() => {
    if (canStartGame && isCurrentUserHost) {
      const pulseGlow = () => {
        Animated.sequence([
          Animated.timing(buttonGlowAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(buttonGlowAnim, {
            toValue: 0.5,
            duration: 1000,
            useNativeDriver: true,
          }),
        ]).start(() => pulseGlow());
      };
      pulseGlow();
    }
  }, [canStartGame, isCurrentUserHost]);

  useEffect(() => {
    const unsubscribe = navigation.addListener("transitionEnd", () => {
      setIsReady(true);
    });

    const timeout = setTimeout(() => {
      setIsReady(true);
    }, 500);

    return () => {
      unsubscribe();
      clearTimeout(timeout);
    };
  }, [navigation]);

  useEffect(() => {
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

  // Demo: Add mock players for testing layout
  useEffect(() => {
    // Simulate players joining for demo
    const mockPlayers = [
      { id: "player-2", name: "Alice", isHost: false, joinedAt: Date.now() + 1000 },
      { id: "player-3", name: "Bob", isHost: false, joinedAt: Date.now() + 2000 },
      { id: "player-4", name: "Charlie", isHost: false, joinedAt: Date.now() + 3000 },
    ];

    const timers = mockPlayers.map((player, index) => {
      return setTimeout(() => {
        setPlayers((prev) => {
          if (prev.find((p) => p.id === player.id)) return prev;
          return [...prev, player];
        });
      }, (index + 1) * 800);
    });

    return () => timers.forEach(clearTimeout);
  }, []);

  const handleCopyCode = async () => {
    await Clipboard.setStringAsync(lobbyCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRemovePlayer = (player) => {
    setPlayerToRemove(player);
    setRemoveModalVisible(true);
  };

  const confirmRemovePlayer = () => {
    if (playerToRemove) {
      setPlayers((prev) => prev.filter((p) => p.id !== playerToRemove.id));
      // TODO: Send remove event to backend
    }
    setRemoveModalVisible(false);
    setPlayerToRemove(null);
  };

  const cancelRemovePlayer = () => {
    setRemoveModalVisible(false);
    setPlayerToRemove(null);
  };

  const handleStartGame = () => {
    if (!canStartGame) return;

    const gameData = {
      lobbyCode,
      players,
      settings: gameSettings,
    };

    console.log("Starting game:", gameData);
    // TODO: Navigate to game screen
    // navigation.navigate("Game", gameData);
  };

  const handleLeaveLobby = () => {
    navigation.goBack();
  };

  // Calculate player layout based on count
  const getPlayerLayout = useMemo(() => {
    const count = players.length;
    const host = players.find((p) => p.isHost);
    const others = players.filter((p) => !p.isHost);

    if (count <= 4) {
      return { layout: "row", host, others };
    } else if (count <= 6) {
      return { layout: "twoRows", host, others };
    } else {
      return { layout: "threeRows", host, others };
    }
  }, [players]);

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

  const renderPlayers = () => {
    const { layout, host, others } = getPlayerLayout;
    const isCompact = players.length > 5;

    if (layout === "row") {
      return (
        <View style={styles.playersRow}>
          {host && (
            <PlayerCard
              player={host}
              isHost={isCurrentUserHost}
              canRemove={false}
              size={isCompact ? "compact" : "normal"}
            />
          )}
          {others.map((player) => (
            <PlayerCard
              key={player.id}
              player={player}
              isHost={isCurrentUserHost}
              canRemove={isCurrentUserHost}
              onRemove={handleRemovePlayer}
              size={isCompact ? "compact" : "normal"}
            />
          ))}
        </View>
      );
    }

    if (layout === "twoRows") {
      const firstRow = others.slice(0, 2);
      const secondRow = others.slice(2);

      return (
        <View style={styles.playersContainer}>
          <View style={styles.playersRow}>
            {firstRow.map((player) => (
              <PlayerCard
                key={player.id}
                player={player}
                isHost={isCurrentUserHost}
                canRemove={isCurrentUserHost}
                onRemove={handleRemovePlayer}
                size="compact"
              />
            ))}
          </View>
          <View style={styles.playersRow}>
            {host && (
              <PlayerCard
                player={host}
                isHost={isCurrentUserHost}
                canRemove={false}
                size="compact"
              />
            )}
          </View>
          <View style={styles.playersRow}>
            {secondRow.map((player) => (
              <PlayerCard
                key={player.id}
                player={player}
                isHost={isCurrentUserHost}
                canRemove={isCurrentUserHost}
                onRemove={handleRemovePlayer}
                size="compact"
              />
            ))}
          </View>
        </View>
      );
    }

    // threeRows layout for 7-8 players
    const topRow = others.slice(0, 3);
    const bottomRow = others.slice(3);

    return (
      <View style={styles.playersContainer}>
        <View style={styles.playersRow}>
          {topRow.map((player) => (
            <PlayerCard
              key={player.id}
              player={player}
              isHost={isCurrentUserHost}
              canRemove={isCurrentUserHost}
              onRemove={handleRemovePlayer}
              size="compact"
            />
          ))}
        </View>
        <View style={styles.playersRow}>
          {host && (
            <PlayerCard
              player={host}
              isHost={isCurrentUserHost}
              canRemove={false}
              size="compact"
            />
          )}
        </View>
        <View style={styles.playersRow}>
          {bottomRow.map((player) => (
            <PlayerCard
              key={player.id}
              player={player}
              isHost={isCurrentUserHost}
              canRemove={isCurrentUserHost}
              onRemove={handleRemovePlayer}
              size="compact"
            />
          ))}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <ImageBackground
        source={require("../../assets/background_without_title.png")}
        style={styles.background}
        resizeMode="cover"
      >
        {isReady && (
          <>
            {/* Overlay gradient */}
            <LinearGradient
              colors={["rgba(26, 16, 48, 0.6)", "transparent", "rgba(26, 16, 48, 0.5)"]}
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
              {/* Top Section - Title and Code */}
              <View style={styles.topSection}>
                {/* Lobby Title */}
                <Text style={styles.title}>{hostName}'s Lobby</Text>

                {/* Lobby Code */}
                <View style={styles.codeContainer}>
                  <View style={styles.codeBox}>
                    <Text style={styles.codeLabel}>CODE:</Text>
                    <Text style={styles.codeText}>{lobbyCode}</Text>
                    <TouchableOpacity
                      style={styles.copyButton}
                      onPress={handleCopyCode}
                      activeOpacity={0.7}
                    >
                      <LinearGradient
                        colors={copied ? ["#4CAF50", "#388E3C"] : ["#FFD700", "#F5A623"]}
                        style={styles.copyButtonGradient}
                      >
                        <Text style={styles.copyButtonText}>
                          {copied ? "OK" : "COPY"}
                        </Text>
                      </LinearGradient>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Player count */}
                <Text style={styles.playerCount}>
                  Players: {players.length}/8
                </Text>
              </View>

              {/* Center Section - Player List */}
              <View style={styles.centerSection}>
                {renderPlayers()}
              </View>

              {/* Bottom Section */}
              <View style={styles.bottomSection}>
                {isCurrentUserHost ? (
                  // Host view - Start Game button
                  <View style={styles.startButtonContainer}>
                    <Animated.View
                      style={[
                        styles.buttonGlow,
                        canStartGame && {
                          opacity: buttonGlowAnim,
                        },
                      ]}
                    />
                    <TouchableOpacity
                      onPress={handleStartGame}
                      activeOpacity={0.8}
                      disabled={!canStartGame}
                      style={styles.startButton}
                    >
                      <View
                        style={[
                          styles.startButtonShadow,
                          !canStartGame && styles.startButtonDisabled,
                        ]}
                      >
                        <LinearGradient
                          colors={
                            canStartGame
                              ? ["#FFE55C", "#FFCC00", "#FFB800", "#F5A623"]
                              : ["#6A6A6A", "#4A4A4A", "#3A3A3A", "#2A2A2A"]
                          }
                          style={styles.startButtonGradient}
                        >
                          <LinearGradient
                            colors={[
                              "rgba(255,255,255,0.5)",
                              "rgba(255,255,255,0.2)",
                              "transparent",
                            ]}
                            style={styles.glossOverlay}
                          />
                          <Text
                            style={[
                              styles.startButtonText,
                              !canStartGame && styles.startButtonTextDisabled,
                            ]}
                          >
                            Start Game
                          </Text>
                        </LinearGradient>
                      </View>
                    </TouchableOpacity>
                    {!canStartGame && (
                      <Text style={styles.minPlayersText}>
                        Need at least 3 players to start
                      </Text>
                    )}
                  </View>
                ) : (
                  // Non-host view - Waiting message
                  <View style={styles.waitingContainer}>
                    <Text style={styles.waitingText}>
                      Waiting for host to start the game...
                    </Text>
                  </View>
                )}
              </View>
            </Animated.View>

            {/* Leave button */}
            <Animated.View
              style={[styles.leaveButtonContainer, { opacity: fadeAnim }]}
            >
              <TouchableOpacity
                style={styles.leaveButton}
                onPress={handleLeaveLobby}
              >
                <LinearGradient
                  colors={["#5E3A9E", "#3D2272"]}
                  style={styles.leaveButtonGradient}
                >
                  <Text style={styles.leaveButtonText}>Leave</Text>
                </LinearGradient>
              </TouchableOpacity>
            </Animated.View>

            {/* Remove Player Modal */}
            <RemovePlayerModal
              visible={removeModalVisible}
              playerName={playerToRemove?.name || ""}
              onConfirm={confirmRemovePlayer}
              onCancel={cancelRemovePlayer}
            />
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
  },
  overlayGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  topSection: {
    alignItems: "center",
    marginBottom: 10,
  },
  title: {
    fontSize: 36,
    fontFamily: "Bangers_400Regular",
    color: "#FFD700",
    textShadowColor: "rgba(0, 0, 0, 0.8)",
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 6,
    letterSpacing: 2,
    marginBottom: 8,
  },
  codeContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  codeBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(42, 22, 84, 0.8)",
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#5E3A9E",
  },
  codeLabel: {
    fontSize: 14,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    marginRight: 8,
    letterSpacing: 1,
  },
  codeText: {
    fontSize: 22,
    fontFamily: "Bangers_400Regular",
    color: "#FFD700",
    letterSpacing: 4,
    marginRight: 12,
  },
  copyButton: {
    borderRadius: 8,
    overflow: "hidden",
  },
  copyButtonGradient: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  copyButtonText: {
    fontSize: 12,
    fontFamily: "Bangers_400Regular",
    color: "#2A1654",
    letterSpacing: 1,
  },
  playerCount: {
    fontSize: 16,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    marginTop: 8,
    letterSpacing: 1,
    opacity: 0.8,
  },
  centerSection: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  playersContainer: {
    alignItems: "center",
  },
  playersRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    flexWrap: "wrap",
  },
  bottomSection: {
    alignItems: "center",
    paddingBottom: 15,
  },
  startButtonContainer: {
    alignItems: "center",
    position: "relative",
  },
  buttonGlow: {
    position: "absolute",
    top: -8,
    left: -8,
    right: -8,
    bottom: -8,
    borderRadius: 26,
    backgroundColor: "#FFD700",
    shadowColor: "#FFD700",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
    zIndex: -1,
  },
  startButton: {
    borderRadius: 18,
  },
  startButtonShadow: {
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
  startButtonDisabled: {
    backgroundColor: "#2A2A2A",
    borderColor: "#3A3A3A",
    shadowOpacity: 0.4,
  },
  startButtonGradient: {
    paddingVertical: 14,
    paddingHorizontal: 60,
    borderRadius: 14,
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
  startButtonText: {
    fontSize: 26,
    fontFamily: "Bangers_400Regular",
    color: "#FFFFFF",
    textShadowColor: "rgba(80, 40, 20, 0.8)",
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 4,
    letterSpacing: 1,
  },
  startButtonTextDisabled: {
    color: "#888888",
    textShadowColor: "rgba(0, 0, 0, 0.5)",
  },
  minPlayersText: {
    fontSize: 14,
    fontFamily: "Bangers_400Regular",
    color: "#FF6B6B",
    marginTop: 10,
    letterSpacing: 0.5,
  },
  waitingContainer: {
    paddingVertical: 15,
    paddingHorizontal: 25,
    backgroundColor: "rgba(42, 22, 84, 0.8)",
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#5E3A9E",
  },
  waitingText: {
    fontSize: 18,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    letterSpacing: 0.5,
  },
  leaveButtonContainer: {
    position: "absolute",
    bottom: "5%",
    left: "3%",
  },
  leaveButton: {
    borderRadius: 12,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 8,
  },
  leaveButtonGradient: {
    paddingVertical: 12,
    paddingHorizontal: 25,
    borderRadius: 12,
  },
  leaveButtonText: {
    fontSize: 16,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
  },
});
