import React, { useEffect, useRef, useState, useMemo } from "react";
import {
  View,
  Text,
  ImageBackground,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Alert,
  Share,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import * as Clipboard from "expo-clipboard";
import { useFonts, Bangers_400Regular } from "@expo-google-fonts/bangers";

import GameButton from "../components/GameButton";
import PlayerCard from "../components/PlayerCard";
import RemovePlayerModal from "../components/RemovePlayerModal";
import socketService from "../services/socket";
import CircleIconButton from "../components/CircleIconButton";
import SoundToggleButton from "../components/SoundToggleButton";
import ScreenHeader from "../components/ScreenHeader";
import audioManager from "../services/audioManager";

export default function LobbyScreen({ navigation, route }) {
  // Get params from navigation
  const {
    lobbyCode = "ABC123",
    hostName = "Player",
    hostId = "host-1",
    gameSettings = {},
    currentPlayerId = "host-1",
    currentPlayerName = "Player",
    initialPlayers = [],
  } = route.params || {};

  const [isReady, setIsReady] = useState(false);
  const [copied, setCopied] = useState(false);
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

  // Real-time updates are handled by socket events above

  const handleCopyCode = async () => {
    audioManager.playSound("buttonPop");
    await Clipboard.setStringAsync(lobbyCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShareCode = async () => {
    audioManager.playSound("buttonPop");
    // Keep the code on the clipboard too, so it's ready to paste after sharing.
    await Clipboard.setStringAsync(lobbyCode);
    try {
      await Share.share({
        // Put the code alone on its own line so it's a single long-press to
        // select and copy in any messaging app.
        message: `Come play Judgement with me! 🃏\n\nJoin my game with this lobby code:\n${lobbyCode}`,
      });
    } catch (error) {
      // User dismissed the share sheet or it failed - nothing to do.
      console.log("Share cancelled or failed:", error?.message);
    }
  };

  const handleRemovePlayer = (player) => {
    if (!player) return;
    setPlayerToRemove(player);
  };

  const confirmRemovePlayer = () => {
    if (playerToRemove) {
      socketService.kickPlayer(playerToRemove.id);
    }
    setPlayerToRemove(null);
  };

  const cancelRemovePlayer = () => {
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
              {/* Shared top bar: controls and title on one line. */}
              <ScreenHeader
                title={`${displayHostName}'s Lobby`}
                left={
                  <>
                    <CircleIconButton
                      inline
                      glyph="‹"
                      glyphStyle={styles.backGlyph}
                      accessibilityLabel="Leave lobby"
                      onPress={handleLeaveLobby}
                    />
                    <SoundToggleButton inline />
                  </>
                }
                right={
                  isCurrentUserHost &&
                  players.length < (gameSettings.maxPlayers || 8) ? (
                    <CircleIconButton
                      inline
                      glyph="🤖"
                      glyphStyle={styles.addBotGlyph}
                      accessibilityLabel="Add bot player"
                      onPress={handleAddBot}
                    />
                  ) : null
                }
              />

              <View style={styles.topSection}>

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
                          {copied ? "COPIED" : "COPY"}
                        </Text>
                      </LinearGradient>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.shareButton}
                      onPress={handleShareCode}
                      activeOpacity={0.7}
                    >
                      <LinearGradient
                        colors={["#5E3A9E", "#3D2272"]}
                        style={styles.shareButtonGradient}
                      >
                        <Text style={styles.shareButtonText}>SHARE</Text>
                      </LinearGradient>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Player count */}
                <Text style={styles.playerCount}>
                  Players: {players.length}/{gameSettings.maxPlayers || 8}
                </Text>

                {/* Why Start Game is disabled, sitting with the count it refers
                    to. The slot keeps its height when the message clears, so
                    nothing below it shifts as players join. */}
                <View style={styles.minPlayersSlot}>
                  {isCurrentUserHost && !canStartGame && (
                    <Text style={styles.minPlayersText}>
                      Need at least 2 players to start
                    </Text>
                  )}
                </View>
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
                    {/* Same GameButton as Create/Join on the home screen, so
                        the primary action looks the same everywhere. Disabled
                        only recolours it - the geometry is identical, so
                        enabling it as players join moves nothing. */}
                    <GameButton
                      title="Start Game"
                      onPress={handleStartGame}
                      disabled={!canStartGame}
                    />
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


            {/* Remove Player confirmation - an in-screen overlay (no native
                Modal), so it stays in landscape with no orientation flicker. */}
            <RemovePlayerModal
              visible={!!playerToRemove}
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
    backgroundColor: "#1a1030",
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
    paddingTop: 22,
  },
  // Negative top margin pulls the code box and player count up into part of the
  // header bar's 12pt bottom margin, tightening them to the title without
  // moving the title itself. 6pt of clearance is left.
  topSection: {
    alignItems: "center",
    marginTop: -6,
    marginBottom: 10,
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
  shareButton: {
    borderRadius: 8,
    overflow: "hidden",
    marginLeft: 8,
    borderWidth: 1,
    borderColor: "#FFD700",
  },
  shareButtonGradient: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  shareButtonText: {
    fontSize: 12,
    fontFamily: "Bangers_400Regular",
    color: "#FFD700",
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
  // paddingTop pushes Start Game down away from the player list; paddingBottom
  // stays small so it doesn't run off the bottom of a landscape screen.
  bottomSection: {
    alignItems: "center",
    paddingTop: 14,
    paddingBottom: 8,
  },
  startButtonContainer: {
    alignItems: "center",
    position: "relative",
  },
  // Fixed height so the row still occupies space once the message clears -
  // otherwise the player list would jump upward the moment a second player
  // joined, at the same instant the button changed colour.
  minPlayersSlot: {
    height: 20,
    justifyContent: "center",
  },
  minPlayersText: {
    fontSize: 14,
    fontFamily: "Bangers_400Regular",
    color: "#FF6B6B",
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
  // Emoji render larger than text glyphs at the same point size and carry their
  // own colour, so this is sized down and the gold glow dropped.
  addBotGlyph: {
    fontSize: 24,
    lineHeight: 28,
    textShadowColor: "transparent",
  },
  // The chevron sits high and small in its em box next to the note glyph, so
  // nudge it onto the optical centre and size it up to match.
  backGlyph: {
    fontSize: 34,
    lineHeight: 38,
    marginTop: -3,
  },
});
