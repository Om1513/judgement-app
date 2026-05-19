import React, { useRef, useEffect, useState } from "react";
import {
  View,
  TextInput,
  StyleSheet,
  Animated,
  Keyboard,
} from "react-native";

export default function PlayerNameInput({
  value,
  onChangeText,
  onSubmit,
  placeholder = "Enter Your Name"
}) {
  const [isFocused, setIsFocused] = useState(false);
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const inputRef = useRef(null);

  useEffect(() => {
    // Entry animation
    Animated.spring(scaleAnim, {
      toValue: 1,
      delay: 100,
      friction: 6,
      tension: 40,
      useNativeDriver: true,
    }).start();
  }, []);

  const handleFocus = () => {
    setIsFocused(true);
  };

  const handleBlur = () => {
    setIsFocused(false);
    // Trim and validate on blur
    if (onChangeText && value) {
      const trimmed = value.trim();
      onChangeText(trimmed);
    }
  };

  const handleSubmitEditing = () => {
    const trimmed = value?.trim() || "";
    if (trimmed && onSubmit) {
      onSubmit(trimmed);
    }
    Keyboard.dismiss();
  };

  return (
    <Animated.View
      style={[
        styles.container,
        {
          transform: [{ scale: scaleAnim }],
        },
      ]}
    >
      <TextInput
        ref={inputRef}
        style={[
          styles.input,
          isFocused && styles.inputFocused,
        ]}
        value={value}
        onChangeText={onChangeText}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onSubmitEditing={handleSubmitEditing}
        placeholder={placeholder}
        placeholderTextColor="rgba(255, 220, 120, 0.85)"
        selectionColor="#FFD700"
        autoCapitalize="words"
        autoCorrect={false}
        maxLength={20}
        returnKeyType="done"
        textAlign="center"
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    marginBottom: 12,
  },
  input: {
    width: 280,
    height: 50,
    fontSize: 22,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    textAlign: "center",
    letterSpacing: 1,
    borderBottomWidth: 3,
    borderBottomColor: "rgba(255, 215, 0, 0.8)",
    textShadowColor: "rgba(0, 0, 0, 0.5)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  inputFocused: {
    borderBottomColor: "#FFD700",
  },
});
