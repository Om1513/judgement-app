// The in-memory copy of live games.
//
// Every action reads the game first, so live games are held in memory and
// written through to Postgres. These pin the rules that make that safe: the
// database stays the truth, a reader can never corrupt the shared copy, and a
// restart (an empty cache) loses nothing.

import test, { describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { db, resetDatabase, closeDatabase } from '../helpers/db';
import { createLobbyWithPlayers, startGame, getState, submitAllBids } from '../helpers/gameFlow';
import { gameService } from '../../services/game.service';
import { GameState } from '../../types/game';

beforeEach(async () => {
  await resetDatabase();
});

after(async () => {
  await closeDatabase();
});

async function storedState(gameId: string): Promise<GameState> {
  const row = await db.game.findUnique({ where: { id: gameId } });
  return row!.gameStateJson as unknown as GameState;
}

describe('the live game cache', () => {
  test('every read is a private copy', async () => {
    const lobby = await createLobbyWithPlayers(3, { rounds: 4 });
    const gameId = await startGame(lobby.lobbyId, lobby.hostId);

    const first = await gameService.getGameById(gameId);
    first!.gameState.players[0].hand = [];
    first!.gameState.status = 'GAME_OVER';

    const second = await gameService.getGameById(gameId);
    assert.notEqual(second!.gameState.players[0].hand.length, 0, 'the hand is untouched');
    assert.equal(second!.gameState.status, 'BIDDING');
  });

  test('what it serves always matches what was saved', async () => {
    const lobby = await createLobbyWithPlayers(3, { rounds: 4 });
    const gameId = await startGame(lobby.lobbyId, lobby.hostId);

    await submitAllBids(gameId);

    assert.deepEqual(await getState(gameId), await storedState(gameId));
  });

  test('a rejected action leaves the game exactly as it was', async () => {
    const lobby = await createLobbyWithPlayers(3, { rounds: 4 });
    const gameId = await startGame(lobby.lobbyId, lobby.hostId);
    const before = await getState(gameId);
    const bidder = before.roundState!.bidOrder[0];

    await assert.rejects(() => gameService.submitBid({ gameId, playerId: bidder, bid: 99 }));
    await assert.rejects(() =>
      gameService.submitBid({ gameId, playerId: before.roundState!.bidOrder[1], bid: 0 })
    );

    assert.deepEqual(await getState(gameId), before);
    assert.deepEqual(await storedState(gameId), before);
  });

  test('after a restart the game comes back from the database, unchanged', async () => {
    const lobby = await createLobbyWithPlayers(3, { rounds: 4 });
    const gameId = await startGame(lobby.lobbyId, lobby.hostId);
    await submitAllBids(gameId);
    const live = await getState(gameId);

    gameService.forgetAllGames(); // what a process restart leaves behind

    assert.deepEqual(await getState(gameId), live);
  });

  test('a write made behind its back is picked up once the game is forgotten', async () => {
    const lobby = await createLobbyWithPlayers(3, { rounds: 4 });
    const gameId = await startGame(lobby.lobbyId, lobby.hostId);
    await getState(gameId); // cached now

    const state = await storedState(gameId);
    state.status = 'GAME_OVER';
    await db.game.update({
      where: { id: gameId },
      data: { status: 'GAME_OVER', gameStateJson: state as never },
    });

    assert.equal((await getState(gameId)).status, 'BIDDING', 'still the cached copy');
    gameService.forgetGame(gameId);
    assert.equal((await getState(gameId)).status, 'GAME_OVER');
  });
});
