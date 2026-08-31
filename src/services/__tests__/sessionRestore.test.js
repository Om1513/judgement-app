// Cold-start auto-rejoin, from the client's side.
//
// Two halves:
//
//   * resolveRestoreTarget - the navigation decision. Pure, so every game phase
//     can be checked directly: a player who closed the app while bidding must
//     come back to the bidding screen, not to a generic "in a game" one.
//   * runColdStartRestore - the lifecycle. What matters here is not the happy
//     path but the three ways it can end without a game: no saved session, a
//     session the server says is gone, and a server that never answered. Only
//     the middle one is allowed to erase the saved session.
//
// The socket is stubbed rather than mocked wholesale, so the sequencing the real
// service guarantees (the session answer can land before connect() resolves) is
// reproduced exactly.

import AsyncStorage from "@react-native-async-storage/async-storage";

import { RestoreStatus, resolveRestoreTarget, runColdStartRestore } from "../sessionRestore";
import { loadSession, saveSession } from "../session";
import socketService from "../socket";

jest.mock("../socket", () => ({
  __esModule: true,
  default: {
    playerId: null,
    connect: jest.fn(),
    onSession: jest.fn(),
  },
}));

const LOBBY = {
  id: "lobby-1",
  code: "ABC123",
  hostPlayerId: "p-om",
  hostName: "Om",
  status: "WAITING",
  settings: { rounds: 4, orderMode: "Kachuful", scoringMode: "+10", maxPlayers: 4 },
  playerCount: 3,
  canStart: true,
  players: [
    { playerId: "p-om", name: "Om", isHost: true, isBot: false, connected: true, seatPosition: 0 },
    { playerId: "p-yukta", name: "Yukta", isHost: false, isBot: false, connected: true, seatPosition: 1 },
    { playerId: "p-bot", name: "Bot Ravi", isHost: false, isBot: true, connected: true, seatPosition: 2 },
  ],
};

const gameStateWith = (status) => ({
  id: "game-1",
  lobbyId: "lobby-1",
  status,
  currentRound: 2,
  totalRounds: 4,
  players: [],
  myHand: [{ suit: "spades", rank: "A" }],
  currentTurnPlayerId: "p-om",
  roundState: { roundNumber: 2, cardsPerPlayer: 2 },
  scores: {},
  isMyTurn: true,
  trumpOrder: [],
  settings: { orderMode: "Kachuful", scoringMode: "+10" },
});

/**
 * Stands the socket service up for one launch: `connect` resolves (or rejects),
 * and the session answer is delivered to whoever subscribed.
 */
function stubSocket({ answer, answerDelay = 0, connectError = null, playerId = "p-om" } = {}) {
  const listeners = new Set();
  socketService.playerId = connectError ? null : playerId;

  socketService.onSession.mockImplementation((callback) => {
    listeners.add(callback);
    return () => listeners.delete(callback);
  });

  socketService.connect.mockImplementation(async () => {
    if (connectError) {
      throw new Error(connectError);
    }
    if (answer !== undefined) {
      // The real server sends the session answer as part of identifying the
      // connection, i.e. around the moment connect() settles.
      setTimeout(() => {
        for (const callback of [...listeners]) callback(answer);
      }, answerDelay);
    }
    return { playerId };
  });

  return { listeners };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  socketService.playerId = null;
});

// ---------------------------------------------------------------------------
// The navigation decision
// ---------------------------------------------------------------------------

describe("resolveRestoreTarget", () => {
  test("a waiting lobby opens the lobby screen with the full lobby state", () => {
    const target = resolveRestoreTarget(
      { restored: true, lobby: LOBBY, gameState: null },
      { playerId: "p-om", playerName: "Om" }
    );

    expect(target.name).toBe("Lobby");
    expect(target.params).toMatchObject({
      lobbyCode: "ABC123",
      lobbyId: "lobby-1",
      hostId: "p-om",
      hostName: "Om",
      isHost: true,
      currentPlayerId: "p-om",
      currentPlayerName: "Om",
      gameSettings: LOBBY.settings,
    });
    // Seats, bots and host badge all come from the server's player list.
    expect(target.params.initialPlayers).toBe(LOBBY.players);
  });

  test("a non-host is restored without host permissions", () => {
    const target = resolveRestoreTarget(
      { restored: true, lobby: LOBBY, gameState: null },
      { playerId: "p-yukta", playerName: "Yukta" }
    );

    expect(target.params.isHost).toBe(false);
    expect(target.params.currentPlayerName).toBe("Yukta");
  });

  test("the server's name for the player wins over the locally saved one", () => {
    const target = resolveRestoreTarget(
      { restored: true, lobby: LOBBY, gameState: null },
      { playerId: "p-yukta", playerName: "stale name" }
    );

    expect(target.params.currentPlayerName).toBe("Yukta");
  });

  test.each([
    ["BIDDING", "Bidding"],
    ["PLAYING", "GameTable"],
    ["HAND_WINNER", "GameTable"],
    ["ROUND_COMPLETE", "ScoreBoard"],
    ["ROUND_SCOREBOARD", "ScoreBoard"],
    ["GAME_OVER", "FinalScoreboard"],
    ["FINAL_WINNER", "FinalScoreboard"],
    ["COMPLETED", "FinalScoreboard"],
  ])("a game in %s restores to %s", (status, route) => {
    const target = resolveRestoreTarget(
      { restored: true, lobby: { ...LOBBY, status: "IN_GAME" }, gameState: gameStateWith(status) },
      { playerId: "p-om", playerName: "Om" }
    );

    expect(target.name).toBe(route);
  });

  test("an in-progress game carries the authoritative state to the screen", () => {
    const gameState = gameStateWith("PLAYING");
    const target = resolveRestoreTarget(
      { restored: true, lobby: { ...LOBBY, status: "IN_GAME" }, gameState },
      { playerId: "p-om", playerName: "Om" }
    );

    expect(target.params.gameState).toBe(gameState);
    expect(target.params.currentPlayerId).toBe("p-om");
  });

  test("the scoreboard phase carries the scoreboard, so the screen is not blank", () => {
    const scoreboard = { gameId: "game-1", rows: [], players: [] };
    const target = resolveRestoreTarget(
      {
        restored: true,
        lobby: { ...LOBBY, status: "IN_GAME" },
        gameState: gameStateWith("ROUND_SCOREBOARD"),
        scoreboard,
      },
      { playerId: "p-om", playerName: "Om" }
    );

    expect(target.params.scoreboard).toBe(scoreboard);
  });

  test("the scoreboard phase still resolves when the server sent no scoreboard", () => {
    const target = resolveRestoreTarget(
      {
        restored: true,
        lobby: { ...LOBBY, status: "IN_GAME" },
        gameState: gameStateWith("ROUND_SCOREBOARD"),
      },
      { playerId: "p-om", playerName: "Om" }
    );

    // Null rather than undefined: the screen asks for it itself in that case.
    expect(target.params.scoreboard).toBeNull();
  });

  test.each([
    ["a refused restore", { restored: false, reason: "SESSION_NOT_FOUND", lobby: null }],
    ["a restore with no lobby", { restored: true, lobby: null, gameState: null }],
    ["a malformed lobby", { restored: true, lobby: { code: "ABC123" }, gameState: null }],
    ["an unknown game phase", { restored: true, lobby: LOBBY, gameState: gameStateWith("WAT") }],
    ["nothing at all", null],
  ])("%s produces no target rather than a crash", (_label, payload) => {
    expect(resolveRestoreTarget(payload, { playerId: "p-om" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The lifecycle
// ---------------------------------------------------------------------------

describe("runColdStartRestore", () => {
  test("no saved session means a normal launch, and the socket is left alone", async () => {
    stubSocket();

    const result = await runColdStartRestore();

    expect(result.status).toBe(RestoreStatus.NO_SESSION);
    expect(socketService.connect).not.toHaveBeenCalled();
  });

  test("the restoring screen is only announced once a session is actually found", async () => {
    const onSessionFound = jest.fn();
    stubSocket();

    await runColdStartRestore({ onSessionFound });
    expect(onSessionFound).not.toHaveBeenCalled();

    await saveSession({ playerId: "p-om", playerName: "Om", lobbyCode: "ABC123" });
    stubSocket({ answer: { restored: true, lobby: LOBBY, gameState: null } });

    await runColdStartRestore({ onSessionFound });
    expect(onSessionFound).toHaveBeenCalledTimes(1);
  });

  test("a saved lobby session restores to the lobby", async () => {
    await saveSession({ playerId: "p-om", playerName: "Om", lobbyCode: "ABC123" });
    stubSocket({ answer: { restored: true, lobby: LOBBY, gameState: null } });

    const result = await runColdStartRestore();

    expect(result.status).toBe(RestoreStatus.RESTORED);
    expect(result.target.name).toBe("Lobby");
    expect(socketService.connect).toHaveBeenCalledWith("Om");
    // Still saved: they are still in it.
    expect(await loadSession()).not.toBeNull();
  });

  test("a saved game session restores to the game screen for the live phase", async () => {
    await saveSession({ playerId: "p-om", playerName: "Om", lobbyCode: "ABC123" });
    stubSocket({
      answer: {
        restored: true,
        lobby: { ...LOBBY, status: "IN_GAME" },
        gameState: gameStateWith("BIDDING"),
      },
    });

    const result = await runColdStartRestore();

    expect(result.status).toBe(RestoreStatus.RESTORED);
    expect(result.target.name).toBe("Bidding");
    expect(result.target.params.gameState.myHand).toHaveLength(1);
  });

  test("an answer that arrives after connect() resolves is still picked up", async () => {
    await saveSession({ playerId: "p-om", playerName: "Om" });
    stubSocket({ answer: { restored: true, lobby: LOBBY, gameState: null }, answerDelay: 25 });

    expect((await runColdStartRestore()).status).toBe(RestoreStatus.RESTORED);
  });

  test("SESSION_NOT_FOUND clears the stale session and stays on Home", async () => {
    await saveSession({ playerId: "p-om", playerName: "Om", lobbyCode: "ABC123" });
    stubSocket({ answer: { restored: false, reason: "SESSION_NOT_FOUND", lobby: null } });

    const result = await runColdStartRestore();

    expect(result.status).toBe(RestoreStatus.NO_SESSION);
    expect(await loadSession()).toBeNull();
  });

  test("an unreachable server keeps the saved session for the next launch", async () => {
    await saveSession({ playerId: "p-om", playerName: "Om", lobbyCode: "ABC123" });
    stubSocket({ connectError: "Connection timeout" });

    const result = await runColdStartRestore();

    expect(result.status).toBe(RestoreStatus.FAILED);
    expect(result.reason).toBe("CONNECT_FAILED");
    expect(await loadSession()).toMatchObject({ lobbyCode: "ABC123" });
  });

  test("a server that connects but never answers keeps the saved session", async () => {
    await saveSession({ playerId: "p-om", playerName: "Om", lobbyCode: "ABC123" });
    stubSocket();

    const result = await runColdStartRestore({ timeoutMs: 20 });

    expect(result.status).toBe(RestoreStatus.FAILED);
    expect(result.reason).toBe("TIMEOUT");
    expect(await loadSession()).toMatchObject({ lobbyCode: "ABC123" });
  });

  test("a restore that failed server-side keeps the saved session", async () => {
    await saveSession({ playerId: "p-om", playerName: "Om", lobbyCode: "ABC123" });
    stubSocket({ answer: { restored: false, reason: "RESTORE_FAILED", lobby: null } });

    const result = await runColdStartRestore();

    expect(result.status).toBe(RestoreStatus.FAILED);
    expect(await loadSession()).toMatchObject({ lobbyCode: "ABC123" });
  });

  test("a malformed answer neither crashes nor erases the session", async () => {
    await saveSession({ playerId: "p-om", playerName: "Om", lobbyCode: "ABC123" });
    stubSocket({ answer: { restored: true, lobby: { nonsense: true } } });

    const result = await runColdStartRestore();

    expect(result.status).toBe(RestoreStatus.FAILED);
    expect(result.reason).toBe("UNSUPPORTED_STATE");
    expect(await loadSession()).toMatchObject({ lobbyCode: "ABC123" });
  });

  test("a discarded session is forgotten, exactly like one that expired", async () => {
    await saveSession({ playerId: "p-om", playerName: "Om", lobbyCode: "ABC123" });
    stubSocket({ answer: { restored: false, reason: "SESSION_DISCARDED", lobby: null } });

    const result = await runColdStartRestore();

    expect(result.status).toBe(RestoreStatus.NO_SESSION);
    expect(await loadSession()).toBeNull();
  });

  test("a session left behind by an explicit leave never gets restored", async () => {
    // Leaving clears the pointer; the launch after it is an ordinary one, and
    // the server is never even asked.
    stubSocket({ answer: { restored: true, lobby: LOBBY, gameState: null } });

    const result = await runColdStartRestore();

    expect(result.status).toBe(RestoreStatus.NO_SESSION);
    expect(socketService.connect).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// A game the bot has taken over
// ---------------------------------------------------------------------------

describe("a launch into a game the bot has taken over", () => {
  const REJOIN_OFFER = {
    gameId: "game-1",
    lobbyCode: "ABC123",
    status: "PLAYING",
    currentRound: 2,
    totalRounds: 4,
  };

  const rejoinAnswer = {
    restored: false,
    reason: "REJOIN_AVAILABLE",
    lobby: null,
    gameState: null,
    rejoin: REJOIN_OFFER,
  };

  test("ends by asking rather than by navigating", async () => {
    await saveSession({ playerId: "p-om", playerName: "Om", lobbyCode: "ABC123" });
    stubSocket({ answer: rejoinAnswer });

    const result = await runColdStartRestore();

    expect(result.status).toBe(RestoreStatus.REJOIN_AVAILABLE);
    expect(result.offer).toEqual(REJOIN_OFFER);
    // Deliberately no target: nothing may move the player until they answer.
    expect(result.target).toBeUndefined();
  });

  test("keeps the saved session, because the game is very much alive", async () => {
    await saveSession({ playerId: "p-om", playerName: "Om", lobbyCode: "ABC123" });
    stubSocket({ answer: rejoinAnswer });

    await runColdStartRestore();

    expect(await loadSession()).toMatchObject({ lobbyCode: "ABC123" });
  });

  test("an offer with nothing in it is treated as a refusal, not a prompt", async () => {
    // A REJOIN_AVAILABLE with no offer is a payload we cannot act on; better to
    // stay on Home with the session intact than to prompt about nothing.
    await saveSession({ playerId: "p-om", playerName: "Om", lobbyCode: "ABC123" });
    stubSocket({ answer: { restored: false, reason: "REJOIN_AVAILABLE", lobby: null } });

    const result = await runColdStartRestore();

    expect(result.status).toBe(RestoreStatus.FAILED);
    expect(await loadSession()).toMatchObject({ lobbyCode: "ABC123" });
  });

  test("the answer to an accepted rejoin maps to a screen like any other restore", () => {
    // The server replies to session:rejoin on the same event, so the navigation
    // decision is the shared one rather than a second code path.
    const gameState = gameStateWith("PLAYING");
    const target = resolveRestoreTarget(
      { restored: true, lobby: { ...LOBBY, status: "IN_GAME" }, gameState },
      { playerId: "p-om", playerName: "Om" }
    );

    expect(target.name).toBe("GameTable");
    expect(target.params.gameState).toBe(gameState);
  });

  test("a rejoin offer cannot be mistaken for a screen to open", () => {
    expect(resolveRestoreTarget(rejoinAnswer, { playerId: "p-om" })).toBeNull();
  });
});
