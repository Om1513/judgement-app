// Fixtures and drivers for the integration suites.
//
// These go through the real services - playerService, lobbyService,
// gameService, scoreboardService - and never poke the database directly to set
// up state. A test that reaches a scoreboard got there by actually bidding and
// playing every card, so the assertions are about real behaviour rather than
// hand-arranged rows.

import { db } from './db';
import { playerService } from '../../services/player.service';
import { lobbyService } from '../../services/lobby.service';
import { gameService } from '../../services/game.service';
import { botService } from '../../services/bot.service';
import { LobbySettings } from '../../types/lobby';
import { Card } from '../../types/player';
import { GameState } from '../../types/game';
import { canPlayCard } from '../../utils/cardUtils';

export interface TestLobby {
  lobbyId: string;
  code: string;
  hostId: string;
  playerIds: string[];
}

/**
 * Creates `count` real players and puts them in a fresh lobby, first one host.
 */
export async function createLobbyWithPlayers(
  count: number,
  settings?: Partial<LobbySettings>
): Promise<TestLobby> {
  const players = [];
  for (let i = 0; i < count; i++) {
    players.push(
      await playerService.createPlayer({
        name: `Player${i + 1}`,
        clientId: `client-${Math.random().toString(36).slice(2)}-${i}`,
      })
    );
  }

  const lobby = await lobbyService.createLobby({
    hostPlayerId: players[0].id,
    hostName: players[0].name,
    settings,
  });

  for (const player of players.slice(1)) {
    await lobbyService.joinLobby({
      code: lobby.code,
      playerId: player.id,
      playerName: player.name,
    });
  }

  return {
    lobbyId: lobby.id,
    code: lobby.code,
    hostId: players[0].id,
    playerIds: players.map((p) => p.id),
  };
}

/** Adds `count` bots to a lobby as the host would. */
export async function addBots(lobbyId: string, hostId: string, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const bot = await botService.addBotToLobby(lobbyId, hostId);
    ids.push(bot.id);
  }
  return ids;
}

/** Starts the game and initializes its state, exactly as the socket handler does. */
export async function startGame(lobbyId: string, hostId: string): Promise<string> {
  const { gameId } = await lobbyService.startGame(lobbyId, hostId);
  await gameService.initializeGame(gameId, lobbyId);
  return gameId;
}

export async function getState(gameId: string): Promise<GameState> {
  const game = await gameService.getGameById(gameId);
  if (!game) throw new Error(`Game ${gameId} not found`);
  return game.gameState;
}

/**
 * Bids for every player in bid order until the round moves to PLAYING.
 *
 * `chooseBid` receives the bidding context and defaults to zero, which is
 * always legal: the dealer's forbidden value is `handSize - totalBidsSoFar`,
 * and with everyone on zero that is `handSize`, never 0.
 */
export async function submitAllBids(
  gameId: string,
  chooseBid: (ctx: {
    playerId: string;
    handSize: number;
    totalBidsSoFar: number;
    isLastBidder: boolean;
    hand: Card[];
  }) => number = () => 0
): Promise<Record<string, number>> {
  const submitted: Record<string, number> = {};

  for (;;) {
    const game = await gameService.getGameById(gameId);
    if (!game || game.gameState.status !== 'BIDDING') break;

    const state = game.gameState;
    const roundState = state.roundState!;
    const playerId = game.currentTurnPlayerId!;
    const player = state.players.find((p) => p.id === playerId)!;

    const totalBidsSoFar = Object.values(roundState.bids).reduce((a, b) => a + b, 0);
    const isLastBidder = Object.keys(roundState.bids).length === state.players.length - 1;

    const bid = chooseBid({
      playerId,
      handSize: roundState.cardsPerPlayer,
      totalBidsSoFar,
      isLastBidder,
      hand: player.hand,
    });

    await gameService.submitBid({ gameId, playerId, bid });
    submitted[playerId] = bid;
  }

  return submitted;
}

/** First legal card in the current player's hand. */
export function firstLegalCard(state: GameState, playerId: string): Card {
  const player = state.players.find((p) => p.id === playerId)!;
  const leadSuit = state.roundState?.currentTrick?.leadSuit ?? null;
  const card = player.hand.find((c) => canPlayCard(c, player.hand, leadSuit));
  if (!card) throw new Error(`No legal card for ${playerId}`);
  return card;
}

export interface TrickResult {
  winnerId: string;
  cardsPlayed: { playerId: string; card: Card }[];
  roundComplete: boolean;
}

/**
 * Plays one complete trick, one legal card per player, and returns the winner.
 * Does not advance past the inter-hand pause - see `advanceHand`.
 */
export async function playTrick(
  gameId: string,
  pickCard: (state: GameState, playerId: string) => Card = firstLegalCard
): Promise<TrickResult> {
  let roundComplete = false;

  for (;;) {
    const game = await gameService.getGameById(gameId);
    if (!game) throw new Error('Game vanished mid-trick');

    const state = game.gameState;
    if (state.status !== 'PLAYING') break;

    const roundState = state.roundState!;
    if (roundState.awaitingNextHand) break;

    const playerId = game.currentTurnPlayerId;
    if (!playerId) break;

    const card = pickCard(state, playerId);
    const result = await gameService.playCard({ gameId, playerId, card });
    roundComplete = roundComplete || result.roundComplete;

    if (result.trickComplete) break;
  }

  const state = await getState(gameId);
  const winnerId = state.roundState?.currentTrick?.winnerId ?? '';
  return {
    winnerId,
    cardsPlayed: state.roundState?.currentTrick?.cardsPlayed ?? [],
    roundComplete,
  };
}

/** Clears the hand-winner pause so the next trick can be led. */
export async function advanceHand(gameId: string): Promise<void> {
  await gameService.advanceToNextTrick(gameId);
}

/** Bids and plays a whole round, leaving the game on the round scoreboard. */
export async function playOutRound(
  gameId: string,
  chooseBid?: Parameters<typeof submitAllBids>[1],
  pickCard?: (state: GameState, playerId: string) => Card
): Promise<void> {
  await submitAllBids(gameId, chooseBid);

  for (;;) {
    const state = await getState(gameId);
    if (state.status !== 'PLAYING') break;

    await playTrick(gameId, pickCard);

    const after = await getState(gameId);
    if (after.roundState?.awaitingNextHand) {
      await advanceHand(gameId);
    }
  }
}

/**
 * Plays whole rounds until the game is sitting at the start of `roundNumber`.
 * Used by tests that need a hand size bigger than round 1's single card.
 */
export async function advanceToRound(gameId: string, roundNumber: number): Promise<void> {
  for (;;) {
    const state = await getState(gameId);
    if (state.currentRound >= roundNumber) return;

    await playOutRound(gameId);
    await continueAll(gameId);
    await gameService.advanceToNextRound(gameId);
  }
}

/** Every player in the lobby clicks Continue. */
export async function continueAll(gameId: string): Promise<void> {
  const { scoreboardService } = await import('../../services/scoreboard.service');
  const game = await gameService.getGameById(gameId);
  if (!game) throw new Error('Game not found');

  const lobby = await lobbyService.getLobbyById(game.lobbyId);
  if (!lobby) throw new Error('Lobby not found');

  for (const player of lobby.players) {
    await scoreboardService.playerContinue(gameId, player.playerId);
  }
}

/** Row counts, for asserting that a flow actually persisted something. */
export async function countRows(gameId: string) {
  const [bids, scores, rounds, actions, confirmations] = await Promise.all([
    db.roundBid.count({ where: { gameId } }),
    db.roundScore.count({ where: { gameId } }),
    db.gameRound.count({ where: { gameId } }),
    db.gameAction.count({ where: { gameId } }),
    db.scoreboardConfirmation.count({ where: { gameId } }),
  ]);
  return { bids, scores, rounds, actions, confirmations };
}
