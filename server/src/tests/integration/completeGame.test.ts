// A game played from the first bid to the winner screen.

import test, { describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { db, resetDatabase, closeDatabase } from '../helpers/db';
import {
  createLobbyWithPlayers,
  startGame,
  getState,
  playOutRound,
  continueAll,
  countRows,
} from '../helpers/gameFlow';
import { gameService } from '../../services/game.service';
import { scoreboardService } from '../../services/scoreboard.service';
import { calculateScore } from '../../utils/cardUtils';

/** Plays every round of a game and leaves it on GAME_OVER. */
async function playWholeGame(players: number, rounds: number) {
  const lobby = await createLobbyWithPlayers(players, { rounds });
  const gameId = await startGame(lobby.lobbyId, lobby.hostId);

  for (let round = 1; round <= rounds; round++) {
    await playOutRound(gameId);
    await continueAll(gameId);
    await gameService.advanceToNextRound(gameId);
  }

  return { ...lobby, gameId };
}

beforeEach(async () => {
  await resetDatabase();
});

after(async () => {
  await closeDatabase();
});

describe('a full four-round game', () => {
  test('reaches GAME_OVER after the final round', async () => {
    const { gameId } = await playWholeGame(4, 4);

    const state = await getState(gameId);
    assert.equal(state.status, 'GAME_OVER');
    assert.equal(state.currentRound, 4, 'it does not roll past the last round');
  });

  test('plays and records every round', async () => {
    const { gameId } = await playWholeGame(4, 4);

    const counts = await countRows(gameId);
    assert.equal(counts.rounds, 4, 'four round rows');
    assert.equal(counts.bids, 16, '4 players x 4 rounds');
    assert.equal(counts.scores, 16, 'a score row per player per round');

    const rounds = await db.gameRound.findMany({ where: { gameId } });
    assert.equal(
      rounds.every((r) => r.status === 'COMPLETED'),
      true
    );
    assert.deepEqual(
      rounds.sort((a, b) => a.roundNumber - b.roundNumber).map((r) => r.handSize),
      [1, 2, 3, 4],
      'the hand grows by one card each round'
    );
  });

  test('the running total is the sum of the round scores', async () => {
    const { gameId, playerIds } = await playWholeGame(4, 4);

    const state = await getState(gameId);
    const rows = await db.roundScore.findMany({ where: { gameId } });

    for (const playerId of playerIds) {
      const summed = rows
        .filter((r) => r.playerId === playerId)
        .reduce((total, r) => total + r.roundScore, 0);
      assert.equal(state.scores[playerId], summed, `${playerId} total`);
    }
  });

  test('every stored round score obeys the scoring rule', async () => {
    const { gameId } = await playWholeGame(3, 4);

    const rows = await db.roundScore.findMany({ where: { gameId } });
    for (const row of rows) {
      assert.equal(
        row.roundScore,
        calculateScore(row.bidValue, row.handsMade, '+10'),
        `round score for ${row.playerId}`
      );
    }
  });

  test('the hands made in a round always add up to the hand size', async () => {
    const { gameId } = await playWholeGame(4, 4);

    const rounds = await db.gameRound.findMany({
      where: { gameId },
      include: { roundScores: true },
    });

    for (const round of rounds) {
      const tricks = round.roundScores.reduce((total, s) => total + s.handsMade, 0);
      assert.equal(tricks, round.handSize, `round ${round.roundNumber} tricks`);
    }
  });
});

describe('finalizing the result', () => {
  test('the highest total wins and is stored once', async () => {
    const { gameId } = await playWholeGame(4, 4);

    const result = await scoreboardService.finalizeGame(gameId);
    assert.ok(result);

    const state = await getState(gameId);
    const best = Math.max(...Object.values(state.scores));

    assert.equal(result.winningScore, best);
    assert.deepEqual(
      result.winnerIds.sort(),
      Object.entries(state.scores)
        .filter(([, score]) => score === best)
        .map(([id]) => id)
        .sort()
    );
    assert.deepEqual(result.finalScores, state.scores);

    const stored = await db.gameResult.findUnique({ where: { gameId } });
    assert.ok(stored, 'result row written');
    assert.equal(stored.winningScore, best);
    assert.deepEqual(stored.finalScoresJson, state.scores);
  });

  test('the game is marked completed', async () => {
    const { gameId } = await playWholeGame(3, 4);
    await scoreboardService.finalizeGame(gameId);

    const row = await db.game.findUnique({ where: { id: gameId } });
    assert.equal(row?.status, 'COMPLETED');
  });

  test('finalizing again returns the same result without duplicating the row', async () => {
    const { gameId } = await playWholeGame(3, 4);

    const first = await scoreboardService.finalizeGame(gameId);
    const second = await scoreboardService.finalizeGame(gameId);

    assert.deepEqual(second, first);
    assert.equal(await db.gameResult.count({ where: { gameId } }), 1);
  });

  test('the winner has a name attached for the celebration screen', async () => {
    const { gameId } = await playWholeGame(3, 4);
    const result = await scoreboardService.finalizeGame(gameId);

    for (const winner of result!.winners) {
      assert.ok(winner.name && winner.name !== 'Unknown', 'winners are named');
      assert.ok(result!.winnerIds.includes(winner.id));
    }
  });

  test('getWinner agrees with the stored result', async () => {
    const { gameId } = await playWholeGame(3, 4);
    const result = await scoreboardService.finalizeGame(gameId);

    const state = await getState(gameId);
    const winner = gameService.getWinner(state);

    assert.ok(winner);
    assert.equal(winner.score, result!.winningScore);
    assert.ok(result!.winnerIds.includes(winner.id));
  });

  test('the final scoreboard reports the game as completed', async () => {
    const { gameId } = await playWholeGame(3, 4);
    await scoreboardService.finalizeGame(gameId);

    const scoreboard = await scoreboardService.getScoreboardState(gameId);
    assert.equal(scoreboard?.status, 'completed');
    assert.equal(scoreboard?.rows.length, 4);
    assert.ok(
      scoreboard?.rows.every((row) => row.scores.every((s) => s.score !== null)),
      'every round is filled in'
    );
  });
});

describe('ties', () => {
  test('every player on the top score is a winner', async () => {
    // A tie cannot be arranged by playing normally - who takes which trick is
    // dealt, not chosen. So play a real game to GAME_OVER and then level the
    // totals, which is the exact state finalizeGame has to cope with.
    const { gameId, playerIds } = await playWholeGame(3, 4);

    const game = await gameService.getGameById(gameId);
    const state = game!.gameState;
    state.scores = { [playerIds[0]]: 30, [playerIds[1]]: 30, [playerIds[2]]: 10 };
    await db.game.update({
      where: { id: gameId },
      data: { gameStateJson: state as never },
    });

    const result = await scoreboardService.finalizeGame(gameId);

    assert.equal(result?.isTie, true);
    assert.equal(result?.winningScore, 30);
    assert.deepEqual(result?.winnerIds.sort(), [playerIds[0], playerIds[1]].sort());
    assert.equal(result?.winners.length, 2);

    const stored = await db.gameResult.findUnique({ where: { gameId } });
    assert.deepEqual((stored?.winnerPlayerIds as string[]).sort(), [playerIds[0], playerIds[1]].sort());
  });

  test('a single leader is not reported as a tie', async () => {
    const { gameId, playerIds } = await playWholeGame(3, 4);

    const game = await gameService.getGameById(gameId);
    const state = game!.gameState;
    state.scores = { [playerIds[0]]: 40, [playerIds[1]]: 20, [playerIds[2]]: 10 };
    await db.game.update({
      where: { id: gameId },
      data: { gameStateJson: state as never },
    });

    const result = await scoreboardService.finalizeGame(gameId);

    assert.equal(result?.isTie, false);
    assert.deepEqual(result?.winnerIds, [playerIds[0]]);
  });

  test('an all-zero game still produces winners rather than nobody', async () => {
    const { gameId, playerIds } = await playWholeGame(2, 4);

    const game = await gameService.getGameById(gameId);
    const state = game!.gameState;
    state.scores = { [playerIds[0]]: 0, [playerIds[1]]: 0 };
    await db.game.update({
      where: { id: gameId },
      data: { gameStateJson: state as never },
    });

    const result = await scoreboardService.finalizeGame(gameId);
    assert.equal(result?.winningScore, 0);
    assert.equal(result?.winnerIds.length, 2);
    assert.equal(result?.isTie, true);
  });
});

describe('a longer game', () => {
  test('an eight-round game runs through every trump in the cycle twice', async () => {
    const { gameId } = await playWholeGame(2, 8);

    const state = await getState(gameId);
    assert.equal(state.status, 'GAME_OVER');
    assert.deepEqual(
      state.trumpOrder.map((t) => t.name),
      ['Kari', 'Chukat', 'Falli', 'Lal', 'Kari', 'Chukat', 'Falli', 'Lal']
    );

    const rounds = await db.gameRound.findMany({ where: { gameId }, orderBy: { roundNumber: 'asc' } });
    assert.equal(rounds.length, 8);
    assert.deepEqual(
      rounds.map((r) => r.trumpKey),
      ['Kari', 'Chukat', 'Falli', 'Lal', 'Kari', 'Chukat', 'Falli', 'Lal']
    );
  });
});
