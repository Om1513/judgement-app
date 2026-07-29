// The bidding phase, end to end.

import test, { describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { db, resetDatabase, closeDatabase } from '../helpers/db';
import {
  createLobbyWithPlayers,
  startGame,
  getState,
  submitAllBids,
} from '../helpers/gameFlow';
import { gameService } from '../../services/game.service';

async function fourPlayerGame(rounds = 4) {
  const lobby = await createLobbyWithPlayers(4, { rounds });
  const gameId = await startGame(lobby.lobbyId, lobby.hostId);
  return { ...lobby, gameId };
}

beforeEach(async () => {
  await resetDatabase();
});

after(async () => {
  await closeDatabase();
});

describe('submitting bids in order', () => {
  test('each bid is stored and the turn moves to the next bidder', async () => {
    const { gameId } = await fourPlayerGame();

    const before = await getState(gameId);
    const [first, second] = before.roundState!.bidOrder;

    await gameService.submitBid({ gameId, playerId: first, bid: 1 });

    const after = await getState(gameId);
    assert.equal(after.roundState?.bids[first], 1);
    assert.equal(after.players.find((p) => p.id === first)?.bid, 1);
    assert.equal(after.status, 'BIDDING', 'still bidding');

    const game = await gameService.getGameById(gameId);
    assert.equal(game?.currentTurnPlayerId, second, 'turn advanced');
  });

  test('every bid is written to the round_bids table', async () => {
    const { gameId, playerIds } = await fourPlayerGame();

    await submitAllBids(gameId);

    const rows = await db.roundBid.findMany({ where: { gameId } });
    assert.equal(rows.length, 4, 'one row per player');
    assert.deepEqual(rows.map((r) => r.playerId).sort(), [...playerIds].sort());
    for (const row of rows) {
      assert.equal(row.bidValue, 0);
    }
  });

  test('each bid is logged as an action', async () => {
    const { gameId } = await fourPlayerGame();
    await submitAllBids(gameId);

    const actions = await db.gameAction.findMany({
      where: { gameId, actionType: 'BID_SUBMIT' },
    });
    assert.equal(actions.length, 4);
  });

  test('once everyone has bid, the round moves to playing', async () => {
    const { gameId } = await fourPlayerGame();

    const bidOrder = (await getState(gameId)).roundState!.bidOrder;
    await submitAllBids(gameId);

    const state = await getState(gameId);
    assert.equal(state.status, 'PLAYING');
    assert.equal(Object.keys(state.roundState!.bids).length, 4, 'all bids in');
    assert.equal(state.roundState?.trickNumber, 1, 'first trick opened');
    assert.equal(
      state.roundState?.currentTrick?.leadPlayerId,
      bidOrder[0],
      'the opening bidder leads'
    );
    assert.deepEqual(state.roundState?.currentTrick?.cardsPlayed, []);

    const game = await gameService.getGameById(gameId);
    assert.equal(game?.currentTurnPlayerId, bidOrder[0]);
  });

  test('the round row is moved to PLAYING too', async () => {
    const { gameId } = await fourPlayerGame();
    await submitAllBids(gameId);

    const round = await db.gameRound.findFirst({ where: { gameId, roundNumber: 1 } });
    assert.equal(round?.status, 'PLAYING');
  });
});

describe('the client view during bidding', () => {
  test('tells each player whose turn it is and what the running total is', async () => {
    const { gameId, playerIds } = await fourPlayerGame(4);
    const bidOrder = (await getState(gameId)).roundState!.bidOrder;

    await gameService.submitBid({ gameId, playerId: bidOrder[0], bid: 1 });

    const game = await gameService.getGameById(gameId);
    const view = gameService.getClientGameState(game!, playerIds[0]);

    assert.equal(view.roundState?.currentBidderId, bidOrder[1]);
    assert.equal(view.roundState?.totalBidsSoFar, 1);
    assert.equal(view.players.find((p) => p.id === bidOrder[0])?.hasBid, true);
    assert.equal(view.players.find((p) => p.id === bidOrder[1])?.hasBid, false);
  });

  test('flags the dealer as the last bidder, but only for the dealer', async () => {
    const { gameId } = await fourPlayerGame(4);
    const { bidOrder } = (await getState(gameId)).roundState!;

    for (const playerId of bidOrder.slice(0, 3)) {
      await gameService.submitBid({ gameId, playerId, bid: 0 });
    }

    const game = await gameService.getGameById(gameId);
    const dealer = bidOrder[3];

    assert.equal(
      gameService.getClientGameState(game!, dealer).roundState?.isLastBidder,
      true
    );
    assert.equal(
      gameService.getClientGameState(game!, bidOrder[0]).roundState?.isLastBidder,
      false,
      'the constraint is only shown to the player it applies to'
    );
  });
});

describe('rejected bids', () => {
  test('bidding out of turn is refused', async () => {
    const { gameId } = await fourPlayerGame();
    const { bidOrder } = (await getState(gameId)).roundState!;

    await assert.rejects(
      () => gameService.submitBid({ gameId, playerId: bidOrder[2], bid: 0 }),
      /Not your turn/
    );

    const state = await getState(gameId);
    assert.deepEqual(state.roundState?.bids, {}, 'nothing was recorded');
  });

  test('bidding twice is refused - the second attempt is out of turn', async () => {
    const { gameId } = await fourPlayerGame();
    const { bidOrder } = (await getState(gameId)).roundState!;

    await gameService.submitBid({ gameId, playerId: bidOrder[0], bid: 1 });
    await assert.rejects(
      () => gameService.submitBid({ gameId, playerId: bidOrder[0], bid: 0 }),
      /Not your turn/
    );

    const rows = await db.roundBid.findMany({ where: { gameId, playerId: bidOrder[0] } });
    assert.equal(rows.length, 1, 'no duplicate bid row');
  });

  test('a bid larger than the hand is refused', async () => {
    const { gameId } = await fourPlayerGame();
    const { bidOrder } = (await getState(gameId)).roundState!;

    await assert.rejects(
      () => gameService.submitBid({ gameId, playerId: bidOrder[0], bid: 2 }),
      /Invalid bid value/
    );
  });

  test('a negative or fractional bid is refused', async () => {
    const { gameId } = await fourPlayerGame();
    const { bidOrder } = (await getState(gameId)).roundState!;

    await assert.rejects(
      () => gameService.submitBid({ gameId, playerId: bidOrder[0], bid: -1 }),
      /Invalid bid value/
    );
    await assert.rejects(
      () => gameService.submitBid({ gameId, playerId: bidOrder[0], bid: 0.5 }),
      /Invalid bid value/
    );
  });

  test('the dealer cannot make the bids add up to the hand size', async () => {
    const { gameId } = await fourPlayerGame();
    const { bidOrder } = (await getState(gameId)).roundState!;

    // Hand size 1. First three bid 0, so the dealer is barred from bidding 1.
    for (const playerId of bidOrder.slice(0, 3)) {
      await gameService.submitBid({ gameId, playerId, bid: 0 });
    }

    await assert.rejects(
      () => gameService.submitBid({ gameId, playerId: bidOrder[3], bid: 1 }),
      /Total bids cannot equal 1/
    );

    // The other value is accepted, and closes the bidding.
    await gameService.submitBid({ gameId, playerId: bidOrder[3], bid: 0 });
    assert.equal((await getState(gameId)).status, 'PLAYING');
  });

  test('bidding after the bidding phase has closed is refused', async () => {
    const { gameId } = await fourPlayerGame();
    const { bidOrder } = (await getState(gameId)).roundState!;

    await submitAllBids(gameId);

    await assert.rejects(
      () => gameService.submitBid({ gameId, playerId: bidOrder[0], bid: 0 }),
      /Not in bidding phase/
    );
  });

  test('bidding on a game that does not exist is refused', async () => {
    await assert.rejects(
      () => gameService.submitBid({ gameId: 'nope', playerId: 'nobody', bid: 0 }),
      /Game not found/
    );
  });
});

describe('bids in a larger round', () => {
  test('round 3 allows bids of 0 through 3', async () => {
    const { lobbyId, hostId } = await createLobbyWithPlayers(3, { rounds: 4 });
    const gameId = await startGame(lobbyId, hostId);

    // Advance to round 3 by playing rounds 1 and 2 out.
    const { playOutRound, continueAll } = await import('../helpers/gameFlow');
    await playOutRound(gameId);
    await continueAll(gameId);
    await gameService.advanceToNextRound(gameId);
    await playOutRound(gameId);
    await continueAll(gameId);
    await gameService.advanceToNextRound(gameId);

    const state = await getState(gameId);
    assert.equal(state.currentRound, 3);
    assert.equal(state.roundState?.cardsPerPlayer, 3);

    const { bidOrder } = state.roundState!;
    await assert.rejects(
      () => gameService.submitBid({ gameId, playerId: bidOrder[0], bid: 4 }),
      /Invalid bid value/
    );
    await gameService.submitBid({ gameId, playerId: bidOrder[0], bid: 3 });
    assert.equal((await getState(gameId)).roundState?.bids[bidOrder[0]], 3);
  });
});
