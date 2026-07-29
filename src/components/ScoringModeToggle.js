import React, { useRef, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import audioManager from "../services/audioManager";

const OPTIONS = ["+10", "+1"];

export default function ScoringModeToggle({ value, onChange }) {
  const glowAnims = useRef(OPTIONS.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    // Animate glow for selected option
    OPTIONS.forEach((option, index) => {
      Animated.timing(glowAnims[index], {
        toValue: option === value ? 1 : 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    });
  }, [value]);

  return (
    <View style={styles.container}>
      {OPTIONS.map((option, index) => {
        const isSelected = option === value;

        return (
          <TouchableOpacity
            key={option}
            onPress={() => {
              audioManager.playSound("buttonPop");
              onChange(option);
            }}
            // Raised while selected so its halo shows on the seam side instead
            // of being painted over by the other half.
            style={[styles.optionButton, isSelected && styles.optionButtonSelected]}
          >
            {/* Halo on all four sides of the selected half. */}
            <Animated.View
              style={[
                styles.glow,
                { opacity: glowAnims[index] },
              ]}
            />

            <LinearGradient
              colors={isSelected
                ? ["#FFE55C", "#FFCC00", "#F5A623"]
                : ["#3D2272", "#2A1654"]
              }
              style={[
                styles.optionGradient,
                isSelected && styles.optionSelected,
                index === 0 && styles.optionFirst,
                index === OPTIONS.length - 1 && styles.optionLast,
              ]}
            >
              <Text
                style={[
                  styles.optionText,
                  isSelected && styles.optionTextSelected,
                ]}
              >
                {option}
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    overflow: "visible",
    // The settings card lays this out in a flex row alongside the ⓘ. Without
    // this the row can compress the toggle, which crops "+10" horizontally.
    flexShrink: 0,
  },
  optionButton: {
    position: "relative",
  },
  optionButtonSelected: {
    // Draw order, not geometry: nothing moves, the selected half simply paints
    // after its neighbour so its halo is not clipped at the seam.
    zIndex: 1,
  },
  // The halo surrounds the selected half on all four sides, seam included.
  // Two things make that work, and both were the original bugs:
  //   - the unselected half is drawn opaque, so the gold cannot shine *through*
  //     it (that was "+1 lights up the whole side")
  //   - the selected half is raised above its neighbour, so the neighbour cannot
  //     paint *over* the halo (that was "+10's right edge stays dim")
  glow: {
    position: "absolute",
    top: -5,
    left: -5,
    right: -5,
    bottom: -5,
    backgroundColor: "#FFD700",
    borderRadius: 14,
    shadowColor: "#FFD700",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 10,
    elevation: 8,
  },
  optionGradient: {
    // Trimmed from 12 to offset the 6px of vertical padding now carried by the
    // label itself, so the pill's overall height is unchanged.
    paddingVertical: 9,
    // Equal-width halves, sized so the wider label ("+10") has room to spare:
    // 78 - 2x16 leaves 46px for a glyph run of roughly 34px.
    paddingHorizontal: 16,
    minWidth: 78,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#5E3A9E",
  },
  optionSelected: {
    borderColor: "#3D2272",
  },
  optionFirst: {
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
    borderRightWidth: 1,
  },
  optionLast: {
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
    borderLeftWidth: 1,
  },
  optionText: {
    fontSize: 20,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    textAlign: "center",
    // Bangers' digits rise above its cap height and its glyphs slant right, so
    // "+10" overshoots the box the font reports for itself and the tops get
    // shaved. The other Bangers labels in the app get away with it because they
    // are larger (24-38) or letters only; this is the smallest, and the only one
    // with digits. Padding the Text's own box is the metric-independent fix -
    // the same trick RoundSelector uses for the round number's overhang -
    // whereas a fixed lineHeight only moves where the crop lands.
    paddingTop: 5,
    paddingBottom: 1,
    paddingHorizontal: 3,
    textShadowColor: "rgba(0, 0, 0, 0.5)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  optionTextSelected: {
    color: "#3D2272",
    textShadowColor: "rgba(255, 255, 255, 0.3)",
  },
});
