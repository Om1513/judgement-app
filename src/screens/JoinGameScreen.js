import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  ImageBackground,
  StyleSheet,
  Animated,
  TouchableOpacity,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { useFonts, Bangers_400Regular } from "@expo-google-fonts/bangers";

export default function JoinGameScreen({ navigation, route }) {
  const playerName = route.params?.playerName || "Player";
  const [isReady, setIsReady] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  const [fontsLoaded] = useFonts({
    Bangers_400Regular,
  });

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
            {/* Top gradient for better text visibility */}
            <LinearGradient
              colors={["rgba(26, 16, 48, 0.6)", "transparent"]}
              style={styles.topGradient}
            />

            {/* Content */}
            <Animated.View
              style={[
                styles.content,
                {
                  opacity: fadeAnim,
                  transform: [{ translateY: slideAnim }],
                },
              ]}
            >
              <Text style={styles.title}>Join Game</Text>
              <Text style={styles.subtitle}>Welcome, {playerName}!</Text>

              {/* Placeholder content */}
              <View style={styles.placeholderContainer}>
                <Text style={styles.placeholderText}>Enter game code to join...</Text>
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
  topGradient: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "30%",
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 50,
    width: "100%",
    overflow: "visible",
  },
  title: {
    fontSize: 42,
    fontFamily: "Bangers_400Regular",
    color: "#FFD700",
    textShadowColor: "rgba(0, 0, 0, 0.8)",
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 6,
    marginBottom: 10,
    textAlign: "center",
    paddingHorizontal: 10,
  },
  subtitle: {
    fontSize: 24,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    textShadowColor: "rgba(0, 0, 0, 0.6)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 4,
    marginBottom: 30,
    textAlign: "center",
    paddingHorizontal: 10,
  },
  placeholderContainer: {
    backgroundColor: "rgba(61, 34, 114, 0.7)",
    paddingVertical: 20,
    paddingHorizontal: 40,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "#5E3A9E",
  },
  placeholderText: {
    fontSize: 18,
    fontFamily: "Bangers_400Regular",
    color: "#FFF8E7",
    textAlign: "center",
  },
  backButtonContainer: {
    position: "absolute",
    bottom: "5%",
    left: "5%",
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
