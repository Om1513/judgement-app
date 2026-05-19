import React, { useState, useEffect } from "react";
import {
  View,
  ImageBackground,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  TouchableWithoutFeedback,
  Alert,
  Animated,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { useFonts, Bangers_400Regular } from "@expo-google-fonts/bangers";
import AsyncStorage from "@react-native-async-storage/async-storage";
import GameButton from "../components/GameButton";
import Sparkles from "../components/Sparkles";
import PlayerNameInput from "../components/PlayerNameInput";

const PLAYER_NAME_KEY = "@kachuful_player_name";

export default function HomeScreen({ navigation }) {
  const [playerName, setPlayerName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const overlayOpacity = useState(new Animated.Value(0))[0];

  const [fontsLoaded] = useFonts({
    Bangers_400Regular,
  });

  // Load saved player name on mount
  useEffect(() => {
    loadPlayerName();

    // Keyboard listeners
    const keyboardDidShowListener = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      () => {
        setIsKeyboardVisible(true);
        Animated.timing(overlayOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }).start();
      }
    );
    const keyboardDidHideListener = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => {
        setIsKeyboardVisible(false);
        Animated.timing(overlayOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }).start();
      }
    );

    return () => {
      keyboardDidShowListener.remove();
      keyboardDidHideListener.remove();
    };
  }, []);

  const loadPlayerName = async () => {
    try {
      const savedName = await AsyncStorage.getItem(PLAYER_NAME_KEY);
      if (savedName) {
        setPlayerName(savedName);
      }
    } catch (error) {
      console.log("Error loading player name:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const savePlayerName = async (name) => {
    try {
      await AsyncStorage.setItem(PLAYER_NAME_KEY, name);
    } catch (error) {
      console.log("Error saving player name:", error);
    }
  };

  const handleNameChange = (text) => {
    setPlayerName(text);
  };

  const handleNameSubmit = (name) => {
    if (name.trim()) {
      savePlayerName(name.trim());
    }
  };

  const validateAndProceed = (action) => {
    const trimmedName = playerName.trim();
    if (!trimmedName) {
      Alert.alert(
        "Name Required",
        "Please enter your player name to continue.",
        [{ text: "OK" }]
      );
      return false;
    }
    savePlayerName(trimmedName);
    action();
    return true;
  };

  const handleCreateGame = () => {
    validateAndProceed(() => {
      navigation.navigate("CreateGame", { playerName: playerName.trim() });
    });
  };

  const handleJoinGame = () => {
    validateAndProceed(() => {
      navigation.navigate("JoinGame", { playerName: playerName.trim() });
    });
  };

  const dismissKeyboard = () => {
    Keyboard.dismiss();
  };

  if (!fontsLoaded || isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#FFD000" />
      </View>
    );
  }

  return (
    <TouchableWithoutFeedback onPress={dismissKeyboard}>
      <View style={styles.container}>
        <ImageBackground
          source={require("../../assets/background.png")}
          style={styles.background}
          resizeMode="cover"
        >
          {/* Sparkle effects */}
          <Sparkles />

          {/* Bottom gradient overlay for better visibility */}
          <LinearGradient
            colors={["transparent", "rgba(26, 16, 48, 0.2)", "rgba(26, 16, 48, 0.5)"]}
            style={styles.bottomGradient}
          />

          {/* Dark overlay when keyboard is open */}
          <Animated.View
            style={[
              styles.darkOverlay,
              { opacity: overlayOpacity },
            ]}
            pointerEvents={isKeyboardVisible ? "auto" : "none"}
          />

          {/* Buttons - fixed at bottom, hidden when keyboard is open */}
          {!isKeyboardVisible && (
            <View style={styles.buttonContainer}>
              <View style={styles.buttonRow}>
                <GameButton
                  title="Create Game"
                  onPress={handleCreateGame}
                  delay={200}
                />
                <GameButton
                  title="Join Game"
                  onPress={handleJoinGame}
                  delay={400}
                />
              </View>
            </View>
          )}

          {/* Input field - moves with keyboard */}
          <KeyboardAvoidingView
            style={styles.keyboardAvoid}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            keyboardVerticalOffset={Platform.OS === "ios" ? 10 : 20}
          >
            <View style={[
              styles.inputContainer,
              isKeyboardVisible && styles.inputContainerFocused,
            ]}>
              <PlayerNameInput
                value={playerName}
                onChangeText={handleNameChange}
                onSubmit={handleNameSubmit}
                placeholder="Enter Your Name"
              />
            </View>
          </KeyboardAvoidingView>

          <StatusBar style="light" hidden />
        </ImageBackground>
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: "#1a1030",
    alignItems: "center",
    justifyContent: "center",
  },
  background: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
  bottomGradient: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: "50%",
  },
  darkOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15, 8, 30, 0.75)",
  },
  keyboardAvoid: {
    position: "absolute",
    bottom: "18%",
    left: 0,
    right: 0,
  },
  inputContainer: {
    alignItems: "center",
  },
  inputContainerFocused: {
    marginBottom: 10,
  },
  buttonContainer: {
    position: "absolute",
    bottom: "2%",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  buttonRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
});
