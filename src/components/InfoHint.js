// A quiet "ⓘ" that opens a small explainer modal.
//
// Deliberately not a button: no background, no border, no gradient, no glow -
// just a grey glyph sitting next to the control it explains. It should read as
// an affordance you can ignore, which is why the detail lives behind a tap
// instead of crowding the settings card.
//
// Closes on the ✕ or on a tap anywhere outside the panel.
//
//   <InfoHint title="TRUMP ORDER">
//     <Text>...</Text>
//   </InfoHint>

import React, { useState } from "react";
import { View, Text, Modal, Pressable } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import audioManager from "../services/audioManager";
import { useScaledStyles } from "../utils/responsive";

export default function InfoHint({
  title,
  children,
  label = "More information",
  style,
}) {
  const styles = useScaledStyles(rawStyles);
  const [open, setOpen] = useState(false);

  const show = () => {
    audioManager.playSound("buttonPop");
    setOpen(true);
  };

  const close = () => {
    audioManager.playSound("buttonPop");
    setOpen(false);
  };

  return (
    <>
      <Pressable
        onPress={show}
        // The glyph is small on purpose, so the tap area is widened instead of
        // the icon.
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={[styles.trigger, style]}
      >
        <Text style={styles.glyph}>ⓘ</Text>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={close}
        supportedOrientations={["landscape", "landscape-left", "landscape-right"]}
      >
        {/* Scrim closes on tap; the panel swallows its own presses. */}
        <Pressable
          style={styles.backdrop}
          onPress={close}
          testID="info-hint-backdrop"
          accessibilityLabel="Close"
        >
          <Pressable style={styles.panelPress} onPress={() => {}}>
            <LinearGradient
              colors={["rgba(61, 34, 114, 0.98)", "rgba(26, 16, 48, 0.99)"]}
              style={styles.panel}
            >
              <View style={styles.titleRow}>
                {title ? <Text style={styles.title}>{title}</Text> : null}
                <Pressable
                  onPress={close}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  style={styles.closeButton}
                >
                  <Text style={styles.closeGlyph}>✕</Text>
                </Pressable>
              </View>

              <View style={styles.body}>{children}</View>
            </LinearGradient>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const rawStyles = {
  trigger: {
    marginLeft: 8,
    // No padding/background: the hit area comes from hitSlop, so the glyph does
    // not push the control it sits beside out of alignment.
    alignItems: "center",
    justifyContent: "center",
  },
  glyph: {
    // Matches the 22px glyphs it sits beside (the order toggle's 🔄 and value
    // text), so the row reads as one line of controls.
    fontSize: 22,
    lineHeight: 26,
    // The palette's muted grey: clearly secondary to the gold controls, but
    // bright enough to be noticed as something you can tap.
    color: "#C9BEDC",
  },

  backdrop: {
    flex: 1,
    backgroundColor: "rgba(10, 6, 18, 0.8)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  panelPress: {
    // Small: this is a footnote, not a screen.
    maxWidth: 420,
  },
  panel: {
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "#FFD700",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  title: {
    fontSize: 20,
    fontFamily: "Bangers_400Regular",
    color: "#FFD700",
    letterSpacing: 2,
    marginRight: 16,
  },
  closeButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(42, 22, 84, 0.9)",
    borderWidth: 1.5,
    borderColor: "#5E3A9E",
    // Keeps the ✕ hard right even when there is no title.
    marginLeft: "auto",
  },
  closeGlyph: {
    fontSize: 14,
    lineHeight: 16,
    color: "#FFF8E7",
  },
  body: {
    alignItems: "flex-start",
  },
};
