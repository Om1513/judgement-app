// Bots as players.
//
// The rule these tests exist to protect: a bot is not special. It is added to a
// lobby like anyone else, and its bids and cards go through the same
// gameService validation a human's do - there is no bot fast path around the
// rules.

import test, { describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { db, resetDatabase, closeDatabase } from '../helpers/db';
import { createLobbyWithPlayers, addBots, startGame, getState } from '../helpers/gameFlow';
import { lobbyService } from '../../services/lobby.service';
import { botService } from '../../services/bot.service';
import { gameService } from '../../services/game.service';
import { chooseBotBid, chooseBotCard } from '../../utils/bot.strategy';
import { canPlayCard } from '../../utils/cardUtils';
import { canBidValue } from '../../utils/trump';

beforeEach(async () => {
  await resetDatabase();
});

after(async () => {
  await closeDatabase();
});

describe('adding bots to a lobby', () => {
  test('a host alone plus three bots makes a startable four-player table', async () => {
    const { lobbyId, hostId } = await createLobbyWithPlayers(1);

    const botIds = await addBots(lobbyId, hostId, 3);

    const lobby = await lobbyService.getLobbyById(lobbyId);
    assert.equal(lobby?.playerCount, 4);
    assert.equal(lobby?.canStart, true);
    assert.equal(lobby?.players.filter((p) => p.isBot).length, 3);
    assert.deepEqual(
      lobby?.players.filter((p) => p.isBot).map((p) => p.playerId).sort(),
      [...botIds].sort()
    );
  });

  test('bots take the next free seats, in order', async () => {
    const { lobbyId, hostId } = await createLobbyWithPlayers(2);
    await addBots(lobbyId, hostId, 2);

    const lobby = await lobbyService.getLobbyById(lobbyId);
    assert.deepEqual(
      lobby?.players.map((p) => p.seatPosition),
      [0, 1, 2, 3]
    );
    assert.deepEqual(
      lobby?.players.map((p) => p.isBot),
      [false, false, true, true]
    );
  });

  test('each bot gets its own name', async () => {
    const { lobbyId, hostId } = await createLobbyWithPlayers(1);
    await addBots(lobbyId, hostId, 5);

    const lobby = await lobbyService.getLobbyById(lobbyId);
    const names = lobby!.players.filter((p) => p.isBot).map((p) => p.name);
    assert.equal(new Set(names).size, names.length, 'no duplicate bot names');
  });

  test('bots are flagged as bots in the database', async () => {
    const { lobbyId, hostId } = await createLobbyWithPlayers(1);
    const [botId] = await addBots(lobbyId, hostId, 1);

    const row = await db.player.findUnique({ where: { id: botId } });
    assert.equal(row?.isBot, true);
    assert.equal(row?.socketId, null, 'a bot has no connection');
    assert.equal(row?.botDifficulty, 'normal');
  });

  test('only the host can add a bot', async () => {
    const { lobbyId, playerIds } = await createLobbyWithPlayers(2);
    await assert.rejects(
      () => botService.addBotToLobby(lobbyId, playerIds[1]),
      /Only the host can add bots/
    );
  });

  test('a full lobby will not take another bot', async () => {
    const { lobbyId, hostId } = await createLobbyWithPlayers(2, { maxPlayers: 3 });
    await addBots(lobbyId, hostId, 1);

    await assert.rejects(() => botService.addBotToLobby(lobbyId, hostId), /Lobby is full/);
  });

  test('bots cannot be added once the game has started', async () => {
    const { lobbyId, hostId } = await createLobbyWithPlayers(1);
    await addBots(lobbyId, hostId, 1);
    await startGame(lobbyId, hostId);

    await assert.rejects(
      () => botService.addBotToLobby(lobbyId, hostId),
      /Cannot add bots after game has started/
    );
  });

  test('the host can remove a bot like any other player', async () => {
    const { lobbyId, hostId } = await createLobbyWithPlayers(1);
    const [botId] = await addBots(lobbyId, hostId, 2);

    const after = await lobbyService.kickPlayer(lobbyId, hostId, botId);

    assert.equal(after.playerCount, 2);
    assert.ok(!after.players.some((p) => p.playerId === botId));
  });
});

describe('a game with bots at the table', () => {
  test('bots are dealt in and seated exactly like humans', async () => {
    const { lobbyId, hostId } = await createLobbyWithPlayers(1);
    const botIds = await addBots(lobbyId, hostId, 3);
    const gameId = await startGame(lobbyId, hostId);

    const state = await getState(gameId);
    assert.equal(state.players.length, 4);
    assert.deepEqual(state.turnOrder, [hostId, ...botIds]);
    for (const player of state.players) {
      assert.equal(player.hand.length, 1, 'every seat, bot or not, was dealt');
    }
  });

  test('a bot bid goes through the same validator as a human bid', async () => {
    const { lobbyId, hostId } = await createLobbyWithPlayers(1);
    await addBots(lobbyId, hostId, 3);
    const gameId = await startGame(lobbyId, hostId);

    const state = await getState(gameId);
    const { bidOrder, cardsPerPlayer, trumpSuit } = state.roundState!;
    const botId = bidOrder.find((id) => id !== hostId)!;

    // Bid down the order until it is the bot's turn.
    for (const playerId of bidOrder) {
      if (playerId === botId) break;
      await gameService.submitBid({ gameId, playerId, bid: 0 });
    }

    const current = await getState(gameId);
    const bot = current.players.find((p) => p.id === botId)!;
    const totalBidsSoFar = Object.values(current.roundState!.bids).reduce((a, b) => a + b, 0);
    const isLastBidder =
      Object.keys(current.roundState!.bids).length === current.players.length - 1;

    const bid = chooseBotBid(bot.hand, trumpSuit!, cardsPerPlayer, totalBidsSoFar, isLastBidder);

    assert.equal(
      canBidValue(bid, cardsPerPlayer, totalBidsSoFar, isLastBidder).valid,
      true,
      'the bot chose a bid the game would reject'
    );

    // And the real service accepts it - no bot-only bypass involved.
    await gameService.submitBid({ gameId, playerId: botId, bid });
    assert.equal((await getState(gameId)).roundState?.bids[botId], bid);
  });

  test('a bot is refused when it is not its turn, exactly like a human', async () => {
    const { lobbyId, hostId } = await createLobbyWithPlayers(1);
    const botIds = await addBots(lobbyId, hostId, 3);
    const gameId = await startGame(lobbyId, hostId);

    const { bidOrder } = (await getState(gameId)).roundState!;
    const outOfTurnBot = botIds.find((id) => id !== bidOrder[0])!;

    await assert.rejects(
      () => gameService.submitBid({ gameId, playerId: outOfTurnBot, bid: 0 }),
      /Not your turn/
    );
  });

  test('a bot only ever plays a legal card from its own hand', async () => {
    const { lobbyId, hostId } = await createLobbyWithPlayers(1);
    await addBots(lobbyId, hostId, 3);
    const gameId = await startGame(lobbyId, hostId);

    // Round 1, everyone bids 0.
    const { bidOrder } = (await getState(gameId)).roundState!;
    for (const playerId of bidOrder) {
      await gameService.submitBid({ gameId, playerId, bid: 0 });
    }

    let plays = 0;
    for (;;) {
      const game = await gameService.getGameById(gameId);
      const state = game!.gameState;
      if (state.status !== 'PLAYING' || state.roundState?.awaitingNextHand) break;

      const playerId = game!.currentTurnPlayerId!;
      const player = state.players.find((p) => p.id === playerId)!;
      const trick = state.roundState!.currentTrick!;

      const card = chooseBotCard(
        player.hand,
        trick.leadSuit,
        state.roundState!.trumpSuit!,
        player.bid ?? 0,
        player.tricksWon,
        trick.cardsPlayed
      );

      assert.ok(
        player.hand.some((c) => c.suit === card.suit && c.rank === card.rank),
        'the card came from the bot own hand'
      );
      assert.equal(
        canPlayCard(card, player.hand, trick.leadSuit),
        true,
        'the card follows suit'
      );

      // Through the real service - it would reject anything illegal.
      await gameService.playCard({ gameId, playerId, card });
      plays++;
    }

    assert.equal(plays, 4, 'all four seats played');
  });

  test('a bot cannot see another player hand - it is only ever handed its own', async () => {
    const { lobbyId, hostId } = await createLobbyWithPlayers(1);
    const botIds = await addBots(lobbyId, hostId, 3);
    const gameId = await startGame(lobbyId, hostId);

    const game = await gameService.getGameById(gameId);
    const view = gameService.getClientGameState(game!, botIds[0]);

    // The client projection a bot would receive contains only its own cards.
    assert.equal(view.myHand.length, 1);
    for (const player of view.players) {
      assert.equal('hand' in player, false, 'no hands are exposed to other seats');
    }
  });

  test('the game state persists bots the same as humans across a reload', async () => {
    const { lobbyId, hostId } = await createLobbyWithPlayers(1);
    const botIds = await addBots(lobbyId, hostId, 3);
    const gameId = await startGame(lobbyId, hostId);

    const first = await getState(gameId);
    const second = await getState(gameId);

    assert.deepEqual(second.turnOrder, first.turnOrder);
    for (const botId of botIds) {
      assert.deepEqual(
        second.players.find((p) => p.id === botId)?.hand,
        first.players.find((p) => p.id === botId)?.hand
      );
    }
  });
});

describe('bot scheduling', () => {
  test('does nothing when the seat on turn is a human', async () => {
    const { lobbyId, hostId } = await createLobbyWithPlayers(4);
    const gameId = await startGame(lobbyId, hostId);

    const before = await getState(gameId);
    await botService.processPendingBotActions(gameId);
    // No bots exist, so nothing may change.
    assert.deepEqual(await getState(gameId), before);
  });

  test('does nothing for a finished game', async () => {
    const { lobbyId, hostId } = await createLobbyWithPlayers(1);
    await addBots(lobbyId, hostId, 1);
    const gameId = await startGame(lobbyId, hostId);

    const game = await gameService.getGameById(gameId);
    const state = game!.gameState;
    state.status = 'GAME_OVER';
    await db.game.update({
      where: { id: gameId },
      data: { status: 'GAME_OVER', gameStateJson: state as never },
    });

    const before = await getState(gameId);
    await botService.processPendingBotActions(gameId);
    assert.deepEqual(await getState(gameId), before);
  });

  test('does nothing for a game that does not exist', async () => {
    await botService.processPendingBotActions('no-such-game');
  });
});
