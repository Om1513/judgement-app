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
import { touchSlop, useResponsive, useScaledStyles } from "../utils/responsive";

// Four players per row, whatever the lobby size.
const PLAYERS_PER_ROW = 4;

export default function LobbyScreen({ navigation, route }) {
  const styles = useScaledStyles(rawStyles);
  const r = useResponsive();
  // The content box's own inset. Plainly scaled: the landscape cutout inset
  // runs to ~59pt and applied on top of the header's own offset, which dragged
  // the back / sound pair and the add-bot button away from the top corners.
  const contentInsets = {
    paddingLeft: r.s(20),
    paddingRight: r.s(20),
    paddingTop: r.s(22),
  };
  // The copy / share icons are deliberately small - they must not out-shout the
  // code - so the tap area is widened rather than the button.
  const codeActionSlop = touchSlop(r.s(30));
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

  // Players in rows of four, host first. One rule for every lobby size, so the
  // grid stays a grid: 5 players read as 4 + 1, 8 as 4 + 4. The row itself still
  // wraps, which only matters on a viewport too narrow for four cards.
  const playerRows = useMemo(() => {
    const host = players.find((p) => p.isHost);
    const ordered = host
      ? [host, ...players.filter((p) => !p.isHost)]
      : players;

    const rows = [];
    for (let i = 0; i < ordered.length; i += PLAYERS_PER_ROW) {
      rows.push(ordered.slice(i, i + PLAYERS_PER_ROW));
    }
    return rows;
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

  const renderPlayers = () => (
    <View style={styles.playersContainer}>
      {playerRows.map((row, index) => (
        <View key={`row-${index}`} style={styles.playersRow}>
          {row.map((player) => (
            <PlayerCard
              key={player.id}
              player={player}
              isHost={isCurrentUserHost}
              // PlayerCard never offers to remove the host, so this can be the
              // same for every card.
              canRemove={isCurrentUserHost}
              onRemove={handleRemovePlayer}
              size="normal"
            />
          ))}
        </View>
      ))}
    </View>
  );

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
                contentInsets,
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
                    {/* Copy, then share. Glyphs rather than COPY / SHARE
                        wordmarks: the code is the thing to read here, and two
                        text pills either side of it competed with it. Both are
                        square, so the pair reads as one control cluster.

                        Both glyphs come from blocks this app already renders
                        elsewhere (Dingbats for ✕ ✦, Arrows for →), so neither
                        can turn up as a tofu box on a device where the rest of
                        the UI is fine. */}
                    <TouchableOpacity
                      style={styles.codeAction}
                      onPress={handleCopyCode}
                      activeOpacity={0.7}
                      hitSlop={codeActionSlop}
                      accessibilityRole="button"
                      accessibilityLabel={copied ? "Lobby code copied" : "Copy lobby code"}
                    >
                      <LinearGradient
                        colors={copied ? ["#4CAF50", "#388E3C"] : ["#FFD700", "#F5A623"]}
                        style={styles.codeActionGradient}
                      >
                        {/* The tick is the confirmation the "COPIED" label used
                            to give, in the same space. */}
                        <Text style={[styles.codeActionGlyph, copied && styles.codeActionGlyphDone]}>
                          {copied ? "✓" : "❐"}
                        </Text>
                      </LinearGradient>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.codeAction, styles.shareAction]}
                      onPress={handleShareCode}
                      activeOpacity={0.7}
                      hitSlop={codeActionSlop}
                      accessibilityRole="button"
                      accessibilityLabel="Share lobby code"
                    >
                      <LinearGradient
                        colors={["#5E3A9E", "#3D2272"]}
                        style={styles.codeActionGradient}
                      >
                        <Text style={[styles.codeActionGlyph, styles.shareGlyph]}>↗</Text>
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

const rawStyles = {
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
  },
  // Negative top margin pulls the code box, player count and min-players
  // warning up through the header bar's 12pt bottom margin, tightening them to
  // the title without moving the title itself.
  //
  // -12 consumes that margin exactly, so this block now sits flush against the
  // header's box. There is a little further to go - the title's glyphs only fill
  // 46 of the bar's 54pt - but past about -16 the code box starts to touch the
  // title, so that is the hard stop rather than the arbitrary value it looks.
  topSection: {
    alignItems: "center",
    marginTop: -12,
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
  // Set at the same size as the code itself, so "CODE:" and the code read as one
  // line rather than a caption with a value after it. Kept cream, not gold, so
  // the code is still the thing your eye lands on.
  codeLabel: {
    fontSize: 22,
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
  // Square icon buttons, same gradients as the wordmark pills they replace:
  // gold for copy, purple with a gold edge for share. Sized to the code's cap
  // height so the cluster sits level with the text beside it.
  codeAction: {
    borderRadius: 8,
    overflow: "hidden",
  },
  codeActionGradient: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  codeActionGlyph: {
    fontSize: 17,
    lineHeight: 21,
    color: "#2A1654",
    textAlign: "center",
    includeFontPadding: false,
  },
  // The tick reads small next to the copy glyph at the same point size.
  codeActionGlyphDone: {
    fontSize: 19,
    color: "#0E2E12",
  },
  shareAction: {
    marginLeft: 8,
    borderWidth: 1,
    borderColor: "#FFD700",
  },
  shareGlyph: {
    color: "#FFD700",
    fontSize: 19,
  },
  playerCount: {
    fontSize: 19,
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
    height: 23,
    justifyContent: "center",
  },
  minPlayersText: {
    fontSize: 16,
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
};
