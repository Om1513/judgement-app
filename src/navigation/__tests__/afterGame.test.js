// Leaving the results of a finished game.
//
// The server hands the table back to its lobby as soon as the game ends, so the
// final scoreboard's button leads there - with the same params the lobby screen
// gets from Create/Join - and a player still reading the results is taken into
// the next game if the host deals it first.

import React from "react";
import { render } from "@testing-library/react-native";

import { goBackToLobby, useFollowNextGame } from "../afterGame";
import socketService from "../../services/socket";

jest.mock("../../services/socket", () => {
  const listeners = {};
  return {
    __esModule: true,
    default: {
      currentLobby: null,
      clearSavedSession: jest.fn(() => Promise.resolve()),
      on: jest.fn((event, callback) => {
        listeners[event] = callback;
        return () => delete listeners[event];
      }),
      __emit: (event, data) => listeners[event]?.(data),
    },
  };
});

const navigation = () => ({ reset: jest.fn(), navigate: jest.fn() });
const me = { currentPlayerId: "p-om", currentPlayerName: "Om" };

const waitingLobby = {
  id: "lobby-1",
  code: "ABC123",
  status: "WAITING",
  hostPlayerId: "p-om",
  hostName: "Om",
  settings: { rounds: 4, orderMode: "Kachuful", scoringMode: "+10", maxPlayers: 8 },
  players: [
    { playerId: "p-om", name: "Om", isHost: true, isBot: false, connected: true },
    { playerId: "p-yukta", name: "Yukta", isHost: false, isBot: false, connected: true },
    { playerId: "b-1", name: "Bot", isHost: false, isBot: true, connected: true },
  ],
};

beforeEach(() => {
  socketService.currentLobby = null;
  jest.clearAllMocks();
});

describe("goBackToLobby", () => {
  it("opens the lobby the game came from, as it was before the deal", () => {
    socketService.currentLobby = waitingLobby;
    const nav = navigation();

    expect(goBackToLobby(nav, me)).toBe("Lobby");

    expect(nav.reset).toHaveBeenCalledWith({
      index: 1,
      routes: [
        { name: "Home" },
        {
          name: "Lobby",
          params: {
            lobbyCode: "ABC123",
            lobbyId: "lobby-1",
            hostName: "Om",
            hostId: "p-om",
            isHost: true,
            currentPlayerId: "p-om",
            currentPlayerName: "Om",
            gameSettings: waitingLobby.settings,
            initialPlayers: waitingLobby.players,
          },
        },
      ],
    });
  });

  it("keeps the saved session, so reopening the app lands in the lobby", () => {
    socketService.currentLobby = waitingLobby;
    goBackToLobby(navigation(), me);
    expect(socketService.clearSavedSession).not.toHaveBeenCalled();
  });

  it("goes Home, as before, when there is no lobby to return to", () => {
    const nav = navigation();

    expect(goBackToLobby(nav, me)).toBe("Home");
    expect(nav.navigate).toHaveBeenCalledWith("Home");
    expect(nav.reset).not.toHaveBeenCalled();
    expect(socketService.clearSavedSession).toHaveBeenCalled();
  });

  it("goes Home when the lobby has not been handed back yet", () => {
    socketService.currentLobby = { ...waitingLobby, status: "IN_GAME" };
    expect(goBackToLobby(navigation(), me)).toBe("Home");
  });

  it("goes Home when we are no longer seated in the lobby", () => {
    socketService.currentLobby = {
      ...waitingLobby,
      players: waitingLobby.players.filter((p) => p.playerId !== "p-om"),
    };
    expect(goBackToLobby(navigation(), me)).toBe("Home");
  });
});

describe("useFollowNextGame", () => {
  function Results({ nav }) {
    useFollowNextGame(nav, me);
    return null;
  }

  it("takes a player still on the results into the game the host just dealt", () => {
    const nav = navigation();
    render(<Results nav={nav} />);

    const gameState = { id: "game-2", status: "BIDDING", currentRound: 1 };
    socketService.__emit("game:started", { gameState });

    expect(nav.reset).toHaveBeenCalledWith({
      index: 1,
      routes: [
        { name: "Home" },
        { name: "Bidding", params: { gameState, currentPlayerId: "p-om", currentPlayerName: "Om" } },
      ],
    });
  });

  it("stops listening once the results are left", () => {
    const nav = navigation();
    const { unmount } = render(<Results nav={nav} />);
    unmount();

    socketService.__emit("game:started", { gameState: { id: "game-2" } });
    expect(nav.reset).not.toHaveBeenCalled();
  });
});
