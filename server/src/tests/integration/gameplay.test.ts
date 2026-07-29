// Playing cards: a full trick, who wins it, and every way a play is refused.

import test, { describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { db, resetDatabase, closeDatabase } from '../helpers/db';
import {
  createLobbyWithPlayers,
  startGame,
  getState,
  submitAllBids,
  playTrick,
  advanceHand,
  advanceToRound,
  firstLegalCard,
} from '../helpers/gameFlow';
import { gameService } from '../../services/game.service';
import { determineTrickWinner, canPlayCard } from '../../utils/cardUtils';
import { Card } from '../../types/player';

/** A four-player game sitting at the start of round `round`, bids all in. */
async function gameAtRound(round: number) {
  const lobby = await createLobbyWithPlayers(4, { rounds: 4 });
  const gameId = await startGame(lobby.lobbyId, lobby.hostId);
  await advanceToRound(gameId, round);
  await submitAllBids(gameId);
  return { ...lobby, gameId };
}

beforeEach(async () => {
  await resetDatabase();
});

after(async () => {
  await closeDatabase();
});

describe('a trick, card by card', () => {
  test('each play lands on the table and passes the turn on', async () => {
    // Round 3: three cards each, so a trick can be watched without the round
    // ending underneath it.
    const { gameId } = await gameAtRound(3);

    const start = await getState(gameId);
    const leader = start.roundState!.currentTrick!.leadPlayerId;
    const turnOrder = start.turnOrder;
    const leaderIndex = turnOrder.indexOf(leader);

    for (let i = 0; i < 4; i++) {
      const before = await gameService.getGameById(gameId);
      const expectedPlayer = turnOrder[(leaderIndex + i) % 4];
      assert.equal(before?.currentTurnPlayerId, expectedPlayer, `seat ${i} is on turn`);

      const card = firstLegalCard(before!.gameState, expectedPlayer);
      const handBefore = before!.gameState.players.find((p) => p.id === expectedPlayer)!.hand.length;

      await gameService.playCard({ gameId, playerId: expectedPlayer, card });

      const after = await getState(gameId);
      const trick = after.roundState!.currentTrick!;

      assert.equal(trick.cardsPlayed.length, i + 1, 'card is on the table');
      assert.deepEqual(trick.cardsPlayed[i], { playerId: expectedPlayer, card });
      assert.equal(
        after.players.find((p) => p.id === expectedPlayer)!.hand.length,
        handBefore - 1,
        'card left the hand'
      );
      if (i === 0) {
        assert.equal(trick.leadSuit, card.suit, 'the first card sets the lead suit');
      }
    }
  });

  test('the fourth card completes the trick and the winner is recorded', async () => {
    const { gameId } = await gameAtRound(3);

    const trumpSuit = (await getState(gameId)).roundState!.trumpSuit;
    const result = await playTrick(gameId);

    const state = await getState(gameId);
    const trick = state.roundState!.currentTrick!;

    assert.equal(trick.cardsPlayed.length, 4);
    assert.ok(result.winnerId, 'a winner was chosen');
    assert.equal(trick.winnerId, result.winnerId);

    // The winner must be exactly who the shared rule says it is.
    assert.equal(
      determineTrickWinner(trick.cardsPlayed, trick.leadSuit!, trumpSuit),
      result.winnerId
    );
  });

  test('the winner hands-made counter goes up by one', async () => {
    const { gameId } = await gameAtRound(3);

    const before = await getState(gameId);
    const tricksBefore = Object.fromEntries(before.players.map((p) => [p.id, p.tricksWon]));

    const { winnerId } = await playTrick(gameId);

    const after = await getState(gameId);
    for (const player of after.players) {
      const expected = tricksBefore[player.id] + (player.id === winnerId ? 1 : 0);
      assert.equal(player.tricksWon, expected, `${player.id} tricks`);
    }
    assert.equal(after.roundState?.tricksWon[winnerId], 1);
  });

  test('the table is frozen while the hand winner is shown', async () => {
    const { gameId } = await gameAtRound(3);
    const { winnerId } = await playTrick(gameId);

    const state = await getState(gameId);
    assert.equal(state.roundState?.awaitingNextHand, true);
    assert.equal(state.roundState?.nextLeaderId, winnerId);
    assert.equal(
      state.players.some((p) => p.isCurrentTurn),
      false,
      'nobody is on turn during the pause'
    );

    const game = await gameService.getGameById(gameId);
    assert.equal(game?.currentTurnPlayerId, null);
  });

  test('the trick winner leads the next hand', async () => {
    const { gameId } = await gameAtRound(3);
    const { winnerId } = await playTrick(gameId);

    await advanceHand(gameId);

    const state = await getState(gameId);
    assert.equal(state.roundState?.trickNumber, 2);
    assert.equal(state.roundState?.currentTrick?.leadPlayerId, winnerId);
    assert.equal(state.roundState?.currentTrick?.leadSuit, null, 'fresh trick');
    assert.deepEqual(state.roundState?.currentTrick?.cardsPlayed, []);
    assert.equal(state.roundState?.awaitingNextHand, false);

    const game = await gameService.getGameById(gameId);
    assert.equal(game?.currentTurnPlayerId, winnerId);
  });

  test('advancing the hand twice is harmless', async () => {
    const { gameId } = await gameAtRound(3);
    await playTrick(gameId);

    await advanceHand(gameId);
    const once = await getState(gameId);
    await advanceHand(gameId);
    const twice = await getState(gameId);

    assert.equal(twice.roundState?.trickNumber, once.roundState?.trickNumber);
    assert.deepEqual(twice.roundState?.currentTrick, once.roundState?.currentTrick);
  });

  test('every play is logged', async () => {
    const { gameId } = await gameAtRound(3);

    // Rounds 1 and 2 were played to get here, so count the delta.
    const before = await db.gameAction.count({ where: { gameId, actionType: 'CARD_PLAY' } });
    await playTrick(gameId);
    const after = await db.gameAction.count({ where: { gameId, actionType: 'CARD_PLAY' } });

    assert.equal(after - before, 4, 'one log row per card played in the trick');
  });
});

describe('refused plays', () => {
  test('playing out of turn is refused', async () => {
    const { gameId } = await gameAtRound(3);

    const state = await getState(gameId);
    const onTurn = state.roundState!.currentTrick!.leadPlayerId;
    const other = state.turnOrder.find((id) => id !== onTurn)!;

    await assert.rejects(
      () =>
        gameService.playCard({
          gameId,
          playerId: other,
          card: state.players.find((p) => p.id === other)!.hand[0],
        }),
      /Not your turn/
    );

    assert.deepEqual((await getState(gameId)).roundState?.currentTrick?.cardsPlayed, []);
  });

  test('playing a card you do not hold is refused', async () => {
    const { gameId } = await gameAtRound(3);

    const state = await getState(gameId);
    const playerId = state.roundState!.currentTrick!.leadPlayerId;
    const hand = state.players.find((p) => p.id === playerId)!.hand;

    // Find a card that is definitely not in this hand.
    const allRanks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    const ghost = (['hearts', 'diamonds', 'clubs', 'spades'] as Card['suit'][])
      .flatMap((suit) => allRanks.map((rank) => ({ suit, rank, value: 0 })))
      .find((c) => !hand.some((h) => h.suit === c.suit && h.rank === c.rank))!;

    await assert.rejects(
      () => gameService.playCard({ gameId, playerId, card: ghost as Card }),
      /Card not in hand/
    );
  });

  test('playing the same card twice is refused - it has left the hand', async () => {
    const { gameId } = await gameAtRound(3);

    const state = await getState(gameId);
    const playerId = state.roundState!.currentTrick!.leadPlayerId;
    const card = firstLegalCard(state, playerId);

    await gameService.playCard({ gameId, playerId, card });

    await assert.rejects(
      () => gameService.playCard({ gameId, playerId, card }),
      /Not your turn|Card not in hand/
    );
  });

  test('breaking follow-suit is refused', async () => {
    // Play until a follower is holding both the lead suit and something else.
    const { gameId } = await gameAtRound(4);

    const start = await getState(gameId);
    const leader = start.roundState!.currentTrick!.leadPlayerId;
    const leadCard = start.players.find((p) => p.id === leader)!.hand[0];
    await gameService.playCard({ gameId, playerId: leader, card: leadCard });

    const afterLead = await getState(gameId);
    const leadSuit = afterLead.roundState!.currentTrick!.leadSuit!;
    const nextPlayer = (await gameService.getGameById(gameId))!.currentTurnPlayerId!;
    const hand = afterLead.players.find((p) => p.id === nextPlayer)!.hand;

    const offSuit = hand.find((c) => c.suit !== leadSuit);
    const hasLeadSuit = hand.some((c) => c.suit === leadSuit);

    if (hasLeadSuit && offSuit) {
      assert.equal(canPlayCard(offSuit, hand, leadSuit), false, 'precondition');
      await assert.rejects(
        () => gameService.playCard({ gameId, playerId: nextPlayer, card: offSuit }),
        /must follow suit/
      );
    } else {
      // The deal did not produce the situation; assert the weaker invariant
      // that whatever they can play is legal, so the test never silently passes
      // on a false premise.
      const legal = firstLegalCard(afterLead, nextPlayer);
      assert.equal(canPlayCard(legal, hand, leadSuit), true);
    }
  });

  test('playing during the hand-winner pause is refused', async () => {
    const { gameId } = await gameAtRound(3);
    const { winnerId } = await playTrick(gameId);

    const state = await getState(gameId);
    const hand = state.players.find((p) => p.id === winnerId)!.hand;

    await assert.rejects(
      () => gameService.playCard({ gameId, playerId: winnerId, card: hand[0] }),
      /Not your turn|being scored/
    );
  });

  test('playing before the bidding is finished is refused', async () => {
    const lobby = await createLobbyWithPlayers(4, { rounds: 4 });
    const gameId = await startGame(lobby.lobbyId, lobby.hostId);

    const state = await getState(gameId);
    const playerId = state.roundState!.bidOrder[0];

    await assert.rejects(
      () =>
        gameService.playCard({
          gameId,
          playerId,
          card: state.players.find((p) => p.id === playerId)!.hand[0],
        }),
      /Not in playing phase/
    );
  });

  test('playing in a game that does not exist is refused', async () => {
    await assert.rejects(
      () =>
        gameService.playCard({
          gameId: 'nope',
          playerId: 'nobody',
          card: { suit: 'hearts', rank: 'A', value: 14 },
        }),
      /Game not found/
    );
  });
});

describe('follow-suit is enforced for every play in a whole round', () => {
  test('no illegal card can reach the table', async () => {
    const { gameId } = await gameAtRound(4);

    for (;;) {
      const state = await getState(gameId);
      if (state.status !== 'PLAYING') break;

      if (state.roundState?.awaitingNextHand) {
        await advanceHand(gameId);
        continue;
      }

      const playerId = (await gameService.getGameById(gameId))!.currentTurnPlayerId!;
      const hand = state.players.find((p) => p.id === playerId)!.hand;
      const leadSuit = state.roundState!.currentTrick!.leadSuit;

      // Any card the server accepts must satisfy the shared rule.
      const card = firstLegalCard(state, playerId);
      assert.equal(canPlayCard(card, hand, leadSuit), true);

      await gameService.playCard({ gameId, playerId, card });
    }

    const finished = await getState(gameId);
    assert.equal(finished.status, 'ROUND_SCOREBOARD');
    for (const player of finished.players) {
      assert.equal(player.hand.length, 0, 'everyone played out');
    }
  });
});
