// Where the winner screen and final scoreboard lead once a game is over.
//
// When a game ends the server hands its table straight back to the lobby it was
// dealt from - same code, host, settings and seats - and broadcasts that lobby.
// These are the two ways a player gets there: by tapping through the final
// scoreboard, or by the host dealing the next game while they are still reading
// the results.

import { useEffect } from "react";
import socketService from "../services/socket";
import { lobbyRouteParams } from "../services/sessionRestore";

/**
 * Opens the lobby the finished game came from, with Home beneath it so leaving
 * the lobby still lands on Home and Back can never reach the finished game.
 *
 * Falls back to Home (and forgets the session, as before) when there is no
 * waiting lobby to return to - the lobby was closed, we are no longer seated in
 * it, or an older server never handed the table back. Returns which it did.
 */
export function goBackToLobby(navigation, { currentPlayerId, currentPlayerName }) {
  const lobby = socketService.currentLobby;
  const seated = lobby?.players?.some((p) => p.playerId === currentPlayerId);

  if (lobby && lobby.status === "WAITING" && seated) {
    navigation.reset({
      index: 1,
      routes: [
        { name: "Home" },
        { name: "Lobby", params: lobbyRouteParams(lobby, currentPlayerId, currentPlayerName) },
      ],
    });
    return "Lobby";
  }

  // Nothing to go back to, so this is the end of the session - reopening the
  // app must not drop them back onto a finished scoreboard.
  void socketService.clearSavedSession();
  navigation.navigate("Home");
  return "Home";
}

/**
 * Takes a player still on the results straight into the next game when the host
 * deals it. They are seated in it either way, so waiting for them to tap
 * through first would only leave the table bidding without them.
 */
export function useFollowNextGame(navigation, { currentPlayerId, currentPlayerName }) {
  useEffect(() => {
    const unsubscribe = socketService.on("game:started", (data) => {
      navigation.reset({
        index: 1,
        routes: [
          { name: "Home" },
          {
            name: "Bidding",
            params: { gameState: data.gameState, currentPlayerId, currentPlayerName },
          },
        ],
      });
    });
    return () => unsubscribe();
  }, [navigation, currentPlayerId, currentPlayerName]);
}
