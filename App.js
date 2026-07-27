import "./global.css";
import { useEffect, useRef, useState } from "react";
import { View, StyleSheet } from "react-native";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { Asset } from "expo-asset";
import { useFonts, Bangers_400Regular } from "@expo-google-fonts/bangers";
import { Inter_400Regular, Inter_700Bold } from "@expo-google-fonts/inter";
import AppNavigator from "./src/navigation/AppNavigator";
import audioManager from "./src/services/audioManager";

// Matches the splash background in app.json, so the handoff from the native
// splash into the first screen is invisible rather than a flash.
const BOOT_BACKGROUND = "#1a1030";

const DarkTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    // Deliberately the splash/artwork purple rather than near-black: this
    // colour is what shows through underneath screens during a transition, and
    // near-black read as a blank flash between screens.
    background: BOOT_BACKGROUND,
  },
};

// Every screen background, decoded up front. Without this the first visit to a
// screen decodes its image mid-transition and the empty container shows through
// as a black frame before the artwork appears.
const BACKGROUND_IMAGES = [
  require("./assets/background.png"),
  require("./assets/background_without_title.png"),
  require("./assets/game.png"),
  require("./assets/winner_screen.png"),
];

export default function App() {
  const navigationRef = useRef(null);
  const [imagesReady, setImagesReady] = useState(false);

  // Loading the fonts here, once, is what stops individual screens from
  // rendering a font-less placeholder on their way in. Screens still call
  // useFonts, but by then it resolves from cache instead of blocking a paint.
  const [fontsLoaded] = useFonts({
    Bangers_400Regular,
    Inter_400Regular,
    Inter_700Bold,
  });

  useEffect(() => {
    // A failed prefetch must not strand the app on the boot screen - the images
    // would just decode lazily as before.
    Asset.loadAsync(BACKGROUND_IMAGES)
      .catch((error) => console.log("[assets] preload failed:", error))
      .finally(() => setImagesReady(true));
  }, []);

  // Music is ambient across the whole app, home included, so it starts as soon
  // as navigation is ready and is never stopped while the app is open. Only the
  // sound toggle silences it.
  //
  // Owning this here rather than in each screen is what keeps it seamless: a
  // navigation asks the manager to play something already playing, which is a
  // no-op, so Home -> Lobby -> Bidding -> GameTable never restarts the track. A
  // screen-owned player would restart on every one of those mounts.
  //
  // Kept on the route callback rather than a one-off call so that making a
  // particular screen silent later is a one-line change here.
  const syncMusicToRoute = () => {
    audioManager.playBackgroundMusic();
  };

  if (!fontsLoaded || !imagesReady) {
    return <View style={styles.boot} />;
  }

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={DarkTheme}
      onReady={syncMusicToRoute}
      onStateChange={syncMusicToRoute}
    >
      <AppNavigator />
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    backgroundColor: BOOT_BACKGROUND,
  },
});
