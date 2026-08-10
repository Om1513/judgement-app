import React from "react";
import { View, Text } from "react-native";
import { useScaledStyles } from "../utils/responsive";

export default function SettingCard({ label, children, compact = false }) {
  const styles = useScaledStyles(rawStyles);
  return (
    <View style={[styles.container, compact && styles.containerCompact]}>
      <Text style={[styles.label, compact && styles.labelCompact]}>{label}</Text>
      <View style={styles.content}>{children}</View>
      <View style={styles.underline} />
    </View>
  );
}

const rawStyles = {
  container: {
    marginVertical: 8,
    marginHorizontal: 20,
    alignItems: "center",
    overflow: "visible",
  },
  containerCompact: {
    marginVertical: 0,
    marginHorizontal: 2,
    flex: 1,
    overflow: "visible",
  },
  label: {
    fontSize: 20,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    textShadowColor: "rgba(0, 0, 0, 0.5)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
    letterSpacing: 1,
    marginBottom: 10,
    textAlign: "center",
  },
  labelCompact: {
    fontSize: 18,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
    overflow: "visible",
  },
  underline: {
    width: "80%",
    height: 3,
    backgroundColor: "rgba(255, 215, 0, 0.8)",
    borderRadius: 2,
  },
};
