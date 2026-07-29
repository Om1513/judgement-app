// Starting a game: what gets written, and what must not change afterwards.

import test, { describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { db, resetDatabase, closeDatabase } from '../helpers/db';
import { createLobbyWithPlayers, startGame, getState } from '../helpers/gameFlow';
import { lobbyService } from '../../services/lobby.service';
import { gameService } from '../../services/game.service';
import { getRoundRotation } from '../../utils/rotation';

beforeEach(async () => {
  await resetDatabase();
});

after(async () => {
  await closeDatabase();
});

describe('starting a game', () => {
  test('creates the game record and flips the lobby into play', async () => {
    const { lobbyId, hostId } = await createLobbyWithPlayers(4, { rounds: 5 });
    const gameId = await startGame(lobbyId, hostId);

    const game = await db.game.findUnique({ where: { id: gameId } });
    assert.ok(game, 'game row created');
    assert.equal(game.lobbyId, lobbyId);
    assert.equal(game.status, 'BIDDING');
    assert.equal(game.currentRound, 1);
    assert.equal(game.currentHandSize, 1, 'round 1 deals a single card');

    const lobby = await lobbyService.getLobbyById(lobbyId);
    assert.equal(lobby?.status, 'IN_GAME');
  });

  test('copies the lobby settings onto the game state verbatim', async () => {
    const { lobbyId, hostId } = await createLobbyWithPlayers(4, {
      rounds: 6,
      scoringMode: '+1',
      orderMode: 'Random',
      maxPlayers: 6,
    });
    const gameId = await startGame(lobbyId, hostId);

    const state = await getState(gameId);
    assert.deepEqual(state.settings, {
      rounds: 6,
      orderMode: 'Random',
      scoringMode: '+1',
      maxPlayers: 6,
    });
    assert.equal(state.totalRounds, 6);

    const row = await db.game.findUnique({ where: { id: gameId } });
    assert.equal(row?.totalRounds, 6);
  });

  test('preserves seat order as the turn order', async () => {
    const { lobbyId, hostId, playerIds } = await createLobbyWithPlayers(5);
    const gameId = await startGame(lobbyId, hostId);

    const state = await getState(gameId);
    assert.deepEqual(state.turnOrder, playerIds);
    assert.deepEqual(
      state.players.map((p) => p.id),
      playerIds
    );
    assert.deepEqual(
      state.players.map((p) => p.seatPosition),
      [0, 1, 2, 3, 4]
    );
  });

  test('deals every player one card, all distinct', async () => {
    const { lobbyId, hostId } = await createLobbyWithPlayers(4);
    const gameId = await startGame(lobbyId, hostId);

    const state = await getState(gameId);
    const dealt = state.players.flatMap((p) => p.hand);

    assert.equal(dealt.length, 4, 'four players, one card each');
    for (const player of state.players) {
      assert.equal(player.hand.length, 1);
      assert.equal(player.bid, null);
      assert.equal(player.tricksWon, 0);
      assert.equal(player.score, 0);
    }
    assert.equal(
      new Set(dealt.map((c) => `${c.rank}${c.suit}`)).size,
      4,
      'no card dealt twice'
    );
  });

  test('opens the bidding with the player to the dealer left', async () => {
    const { lobbyId, hostId, playerIds } = await createLobbyWithPlayers(4);
    const gameId = await startGame(lobbyId, hostId);

    const expected = getRoundRotation(1, playerIds);
    const state = await getState(gameId);
    const game = await gameService.getGameById(gameId);

    assert.equal(state.roundState?.dealerId, expected.dealerId);
    assert.deepEqual(state.roundState?.bidOrder, expected.bidOrder);
    assert.equal(game?.currentTurnPlayerId, expected.bidOrder[0]);
    assert.equal(
      state.players.filter((p) => p.isCurrentTurn).map((p) => p.id)[0],
      expected.bidOrder[0]
    );
  });

  test('records the round-1 row with its trump', async () => {
    const { lobbyId, hostId } = await createLobbyWithPlayers(4);
    const gameId = await startGame(lobbyId, hostId);

    const rounds = await db.gameRound.findMany({ where: { gameId } });
    assert.equal(rounds.length, 1, 'only the current round is created up front');
    assert.equal(rounds[0].roundNumber, 1);
    assert.equal(rounds[0].handSize, 1);
    assert.equal(rounds[0].status, 'BIDDING');
    assert.equal(rounds[0].trumpKey, 'Kari');
    assert.equal(rounds[0].trumpSuit, 'spades');
  });

  test('logs the game start action', async () => {
    const { lobbyId, hostId } = await createLobbyWithPlayers(3);
    const gameId = await startGame(lobbyId, hostId);

    const actions = await db.gameAction.findMany({ where: { gameId } });
    assert.equal(actions.length, 1);
    assert.equal(actions[0].actionType, 'GAME_START');
  });

  test('only the host can start, and only with enough players', async () => {
    const { lobbyId, hostId, playerIds } = await createLobbyWithPlayers(2);

    await assert.rejects(
      () => lobbyService.startGame(lobbyId, playerIds[1]),
      /Only the host can start/
    );

    const solo = await createLobbyWithPlayers(1);
    await assert.rejects(
      () => lobbyService.startGame(solo.lobbyId, solo.hostId),
      /at least/
    );

    // The valid case still works.
    assert.ok(await lobbyService.startGame(lobbyId, hostId));
  });
});

describe('trump order', () => {
  test('Kachuful mode lays out the whole game up front, in order', async () => {
    const { lobbyId, hostId } = await createLobbyWithPlayers(4, {
      rounds: 8,
      orderMode: 'Kachuful',
    });
    const gameId = await startGame(lobbyId, hostId);

    const state = await getState(gameId);
    assert.deepEqual(
      state.trumpOrder.map((t) => t.name),
      ['Kari', 'Chukat', 'Falli', 'Lal', 'Kari', 'Chukat', 'Falli', 'Lal']
    );
  });

  test('Random mode picks valid suits, one per round', async () => {
    const { lobbyId, hostId } = await createLobbyWithPlayers(4, {
      rounds: 6,
      orderMode: 'Random',
    });
    const gameId = await startGame(lobbyId, hostId);

    const state = await getState(gameId);
    assert.equal(state.trumpOrder.length, 6);
    for (const trump of state.trumpOrder) {
      assert.ok(['Kari', 'Chukat', 'Falli', 'Lal'].includes(trump.key));
      assert.ok(trump.suit && trump.symbol);
    }
  });

  test('is generated once and persisted - re-reading never re-rolls it', async () => {
    const { lobbyId, hostId } = await createLobbyWithPlayers(4, {
      rounds: 8,
      orderMode: 'Random',
    });
    const gameId = await startGame(lobbyId, hostId);

    const first = (await getState(gameId)).trumpOrder;

    // Ten more reads, as a reconnecting client would trigger.
    for (let i = 0; i < 10; i++) {
      assert.deepEqual((await getState(gameId)).trumpOrder, first);
    }

    // And it matches what was written to its own column at creation time.
    const row = await db.game.findUnique({ where: { id: gameId } });
    assert.deepEqual(row?.trumpOrderJson, first);
  });

  test('a reconnecting player sees the same trump the table sees', async () => {
    const { lobbyId, hostId, playerIds } = await createLobbyWithPlayers(4, {
      rounds: 8,
      orderMode: 'Random',
    });
    const gameId = await startGame(lobbyId, hostId);

    const before = (await getState(gameId)).trumpOrder;

    // Simulate the reconnect path: fetch the game and build a client view.
    const game = await gameService.getGameById(gameId);
    const clientState = gameService.getClientGameState(game!, playerIds[2]);

    assert.deepEqual(clientState.trumpOrder, before);
    assert.deepEqual((await getState(gameId)).trumpOrder, before);
  });
});

describe('the per-player client view', () => {
  test('shows a player their own hand and only card counts for everyone else', async () => {
    const { lobbyId, hostId, playerIds } = await createLobbyWithPlayers(4, { rounds: 4 });
    const gameId = await startGame(lobbyId, hostId);

    const game = await gameService.getGameById(gameId);
    const view = gameService.getClientGameState(game!, playerIds[1]);

    assert.equal(view.myHand.length, 1);
    assert.equal(view.players.length, 4);
    for (const p of view.players) {
      assert.equal(p.cardCount, 1);
      // No `hand` key at all on other players - the cards never leave the server.
      assert.equal('hand' in p, false);
    }
  });

  test('echoes the active modes so the UI can label them', async () => {
    const { lobbyId, hostId, playerIds } = await createLobbyWithPlayers(3, {
      scoringMode: '+1',
      orderMode: 'Random',
    });
    const gameId = await startGame(lobbyId, hostId);

    const game = await gameService.getGameById(gameId);
    const view = gameService.getClientGameState(game!, playerIds[0]);

    assert.deepEqual(view.settings, { orderMode: 'Random', scoringMode: '+1' });
  });
});
