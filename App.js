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
import RejoinPrompt from "./src/components/RejoinPrompt";
import audioManager from "./src/services/audioManager";
import socketService from "./src/services/socket";
import {
  RestoreStatus,
  resolveRestoreTarget,
  runColdStartRestore,
} from "./src/services/sessionRestore";

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

  // The game the server is holding for us, played by the bot until we say
  // otherwise. Lives here, alongside the restore, because it is the same
  // question - "where should this player be?" - and there must be exactly one
  // answer to it: two places asking would produce two navigations.
  //
  // It is deliberately NOT only a cold-start concern. The same offer arrives when
  // a phone that was backgrounded past its grace period comes back with the game
  // screen still mounted, and it has to be asked there too.
  const [rejoinOffer, setRejoinOffer] = useState(null);
  const [rejoinBusy, setRejoinBusy] = useState(false);

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
   * Replaces the stack with Home -> target.
   *
   * `reset` rather than `navigate`: there is no half-built history to unwind, and
   * Leave Lobby / Leave Game still has a Home to go back to. The single place any
   * session decision is allowed to move the user, so a cold-start restore and an
   * accepted rejoin cannot land on different screens by different routes.
   */
  const openTarget = useCallback((target) => {
    if (!target || !navigationRef.current?.isReady()) {
      return false;
    }
    navigationRef.current.reset({
      index: 1,
      routes: [{ name: "Home" }, { name: target.name, params: target.params }],
    });
    return true;
  }, []);

  /**
   * Performs the one navigation the cold-start restore is allowed to make.
   *
   * Guarded twice over - by the target being consumed and by `navigatedRef` -
   * because this is called from two places (the restore finishing, and
   * navigation becoming ready) and whichever happens second must do nothing.
   */
  const applyRestoreTarget = useCallback(() => {
    const target = pendingTargetRef.current;
    if (!target || navigatedRef.current) {
      return;
    }
    if (!openTarget(target)) {
      return;
    }

    navigatedRef.current = true;
    pendingTargetRef.current = null;
    setRestoreStatus(RestoreStatus.RESTORED);
  }, [openTarget]);

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
        if (result.status === RestoreStatus.REJOIN_AVAILABLE) {
          // Deliberately no navigation: the prompt goes up over Home and the
          // player decides. Nothing about the game is entered until they do.
          setRejoinOffer(result.offer);
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

  // A rejoin offer can also arrive long after launch: a phone that was
  // backgrounded past its grace period reconnects with the game screen still
  // mounted, and the server's answer is the same REJOIN_AVAILABLE. Subscribing
  // for the whole app lifetime - here, once - is what makes the warm and cold
  // cases one flow instead of two.
  useEffect(() => {
    return socketService.onSession((payload) => {
      if (payload?.reason === "REJOIN_AVAILABLE" && payload.rejoin) {
        setRejoinOffer(payload.rejoin);
        return;
      }
      // Only an answer that actually settles the question takes the prompt down:
      // restored, gone for good, or discarded. RESTORE_FAILED settles nothing -
      // dismissing on it would leave the player with a game they can still
      // rejoin and no way left to say so.
      const settled =
        payload?.restored === true ||
        payload?.reason === "SESSION_NOT_FOUND" ||
        payload?.reason === "SESSION_DISCARDED";
      if (settled) {
        setRejoinOffer(null);
      }
    });
  }, []);

  /** REJOIN GAME: take the seat back, then open whatever phase it is now in. */
  const handleRejoin = useCallback(async () => {
    setRejoinBusy(true);
    try {
      const payload = await socketService.rejoinSession();
      const target = resolveRestoreTarget(payload, {
        playerId: socketService.playerId,
        playerName: socketService.playerName,
      });

      if (target) {
        setRejoinOffer(null);
        // Consume any pending cold-start target: this navigation supersedes it.
        pendingTargetRef.current = null;
        navigatedRef.current = true;
        openTarget(target);
        setRestoreStatus(RestoreStatus.RESTORED);
      } else {
        // The server never answered, or answered with something we cannot open.
        // The prompt deliberately stays up: dismissing it would leave the player
        // on Home with no way back into a game that is still theirs.
        console.log("[Session] Rejoin produced no screen to open");
      }
    } finally {
      setRejoinBusy(false);
    }
  }, [openTarget]);

  /**
   * DISCARD: we are not going back to that game.
   *
   * The game keeps running for everybody else with the bot in our seat; all that
   * ends is our claim on it. Home, with a clean stack.
   */
  const handleDiscard = useCallback(async () => {
    setRejoinBusy(true);
    try {
      await socketService.discardSession();
    } finally {
      setRejoinOffer(null);
      setRejoinBusy(false);
      if (navigationRef.current?.isReady()) {
        navigatedRef.current = true;
        pendingTargetRef.current = null;
        navigationRef.current.reset({ index: 0, routes: [{ name: "Home" }] });
      }
      setRestoreStatus(RestoreStatus.NO_SESSION);
    }
  }, []);

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
          {restoreStatus === RestoreStatus.RESTORING && !rejoinOffer && <RestoringOverlay />}
          {/* Above the restoring overlay in the tree so an offer that arrives
              during a cold start replaces the spinner rather than sitting under
              it. */}
          <RejoinPrompt
            visible={!!rejoinOffer}
            offer={rejoinOffer}
            busy={rejoinBusy}
            onRejoin={handleRejoin}
            onDiscard={handleDiscard}
          />
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
