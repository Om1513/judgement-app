import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  ImageBackground,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Keyboard,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { useFonts, Bangers_400Regular } from "@expo-google-fonts/bangers";

// Floating particle component
const FloatingParticle = ({ delay, startX, startY, size }) => {
  const floatAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const startAnimation = () => {
      floatAnim.setValue(0);
      opacityAnim.setValue(0);

      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(opacityAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(floatAnim, {
            toValue: 1,
            duration: 4000,
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(opacityAnim, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: true,
        }),
      ]).start(() => startAnimation());
    };

    startAnimation();
  }, []);

  const translateY = floatAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -80],
  });

  const translateX = floatAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, 15, 0],
  });

  return (
    <Animated.View
      style={[
        styles.particle,
        {
          left: startX,
          top: startY,
          width: size,
          height: size,
          opacity: opacityAnim,
          transform: [{ translateY }, { translateX }],
        },
      ]}
    />
  );
};

export default function JoinGameScreen({ navigation, route }) {
  const playerName = route.params?.playerName || "Player";
  const [isReady, setIsReady] = useState(false);
  const [lobbyCode, setLobbyCode] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [isInvalid, setIsInvalid] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const buttonScaleAnim = useRef(new Animated.Value(1)).current;

  const inputRef = useRef(null);

  const [fontsLoaded] = useFonts({
    Bangers_400Regular,
  });

  const isValidCode = lobbyCode.length === 6;

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

  const handleGoBack = () => {
    navigation.goBack();
  };

  const handleCodeChange = (text) => {
    // Only allow alphanumeric characters, auto-uppercase, max 6 chars
    const sanitized = text
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6);
    setLobbyCode(sanitized);
    setIsInvalid(false);
  };

  const triggerShake = () => {
    setIsInvalid(true);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  };

  const handleJoinLobby = () => {
    if (!isValidCode) {
      triggerShake();
      return;
    }

    Keyboard.dismiss();

    // Navigate to lobby as a non-host player
    // In real app, this would first validate the code with backend
    navigation.navigate("Lobby", {
      lobbyCode: lobbyCode,
      hostName: "Host", // Would come from backend
      hostId: "host-1", // Would come from backend
      isHost: false,
      currentPlayerId: `player-${Date.now()}`,
      currentPlayerName: playerName,
      gameSettings: {}, // Would come from backend
    });
  };

  const handleButtonPressIn = () => {
    if (isValidCode) {
      Animated.spring(buttonScaleAnim, {
        toValue: 0.95,
        friction: 5,
        useNativeDriver: true,
      }).start();
    }
  };

  const handleButtonPressOut = () => {
    Animated.spring(buttonScaleAnim, {
      toValue: 1,
      friction: 3,
      tension: 40,
      useNativeDriver: true,
    }).start();
  };

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

  // Generate particles
  const particles = [
    { delay: 0, startX: "20%", startY: "40%", size: 4 },
    { delay: 500, startX: "75%", startY: "45%", size: 3 },
    { delay: 1000, startX: "30%", startY: "55%", size: 5 },
    { delay: 1500, startX: "70%", startY: "50%", size: 3 },
    { delay: 2000, startX: "25%", startY: "48%", size: 4 },
    { delay: 2500, startX: "80%", startY: "42%", size: 3 },
  ];

  return (
    <View style={styles.container}>
      <ImageBackground
        source={require("../../assets/background_without_title.png")}
        style={styles.background}
        resizeMode="cover"
      >
        {/* Only show content after transition completes */}
        {isReady && (
          <>
            {/* Overlay gradient */}
            <LinearGradient
              colors={["rgba(26, 16, 48, 0.7)", "transparent", "rgba(26, 16, 48, 0.5)"]}
              locations={[0, 0.4, 1]}
              style={styles.overlayGradient}
            />

            {/* Floating particles */}
            {particles.map((particle, index) => (
              <FloatingParticle
                key={index}
                delay={particle.delay}
                startX={particle.startX}
                startY={particle.startY}
                size={particle.size}
              />
            ))}

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
              {/* Title */}
              <View style={styles.topSection}>
                <Text style={styles.title}>Join Lobby</Text>
              </View>

              {/* Center Section - Input */}
              <View style={styles.centerSection}>
                <Animated.View
                  style={[
                    styles.inputSection,
                    { transform: [{ translateX: shakeAnim }] },
                  ]}
                >
                  <TextInput
                    ref={inputRef}
                    style={[
                      styles.input,
                      isFocused && styles.inputFocused,
                      isInvalid && styles.inputInvalid,
                    ]}
                    value={lobbyCode}
                    onChangeText={handleCodeChange}
                    placeholder="Enter Code"
                    placeholderTextColor="rgba(255, 220, 120, 0.85)"
                    selectionColor="#FFD700"
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={6}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                  />

                  {/* Character count indicator */}
                  <View style={styles.charCountContainer}>
                    {[0, 1, 2, 3, 4, 5].map((index) => (
                      <View
                        key={index}
                        style={[
                          styles.charDot,
                          index < lobbyCode.length && styles.charDotFilled,
                        ]}
                      />
                    ))}
                  </View>
                </Animated.View>
              </View>

              {/* Bottom Section - Join Button */}
              <View style={styles.bottomSection}>
                <Animated.View
                  style={[
                    styles.buttonContainer,
                    { transform: [{ scale: buttonScaleAnim }] },
                  ]}
                >
                  <TouchableOpacity
                    onPress={handleJoinLobby}
                    onPressIn={handleButtonPressIn}
                    onPressOut={handleButtonPressOut}
                    activeOpacity={1}
                    style={styles.touchable}
                  >
                    <View style={[
                      styles.shadowLayer,
                      !isValidCode && styles.shadowLayerDisabled,
                    ]}>
                      <LinearGradient
                        colors={isValidCode
                          ? ["#FFE55C", "#FFCC00", "#FFB800", "#F5A623"]
                          : ["#8A7A6A", "#6A5A4A", "#5A4A3A", "#4A3A2A"]
                        }
                        start={{ x: 0, y: 0 }}
                        end={{ x: 0, y: 1 }}
                        style={styles.buttonGradient}
                      >
                        {/* Glossy highlight overlay */}
                        <LinearGradient
                          colors={["rgba(255,255,255,0.5)", "rgba(255,255,255,0.2)", "transparent"]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 0, y: 0.6 }}
                          style={styles.glossOverlay}
                        />

                        <Text style={[
                          styles.buttonText,
                          !isValidCode && styles.buttonTextDisabled,
                        ]}>
                          Join Lobby
                        </Text>

                        {/* Inner bottom highlight */}
                        <View style={styles.innerHighlight} />
                      </LinearGradient>
                    </View>
                  </TouchableOpacity>

                  {/* Valid code glow effect */}
                  {isValidCode && (
                    <View style={styles.buttonGlowEffect} />
                  )}
                </Animated.View>
              </View>
            </Animated.View>

            {/* Back button */}
            <Animated.View
              style={[
                styles.backButtonContainer,
                { opacity: fadeAnim },
              ]}
            >
              <TouchableOpacity style={styles.backButton} onPress={handleGoBack}>
                <LinearGradient
                  colors={["#5E3A9E", "#3D2272"]}
                  style={styles.backButtonGradient}
                >
                  <Text style={styles.backButtonText}>Back</Text>
                </LinearGradient>
              </TouchableOpacity>
            </Animated.View>
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
    overflow: "visible",
  },
  overlayGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  particle: {
    position: "absolute",
    backgroundColor: "#FFD700",
    borderRadius: 10,
    shadowColor: "#FFD700",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
  },
  content: {
    flex: 1,
    paddingHorizontal: 30,
    paddingTop: 15,
    overflow: "visible",
  },
  topSection: {
    alignItems: "center",
    marginBottom: 5,
    overflow: "visible",
  },
  title: {
    fontSize: 52,
    fontFamily: "Bangers_400Regular",
    color: "#FFD700",
    textShadowColor: "rgba(0, 0, 0, 0.8)",
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 6,
    letterSpacing: 2,
    textAlign: "center",
    paddingHorizontal: 20,
  },
  centerSection: {
    flex: 1,
    justifyContent: "flex-start",
    alignItems: "center",
    paddingTop: 60,
  },
  inputSection: {
    alignItems: "center",
  },
  input: {
    width: 280,
    height: 50,
    fontSize: 26,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    textAlign: "center",
    letterSpacing: 6,
    borderBottomWidth: 3,
    borderBottomColor: "rgba(255, 215, 0, 0.8)",
    textShadowColor: "rgba(0, 0, 0, 0.5)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  inputFocused: {
    borderBottomColor: "#FFD700",
  },
  inputInvalid: {
    borderBottomColor: "#FF6B6B",
  },
  charCountContainer: {
    flexDirection: "row",
    marginTop: 15,
    gap: 8,
  },
  charDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "rgba(94, 58, 158, 0.5)",
    borderWidth: 1,
    borderColor: "#5E3A9E",
  },
  charDotFilled: {
    backgroundColor: "#FFD700",
    borderColor: "#FFD700",
    shadowColor: "#FFD700",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
  },
  bottomSection: {
    alignItems: "center",
    paddingBottom: 15,
  },
  buttonContainer: {
    alignItems: "center",
  },
  touchable: {
    borderRadius: 18,
  },
  shadowLayer: {
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
  shadowLayerDisabled: {
    backgroundColor: "#2A2A2A",
    borderColor: "#3A3A3A",
    shadowOpacity: 0.4,
  },
  buttonGradient: {
    paddingVertical: 14,
    paddingHorizontal: 50,
    borderRadius: 14,
    minWidth: 200,
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
  buttonText: {
    fontSize: 24,
    color: "#FFFFFF",
    textShadowColor: "rgba(80, 40, 20, 0.8)",
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 4,
    letterSpacing: 0.5,
    fontFamily: "Bangers_400Regular",
    textAlign: "center",
    paddingHorizontal: 5,
  },
  buttonTextDisabled: {
    color: "#888888",
    textShadowColor: "rgba(0, 0, 0, 0.5)",
  },
  innerHighlight: {
    position: "absolute",
    bottom: 4,
    left: 15,
    right: 15,
    height: 2,
    backgroundColor: "rgba(255,255,255,0.3)",
    borderRadius: 2,
  },
  buttonGlowEffect: {
    position: "absolute",
    top: -5,
    left: -5,
    right: -5,
    bottom: -5,
    borderRadius: 23,
    backgroundColor: "transparent",
    shadowColor: "#FFD700",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 15,
    zIndex: -1,
  },
  backButtonContainer: {
    position: "absolute",
    bottom: "5%",
    left: "3%",
  },
  backButton: {
    borderRadius: 12,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 8,
  },
  backButtonGradient: {
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 12,
  },
  backButtonText: {
    fontSize: 18,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
  },
});
