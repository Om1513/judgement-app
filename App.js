import "./global.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { View, StyleSheet } from "react-native";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";
import { Asset } from "expo-asset";
import { useFonts, Bangers_400Regular } from "@expo-google-fonts/bangers";
import { Inter_400Regular, Inter_700Bold } from "@expo-google-fonts/inter";
import AppNavigator from "./src/navigation/AppNavigator";
import LandscapeGate from "./src/components/LandscapeGate";
import RestoringOverlay from "./src/components/RestoringOverlay";
import audioManager from "./src/services/audioManager";
import { RestoreStatus, runColdStartRestore } from "./src/services/sessionRestore";

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

  // Cold-start auto-rejoin lives here rather than on HomeScreen, and there is
  // exactly one of it. Home mounts, unmounts and remounts as the player moves
  // around; the restore must run once per launch, own the single navigation it
  // produces, and not care which screen happens to be on top.
  // Starts IDLE, not RESTORING: the restoring screen appears only once a saved
  // session has actually been found, so a first-ever launch is never told the
  // app is restoring a game that does not exist.
  const [restoreStatus, setRestoreStatus] = useState(RestoreStatus.IDLE);
  // The screen the server told us to open, held until navigation is ready. The
  // restore usually finishes before the container mounts, so this is the normal
  // path, not an edge case.
  const pendingTargetRef = useRef(null);
  const restoreStartedRef = useRef(false);
  const navigatedRef = useRef(false);

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

  /**
   * Performs the one navigation a restore is allowed to make.
   *
   * Guarded twice over - by the target being consumed and by `navigatedRef` -
   * because this is called from two places (the restore finishing, and
   * navigation becoming ready) and whichever happens second must do nothing.
   *
   * `reset` rather than `navigate`: it replaces the whole stack with
   * Home -> target, so there is no half-built history, and Leave Lobby / Leave
   * Game still has a Home to go back to.
   */
  const applyRestoreTarget = useCallback(() => {
    const target = pendingTargetRef.current;
    if (!target || navigatedRef.current || !navigationRef.current?.isReady()) {
      return;
    }

    navigatedRef.current = true;
    pendingTargetRef.current = null;
    navigationRef.current.reset({
      index: 1,
      routes: [{ name: "Home" }, { name: target.name, params: target.params }],
    });
    setRestoreStatus(RestoreStatus.RESTORED);
  }, []);

  useEffect(() => {
    // React 18 double-invokes effects in dev; a second restore would mean a
    // second socket and a second navigation.
    if (restoreStartedRef.current) {
      return;
    }
    restoreStartedRef.current = true;

    let cancelled = false;
    runColdStartRestore({
      onSessionFound: () => {
        if (!cancelled) setRestoreStatus(RestoreStatus.RESTORING);
      },
    })
      .then((result) => {
        if (cancelled) return;
        if (result.status === RestoreStatus.RESTORED) {
          pendingTargetRef.current = result.target;
          // Stays on the restoring screen until the navigation actually lands,
          // so Home is never shown for a frame on the way into the game.
          applyRestoreTarget();
          return;
        }
        // NO_SESSION and FAILED both mean "carry on as a normal launch" - a
        // session that merely could not be reached is kept for the next one, and
        // no error is shown for what is usually just an expired game.
        setRestoreStatus(result.status);
      })
      .catch((error) => {
        console.log("[Session] Restore failed unexpectedly:", error?.message);
        if (!cancelled) setRestoreStatus(RestoreStatus.FAILED);
      });

    return () => {
      cancelled = true;
    };
  }, [applyRestoreTarget]);

  const handleNavigationReady = () => {
    syncMusicToRoute();
    applyRestoreTarget();
  };

  if (!fontsLoaded || !imagesReady) {
    return <View style={styles.boot} />;
  }

  return (
    // Every screen pins controls to the screen edges, so the whole app needs the
    // cutout metrics. `initialWindowMetrics` supplies them synchronously on the
    // first frame - without it the first paint uses zero insets and the corner
    // buttons visibly jump once the real values arrive.
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <LandscapeGate>
        {/* One flexed box so the restoring overlay has something full-screen to
            pin itself to, and LandscapeGate keeps its single child. */}
        <View style={styles.root}>
          <NavigationContainer
            ref={navigationRef}
            theme={DarkTheme}
            onReady={handleNavigationReady}
            onStateChange={syncMusicToRoute}
          >
            <AppNavigator />
          </NavigationContainer>
          {/* Over the navigator, not instead of it: the stack is already mounted
              and warming up underneath, so the restored screen appears the
              moment the answer arrives. */}
          {restoreStatus === RestoreStatus.RESTORING && <RestoringOverlay />}
        </View>
      </LandscapeGate>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BOOT_BACKGROUND,
  },
  boot: {
    flex: 1,
    backgroundColor: BOOT_BACKGROUND,
  },
});
