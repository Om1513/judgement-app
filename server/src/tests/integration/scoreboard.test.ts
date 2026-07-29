// Finishing a round: scores, the scoreboard, and the Continue gate.

import test, { describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { db, resetDatabase, closeDatabase } from '../helpers/db';
import {
  createLobbyWithPlayers,
  startGame,
  getState,
  playOutRound,
  continueAll,
} from '../helpers/gameFlow';
import { gameService } from '../../services/game.service';
import { scoreboardService } from '../../services/scoreboard.service';
import { calculateScore } from '../../utils/cardUtils';

async function roundOneComplete(scoringMode: '+10' | '+1' = '+10') {
  const lobby = await createLobbyWithPlayers(4, { rounds: 4, scoringMode });
  const gameId = await startGame(lobby.lobbyId, lobby.hostId);
  await playOutRound(gameId);
  return { ...lobby, gameId };
}

beforeEach(async () => {
  await resetDatabase();
});

after(async () => {
  await closeDatabase();
});

describe('when the last card of a round is played', () => {
  test('the game moves to the round scoreboard', async () => {
    const { gameId } = await roundOneComplete();

    const state = await getState(gameId);
    assert.equal(state.status, 'ROUND_SCOREBOARD');
    assert.equal(state.currentRound, 1, 'the round does not advance on its own');
  });

  test('scores are calculated with the round rule and applied to totals', async () => {
    const { gameId } = await roundOneComplete('+10');

    const state = await getState(gameId);
    for (const player of state.players) {
      const expected = calculateScore(player.bid!, player.tricksWon, '+10');
      assert.equal(player.score, expected, `${player.name} score`);
      assert.equal(state.scores[player.id], expected, 'mirrored into the score map');
    }

    // Everyone bid 0; exactly one player took the single trick and so scored 0.
    const madeIt = state.players.filter((p) => p.score === 10);
    assert.equal(madeIt.length, 3, 'the three who took no trick made their zero bid');
  });

  test('the same round under +1 scoring pays the flat rate', async () => {
    const { gameId } = await roundOneComplete('+1');

    const state = await getState(gameId);
    for (const player of state.players) {
      assert.equal(player.score, calculateScore(player.bid!, player.tricksWon, '+1'));
    }
  });

  test('scores are persisted, one row per player', async () => {
    const { gameId, playerIds } = await roundOneComplete();

    const rows = await db.roundScore.findMany({ where: { gameId } });
    assert.equal(rows.length, 4);
    assert.deepEqual(rows.map((r) => r.playerId).sort(), [...playerIds].sort());

    const state = await getState(gameId);
    for (const row of rows) {
      const player = state.players.find((p) => p.id === row.playerId)!;
      assert.equal(row.bidValue, player.bid);
      assert.equal(row.handsMade, player.tricksWon);
      assert.equal(row.roundScore, player.score, 'round 1: round score == total');
    }
  });

  test('the round row is closed and the round end logged', async () => {
    const { gameId } = await roundOneComplete();

    const round = await db.gameRound.findFirst({ where: { gameId, roundNumber: 1 } });
    assert.equal(round?.status, 'COMPLETED');

    const logged = await db.gameAction.findMany({
      where: { gameId, actionType: 'ROUND_END' },
    });
    assert.equal(logged.length, 1);
  });

  test('a Continue slot is created for every player, all unchecked', async () => {
    const { gameId, playerIds } = await roundOneComplete();

    const confirmations = await db.scoreboardConfirmation.findMany({ where: { gameId } });
    assert.equal(confirmations.length, 4);
    assert.deepEqual(confirmations.map((c) => c.playerId).sort(), [...playerIds].sort());
    assert.equal(
      confirmations.every((c) => c.hasContinued === false),
      true
    );
  });
});

describe('the scoreboard payload', () => {
  test('has a row per round of the game, filled in only up to the current one', async () => {
    const { gameId } = await roundOneComplete();

    const scoreboard = await scoreboardService.getScoreboardState(gameId);
    assert.ok(scoreboard);
    assert.equal(scoreboard.rows.length, 4, 'one row per configured round');
    assert.equal(scoreboard.currentRound, 1);
    assert.equal(scoreboard.totalRounds, 4);
    assert.equal(scoreboard.status, 'round_scoreboard');

    const [round1, round2] = scoreboard.rows;
    assert.ok(round1.scores.every((s) => s.score !== null), 'round 1 is filled in');
    assert.ok(round2.scores.every((s) => s.score === null), 'round 2 has not happened');
  });

  test('carries each row bid, hands made and score', async () => {
    const { gameId } = await roundOneComplete();

    const scoreboard = await scoreboardService.getScoreboardState(gameId);
    const state = await getState(gameId);

    for (const entry of scoreboard!.rows[0].scores) {
      const player = state.players.find((p) => p.id === entry.playerId)!;
      assert.equal(entry.bid, player.bid);
      assert.equal(entry.handsMade, player.tricksWon);
      assert.equal(entry.score, player.score);
    }
  });

  test('lists every player with their running total and continue state', async () => {
    const { gameId, hostId } = await roundOneComplete();

    const scoreboard = await scoreboardService.getScoreboardState(gameId);
    assert.equal(scoreboard!.players.length, 4);
    assert.equal(scoreboard!.players.find((p) => p.id === hostId)?.isHost, true);
    assert.equal(
      scoreboard!.players.every((p) => p.hasContinued === false),
      true
    );

    const state = await getState(gameId);
    for (const player of scoreboard!.players) {
      assert.equal(player.totalScore, state.scores[player.id]);
    }
  });

  test('echoes the scoring mode in force', async () => {
    const { gameId } = await roundOneComplete('+1');
    const scoreboard = await scoreboardService.getScoreboardState(gameId);
    assert.equal(scoreboard?.scoringMode, '+1');
  });

  test('names the trump each round was played under', async () => {
    const { gameId } = await roundOneComplete();
    const scoreboard = await scoreboardService.getScoreboardState(gameId);

    assert.equal(scoreboard?.rows[0].trump.suit, 'spades', 'round 1 is Kari');
    assert.deepEqual(
      scoreboard?.rows.map((r) => r.trump.suit),
      ['spades', 'diamonds', 'clubs', 'hearts']
    );
  });
});

describe('the Continue gate', () => {
  test('one player continuing is not enough', async () => {
    const { gameId, playerIds } = await roundOneComplete();

    const result = await scoreboardService.playerContinue(gameId, playerIds[0]);

    assert.equal(result.allContinued, false);
    assert.equal(
      result.scoreboard.players.find((p) => p.id === playerIds[0])?.hasContinued,
      true
    );
    assert.equal(
      result.scoreboard.players.filter((p) => p.hasContinued).length,
      1
    );
  });

  test('the round only advances once every player has continued', async () => {
    const { gameId, playerIds } = await roundOneComplete();

    for (const playerId of playerIds.slice(0, 3)) {
      const partial = await scoreboardService.playerContinue(gameId, playerId);
      assert.equal(partial.allContinued, false);
      // Still parked on the scoreboard.
      assert.equal((await getState(gameId)).status, 'ROUND_SCOREBOARD');
    }

    const last = await scoreboardService.playerContinue(gameId, playerIds[3]);
    assert.equal(last.allContinued, true);
  });

  test('continuing twice does not double-count', async () => {
    const { gameId, playerIds } = await roundOneComplete();

    await scoreboardService.playerContinue(gameId, playerIds[0]);
    const again = await scoreboardService.playerContinue(gameId, playerIds[0]);

    assert.equal(again.allContinued, false, 'one player still cannot unlock a four-player table');

    const rows = await db.scoreboardConfirmation.findMany({
      where: { gameId, playerId: playerIds[0] },
    });
    assert.equal(rows.length, 1, 'upsert, not insert');
  });

  test('continuing outside the scoreboard phase is refused', async () => {
    const lobby = await createLobbyWithPlayers(4, { rounds: 4 });
    const gameId = await startGame(lobby.lobbyId, lobby.hostId);

    await assert.rejects(
      () => scoreboardService.playerContinue(gameId, lobby.playerIds[0]),
      /not in scoreboard phase/i
    );
  });

  test('checkAllContinued agrees with playerContinue', async () => {
    const { gameId } = await roundOneComplete();

    assert.equal(await scoreboardService.checkAllContinued(gameId), false);
    await continueAll(gameId);
    assert.equal(await scoreboardService.checkAllContinued(gameId), true);
  });
});

describe('starting the next round', () => {
  test('deals a bigger hand, rotates the dealer and moves the trump on', async () => {
    const { gameId, playerIds } = await roundOneComplete();
    const round1 = await getState(gameId);

    await continueAll(gameId);
    await gameService.advanceToNextRound(gameId);

    const round2 = await getState(gameId);
    assert.equal(round2.currentRound, 2);
    assert.equal(round2.status, 'BIDDING');
    assert.equal(round2.roundState?.cardsPerPlayer, 2);
    assert.equal(round2.roundState?.trump?.name, 'Chukat');

    assert.notEqual(round2.roundState?.dealerId, round1.roundState?.dealerId);
    assert.equal(round2.roundState?.dealerId, playerIds[1], 'dealer moved one seat');
    assert.equal(round2.roundState?.bidOrder[0], playerIds[2]);

    for (const player of round2.players) {
      assert.equal(player.hand.length, 2, 'fresh two-card hand');
      assert.equal(player.bid, null, 'bids cleared');
      assert.equal(player.tricksWon, 0, 'trick counts cleared');
    }
  });

  test('carries the running totals into the new round', async () => {
    const { gameId } = await roundOneComplete();
    const before = (await getState(gameId)).scores;

    await continueAll(gameId);
    await gameService.advanceToNextRound(gameId);

    assert.deepEqual((await getState(gameId)).scores, before);
  });

  test('creates the round-2 row', async () => {
    const { gameId } = await roundOneComplete();
    await continueAll(gameId);
    await gameService.advanceToNextRound(gameId);

    const rounds = await db.gameRound.findMany({ where: { gameId }, orderBy: { roundNumber: 'asc' } });
    assert.deepEqual(rounds.map((r) => r.roundNumber), [1, 2]);
    assert.equal(rounds[1].handSize, 2);
    assert.equal(rounds[1].trumpKey, 'Chukat');
    assert.equal(rounds[1].status, 'BIDDING');
  });

  test('advancing outside the scoreboard phase is refused', async () => {
    const lobby = await createLobbyWithPlayers(4, { rounds: 4 });
    const gameId = await startGame(lobby.lobbyId, lobby.hostId);

    await assert.rejects(
      () => gameService.advanceToNextRound(gameId),
      /not in scoreboard phase/i
    );
  });

  test('the previous round stays readable on the scoreboard', async () => {
    const { gameId } = await roundOneComplete();
    const round1Scores = (await scoreboardService.getScoreboardState(gameId))!.rows[0];

    await continueAll(gameId);
    await gameService.advanceToNextRound(gameId);
    await playOutRound(gameId);

    const scoreboard = await scoreboardService.getScoreboardState(gameId);
    assert.deepEqual(scoreboard?.rows[0], round1Scores, 'round 1 is unchanged');
    assert.ok(scoreboard?.rows[1].scores.every((s) => s.score !== null), 'round 2 filled in');
  });
});
