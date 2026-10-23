// The lobby the app thinks it is in, as tracked by the socket service.
//
// After a game the final scoreboard sends players back to `currentLobby`, so it
// must only ever be a lobby the server has actually handed back. The one from
// before the deal is still marked waiting - starting a game sends no lobby
// update - and trusting it opened a lobby the server refused to start.

jest.mock("socket.io-client", () => {
  const handlers = {};
  const socket = {
    connected: false,
    on: jest.fn((event, cb) => {
      (handlers[event] = handlers[event] || []).push(cb);
    }),
    off: jest.fn((event, cb) => {
      handlers[event] = (handlers[event] || []).filter((h) => h !== cb);
    }),
    emit: jest.fn(),
  };
  return {
    io: jest.fn(() => socket),
    __serverSends: (event, data) => (handlers[event] || []).forEach((h) => h(data)),
  };
});

jest.mock("../session", () => ({
  saveSession: jest.fn(() => Promise.resolve(null)),
  clearSession: jest.fn(() => Promise.resolve()),
}));

import { __serverSends } from "socket.io-client";
import socketService from "../socket";

const lobby = (status) => ({
  id: "lobby-1",
  code: "ABC123",
  status,
  hostPlayerId: "p-om",
  players: [{ playerId: "p-om", name: "Om" }],
});

beforeAll(async () => {
  const connecting = socketService.connect("Om");
  // Let connect() get past loading the client id and open the socket.
  await new Promise((resolve) => setTimeout(resolve, 0));
  __serverSends("connected", { playerId: "p-om" });
  await connecting;
});

beforeEach(() => {
  socketService.currentLobby = null;
});

describe("currentLobby", () => {
  it("follows the lobby while waiting in it", () => {
    __serverSends("lobby:created", { lobby: lobby("WAITING") });
    expect(socketService.currentLobby).toEqual(lobby("WAITING"));
  });

  it("forgets the pre-game lobby once the game starts", () => {
    __serverSends("lobby:update", { lobby: lobby("WAITING") });
    __serverSends("game:started", { gameState: { id: "game-1" } });

    expect(socketService.currentLobby).toBeNull();
  });

  it("picks up the lobby the server hands back after the game", () => {
    __serverSends("lobby:update", { lobby: lobby("WAITING") });
    __serverSends("game:started", { gameState: { id: "game-1" } });
    __serverSends("lobby:update", { lobby: lobby("WAITING") });

    expect(socketService.currentLobby).toEqual(lobby("WAITING"));
  });
});
