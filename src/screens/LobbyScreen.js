import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  ImageBackground,
  StyleSheet,
  Animated,
  TouchableOpacity,
  ScrollView,
  Alert,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import * as Clipboard from "expo-clipboard";
import { useFonts, Bangers_400Regular } from "@expo-google-fonts/bangers";

import PlayerCard from "../components/PlayerCard";
import RemovePlayerModal from "../components/RemovePlayerModal";
import socketService from "../services/socket";

export default function LobbyScreen({ navigation, route }) {
  // Get params from navigation
  const {
    lobbyCode = "ABC123",
    lobbyId = "",
    hostName = "Player",
    hostId = "host-1",
    isHost = true,
    gameSettings = {},
    currentPlayerId = "host-1",
    currentPlayerName = "Player",
    initialPlayers = [],
  } = route.params || {};

  const [isReady, setIsReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const [removeModalVisible, setRemoveModalVisible] = useState(false);
  const [playerToRemove, setPlayerToRemove] = useState(null);
  const [isStarting, setIsStarting] = useState(false);

  // Initialize players from initial data or fallback to host
  const [players, setPlayers] = useState(() => {
    if (initialPlayers && initialPlayers.length > 0) {
      return initialPlayers.map(p => ({
        id: p.playerId,
        name: p.name,
        isHost: p.isHost,
        isBot: p.isBot || false,
        joinedAt: new Date(p.joinedAt).getTime(),
      }));
    }
    return [{ id: hostId, name: hostName, isHost: true, isBot: false, joinedAt: Date.now() }];
  });

  const [currentHostId, setCurrentHostId] = useState(hostId);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const buttonGlowAnim = useRef(new Animated.Value(0.5)).current;

  const [fontsLoaded] = useFonts({
    Bangers_400Regular,
  });

  const canStartGame = players.length >= 2; // Changed to 2 for testing
  const isCurrentUserHost = currentPlayerId === currentHostId;

  // Handle socket events for real-time updates
  useEffect(() => {
    // Listen for lobby updates
    const unsubscribeUpdate = socketService.on('lobby:update', (data) => {
      console.log('Lobby update:', data.lobby);
      const lobby = data.lobby;

      // Update players list
      setPlayers(lobby.players.map(p => ({
        id: p.playerId,
        name: p.name,
        isHost: p.isHost,
        isBot: p.isBot || false,
        joinedAt: new Date(p.joinedAt).getTime(),
      })));

      // Update host if changed
      setCurrentHostId(lobby.hostPlayerId);
    });

    // Listen for player joined
    const unsubscribeJoined = socketService.on('lobby:player-joined', (data) => {
      console.log('Player joined:', data.player.name);
    });

    // Listen for player left
    const unsubscribeLeft = socketService.on('lobby:player-left', (data) => {
      console.log('Player left:', data.playerId);
    });

    // Listen for being kicked
    const unsubscribeKicked = socketService.on('lobby:kicked', (data) => {
      Alert.alert('Removed from Lobby', data.message, [
        { text: 'OK', onPress: () => navigation.navigate('Home') }
      ]);
    });

    // Listen for game started
    const unsubscribeGameStarted = socketService.on('game:started', (data) => {
      console.log('Game started:', data.gameState);
      // Navigate to bidding screen
      navigation.replace('Bidding', {
        gameState: data.gameState,
        currentPlayerId,
        currentPlayerName,
      });
    });

    // Listen for errors
    const unsubscribeError = socketService.on('lobby:error', (data) => {
      Alert.alert('Error', data.message);
      setIsStarting(false);
    });

    return () => {
      unsubscribeUpdate();
      unsubscribeJoined();
      unsubscribeLeft();
      unsubscribeKicked();
      unsubscribeGameStarted();
      unsubscribeError();
    };
  }, [navigation, currentPlayerId, currentPlayerName]);

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

  // Real-time updates are handled by socket events above

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
      // Send kick event to backend
      socketService.kickPlayer(playerToRemove.id);
    }
    setRemoveModalVisible(false);
    setPlayerToRemove(null);
  };

  const cancelRemovePlayer = () => {
    setRemoveModalVisible(false);
    setPlayerToRemove(null);
  };

  const handleStartGame = () => {
    if (!canStartGame || isStarting) return;

    setIsStarting(true);

    // Send start game event to backend
    socketService.startGame();

    // Navigation will happen when we receive game:started event
    console.log("Starting game...");
  };

  const handleAddBot = () => {
    // Check if lobby is full
    if (players.length >= (gameSettings.maxPlayers || 8)) {
      Alert.alert('Lobby Full', 'Cannot add more players to the lobby.');
      return;
    }
    socketService.addBot();
  };

  const handleLeaveLobby = () => {
    // Send leave event to backend
    socketService.leaveLobby();
    navigation.goBack();
  };

  // Get host name from players list
  const displayHostName = useMemo(() => {
    const host = players.find(p => p.isHost);
    return host ? host.name : hostName;
  }, [players, hostName]);

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
    // All player counts use the normal card size (cards wrap across rows).
    const isCompact = false;

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
      // Split all players (host first) into a top row of 3 and a bottom row of
      // the rest, e.g. 5 players => 3 on top, 2 on bottom.
      const ordered = host ? [host, ...others] : others;
      const firstRow = ordered.slice(0, 3);
      const secondRow = ordered.slice(3);

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
                size={isCompact ? "compact" : "normal"}
              />
            ))}
          </View>
          <View style={styles.playersRow}>
            {secondRow.map((player) => (
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
        </View>
      );
    }

    // 7-8 players: split all players (host first) into a top row of 4 and a
    // bottom row of the rest, e.g. 7 => 4 top / 3 bottom, 8 => 4 top / 4 bottom.
    const ordered = host ? [host, ...others] : others;
    const topRow = ordered.slice(0, 4);
    const bottomRow = ordered.slice(4);

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
              size="normal"
            />
          ))}
        </View>
        <View style={styles.playersRow}>
          {bottomRow.map((player) => (
            <PlayerCard
              key={player.id}
              player={player}
              isHost={isCurrentUserHost}
              canRemove={isCurrentUserHost}
              onRemove={handleRemovePlayer}
              size="normal"
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
                <Text style={styles.title}>{displayHostName}'s Lobby</Text>

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
                  Players: {players.length}/{gameSettings.maxPlayers || 8}
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
                        Need at least 2 players to start
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

            {/* Add Bot button - top right corner (host only, when not full) */}
            {isCurrentUserHost &&
              players.length < (gameSettings.maxPlayers || 8) && (
                <Animated.View
                  style={[styles.addBotTopRight, { opacity: fadeAnim }]}
                >
                  <TouchableOpacity
                    onPress={handleAddBot}
                    activeOpacity={0.8}
                    style={styles.addBotButton}
                  >
                    <LinearGradient
                      colors={["#FFB347", "#FF8C00", "#FF6600"]}
                      style={styles.addBotButtonGradient}
                    >
                      <Text style={styles.addBotButtonText}>+ Add Bot</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </Animated.View>
              )}

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
    color: "#FFFFFF",
    marginTop: 6,
    letterSpacing: 1,
  },
  centerSection: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    // Shift the player list up a little from the vertical center.
    paddingBottom: 25,
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
  addBotTopRight: {
    position: "absolute",
    top: "5%",
    right: "3%",
  },
  addBotButton: {
    borderRadius: 12,
    overflow: "hidden",
    shadowColor: "#FF6600",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  addBotButtonGradient: {
    paddingVertical: 10,
    paddingHorizontal: 30,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  addBotButtonText: {
    fontSize: 18,
    fontFamily: "Bangers_400Regular",
    color: "#FFFFFF",
    textShadowColor: "rgba(100, 50, 0, 0.8)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
    letterSpacing: 1,
    textAlign: "center",
    paddingHorizontal: 5,
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
    textAlign: "center",
    paddingHorizontal: 5,
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
