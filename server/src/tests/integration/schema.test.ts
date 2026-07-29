// Proof that a completely empty database can be brought up and played on.
//
// The test runner drops the public schema and re-applies prisma/schema.prisma
// before this suite runs - the same `prisma db push` the production container
// executes on boot. So a green run here is direct evidence that provisioning a
// brand-new database and starting a game on it works, which is the one thing
// that cannot be checked by unit tests.

import test, { describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { db, resetDatabase, closeDatabase } from '../helpers/db';
import {
  createLobbyWithPlayers,
  startGame,
  playOutRound,
  continueAll,
  getState,
} from '../helpers/gameFlow';
import { scoreboardService } from '../../services/scoreboard.service';

/** Every model in prisma/schema.prisma. */
const EXPECTED_TABLES = [
  'Game',
  'GameAction',
  'GameResult',
  'GameRound',
  'Lobby',
  'LobbyPlayer',
  'Player',
  'RoundBid',
  'RoundScore',
  'RoundTrick',
  'ScoreboardConfirmation',
  'TrickCard',
];

beforeEach(async () => {
  await resetDatabase();
});

after(async () => {
  await closeDatabase();
});

describe('the applied schema', () => {
  test('has every table the application models', async () => {
    const rows = await db.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `;
    const tables = rows.map((r) => r.tablename);

    for (const expected of EXPECTED_TABLES) {
      assert.ok(tables.includes(expected), `missing table "${expected}"`);
    }
  });

  test('has the game status enum the code transitions through', async () => {
    const rows = await db.$queryRaw<{ label: string }[]>`
      SELECT e.enumlabel AS label
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'GameStatus'
    `;
    const labels = rows.map((r) => r.label);

    for (const status of [
      'BIDDING',
      'PLAYING',
      'ROUND_SCOREBOARD',
      'GAME_OVER',
      'COMPLETED',
    ]) {
      assert.ok(labels.includes(status), `missing GameStatus value "${status}"`);
    }
  });

  test('enforces the unique lobby code', async () => {
    const { code } = await createLobbyWithPlayers(1);
    const { playerService } = await import('../../services/player.service');
    const other = await playerService.createPlayer({ name: 'Clash', clientId: 'c-clash' });

    await assert.rejects(
      () =>
        db.lobby.create({
          data: { code, hostPlayerId: other.id, settings: {} },
        }),
      /Unique constraint|duplicate key/i
    );
  });

  test('cascades a deleted lobby down to its games and rounds', async () => {
    const { lobbyId, hostId } = await createLobbyWithPlayers(2);
    const gameId = await startGame(lobbyId, hostId);

    await db.lobby.delete({ where: { id: lobbyId } });

    assert.equal(await db.game.count({ where: { id: gameId } }), 0);
    assert.equal(await db.gameRound.count({ where: { gameId } }), 0);
    assert.equal(await db.lobbyPlayer.count({ where: { lobbyId } }), 0);
  });

  test('starts empty for each suite', async () => {
    for (const table of ['Player', 'Lobby', 'Game']) {
      const rows = await db.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT COUNT(*)::bigint AS count FROM "${table}"`
      );
      assert.equal(Number(rows[0].count), 0, `${table} was not empty`);
    }
  });
});

describe('a fresh database can host a real game', () => {
  test('lobby -> game -> round -> scoreboard, all persisted', async () => {
    const { lobbyId, hostId } = await createLobbyWithPlayers(3, { rounds: 4 });
    const gameId = await startGame(lobbyId, hostId);

    await playOutRound(gameId);
    await continueAll(gameId);

    const state = await getState(gameId);
    assert.equal(state.status, 'ROUND_SCOREBOARD');

    const scoreboard = await scoreboardService.getScoreboardState(gameId);
    assert.ok(scoreboard, 'a scoreboard could be built from the fresh database');
    assert.equal(scoreboard.players.length, 3);

    // Rows landed in every table the flow touches.
    const [players, lobbies, games, rounds, bids, scores, actions, confirmations] =
      await Promise.all([
        db.player.count(),
        db.lobby.count(),
        db.game.count(),
        db.gameRound.count(),
        db.roundBid.count(),
        db.roundScore.count(),
        db.gameAction.count(),
        db.scoreboardConfirmation.count(),
      ]);

    assert.equal(players, 3);
    assert.equal(lobbies, 1);
    assert.equal(games, 1);
    assert.equal(rounds, 1);
    assert.equal(bids, 3);
    assert.equal(scores, 3);
    assert.equal(confirmations, 3);
    assert.ok(actions > 0);
  });
});
