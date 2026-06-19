import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";

export default function PlayerCard({
  player,
  isHost,
  canRemove,
  onRemove,
  size = "normal",
}) {
  const isCompact = size === "compact";
  const isBot = player.isBot || false;

  // Get avatar colors based on player type
  const getAvatarColors = () => {
    if (isBot) return ["#FF8C00", "#FF6600"];
    if (player.isHost) return ["#FFD700", "#F5A623"];
    return ["#5E3A9E", "#3D2272"];
  };

  return (
    <View style={[styles.container, isCompact && styles.containerCompact]}>
      <LinearGradient
        colors={["rgba(61, 34, 114, 0.8)", "rgba(42, 22, 84, 0.9)"]}
        style={[styles.card, isCompact && styles.cardCompact]}
      >
        {/* Avatar placeholder */}
        <View style={[styles.avatar, isCompact && styles.avatarCompact]}>
          <LinearGradient
            colors={getAvatarColors()}
            style={styles.avatarGradient}
          >
            <Text style={[styles.avatarText, isCompact && styles.avatarTextCompact]}>
              {isBot ? "🤖" : (player.name || "?").charAt(0).toUpperCase()}
            </Text>
          </LinearGradient>
        </View>

        {/* Player info */}
        <View style={styles.info}>
          <Text style={[styles.name, isCompact && styles.nameCompact]}>
            {player.name}
          </Text>

          {/* Host badge */}
          {player.isHost && (
            <View style={styles.hostBadge}>
              <LinearGradient
                colors={["#FFD700", "#F5A623"]}
                style={styles.hostBadgeGradient}
              >
                <Text style={styles.hostBadgeText}>HOST</Text>
              </LinearGradient>
            </View>
          )}

          {/* Bot badge */}
          {isBot && (
            <View style={styles.botBadge}>
              <LinearGradient
                colors={["#FF8C00", "#FF6600"]}
                style={styles.botBadgeGradient}
              >
                <Text style={styles.botBadgeText}>BOT</Text>
              </LinearGradient>
            </View>
          )}
        </View>

        {/* Remove button - only for host viewing non-host players */}
        {canRemove && !player.isHost && (
          <TouchableOpacity
            style={styles.removeButton}
            onPress={() => onRemove(player)}
            activeOpacity={0.7}
          >
            <LinearGradient
              colors={["#FF6B6B", "#CC5555"]}
              style={styles.removeButtonGradient}
            >
              <Text style={styles.removeButtonText}>X</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}
      </LinearGradient>

      {/* Glow effect for host */}
      {player.isHost && <View style={styles.hostGlow} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    margin: 8,
    position: "relative",
  },
  containerCompact: {
    margin: 5,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 15,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "#5E3A9E",
    minWidth: 180,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
  cardCompact: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    minWidth: 150,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: "hidden",
    marginRight: 12,
    borderWidth: 2,
    borderColor: "#FFD700",
  },
  avatarCompact: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 8,
  },
  avatarGradient: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 20,
    fontFamily: "Bangers_400Regular",
    color: "#FFF",
    textShadowColor: "rgba(0, 0, 0, 0.5)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
    textAlign: "center",
    paddingHorizontal: 5,
  },
  avatarTextCompact: {
    fontSize: 14,
  },
  info: {
    flex: 1,
    justifyContent: "center",
  },
  name: {
    fontSize: 18,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    textShadowColor: "rgba(0, 0, 0, 0.5)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
    letterSpacing: 0.5,
  },
  nameCompact: {
    fontSize: 14,
  },
  hostBadge: {
    marginTop: 4,
    alignSelf: "flex-start",
  },
  hostBadgeGradient: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  hostBadgeText: {
    fontSize: 10,
    fontFamily: "Bangers_400Regular",
    color: "#2A1654",
    letterSpacing: 1,
  },
  botBadge: {
    marginTop: 4,
    alignSelf: "flex-start",
  },
  botBadgeGradient: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  botBadgeText: {
    fontSize: 10,
    fontFamily: "Bangers_400Regular",
    color: "#FFFFFF",
    letterSpacing: 1,
  },
  removeButton: {
    marginLeft: 8,
    borderRadius: 12,
    overflow: "hidden",
  },
  removeButtonGradient: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  removeButtonText: {
    fontSize: 14,
    fontFamily: "Bangers_400Regular",
    color: "#FFF",
    textAlign: "center",
    paddingHorizontal: 5,
  },
  hostGlow: {
    position: "absolute",
    top: -3,
    left: -3,
    right: -3,
    bottom: -3,
    borderRadius: 19,
    backgroundColor: "transparent",
    shadowColor: "#FFD700",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    zIndex: -1,
  },
});
