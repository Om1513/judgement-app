// Game service - handles game logic and state management

import { getDB } from '../db/connection';
import {
  Game,
  GameState,
  GameStatus,
  ClientGameState,
  SubmitBidInput,
  PlayCardInput,
  RoundState,
  Trick,
} from '../types/game';
import { Card, GamePlayer } from '../types/player';
import { LobbySettings } from '../types/lobby';
import { lobbyService } from './lobby.service';
import {
  dealCards,
  pickTrumpSuit,
  getCardsForRound,
  determineTrickWinner,
  canPlayCard,
  calculateScore,
} from '../utils/cardUtils';
import { validateBid } from '../utils/validateLobby';

export class GameService {
  /**
   * Initializes a new game from a lobby.
   */
  async initializeGame(gameId: string, lobbyId: string): Promise<GameState> {
    const db = getDB();

    const lobby = await lobbyService.getLobbyById(lobbyId);
    if (!lobby) {
      throw new Error('Lobby not found');
    }

    const settings = lobby.settings;
    const playerCount = lobby.players.length;

    // Create turn order based on seat positions
    const turnOrder = lobby.players
      .sort((a, b) => a.seatPosition - b.seatPosition)
      .map(p => p.playerId);

    // Initialize players
    const cardsForRound = getCardsForRound(1, settings.rounds);
    const hands = dealCards(playerCount, cardsForRound);

    const gamePlayers: GamePlayer[] = lobby.players.map((p, index) => ({
      id: p.playerId,
      name: p.name,
      seatPosition: p.seatPosition,
      hand: hands[index],
      bid: null,
      tricksWon: 0,
      score: 0,
      isCurrentTurn: index === 0,
    }));

    // Initialize round state
    const roundState: RoundState = {
      roundNumber: 1,
      cardsPerPlayer: cardsForRound,
      trumpSuit: pickTrumpSuit(),
      dealerId: turnOrder[0],
      bids: {},
      tricksWon: {},
      currentTrick: null,
      trickNumber: 0,
    };

    // Initialize game state
    const gameState: GameState = {
      players: gamePlayers,
      currentRound: 1,
      totalRounds: settings.rounds,
      status: 'BIDDING',
      roundState,
      scores: Object.fromEntries(turnOrder.map(id => [id, 0])),
      settings,
      turnOrder,
      currentTurnIndex: 0,
    };

    // Save game state
    await db.game.update({
      where: { id: gameId },
      data: {
        currentRound: 1,
        currentTurnPlayerId: turnOrder[0],
        status: 'BIDDING',
        gameStateJson: gameState as any,
      },
    });

    // Log game start action
    await this.logAction(gameId, turnOrder[0], 'GAME_START', { players: turnOrder });

    return gameState;
  }

  /**
   * Gets the full game state by ID.
   */
  async getGameById(gameId: string): Promise<Game | null> {
    const db = getDB();

    const game = await db.game.findUnique({
      where: { id: gameId },
    });

    if (!game) {
      return null;
    }

    return {
      id: game.id,
      lobbyId: game.lobbyId,
      currentRound: game.currentRound,
      currentTurnPlayerId: game.currentTurnPlayerId,
      status: game.status as GameStatus,
      gameState: game.gameStateJson as unknown as GameState,
      createdAt: game.createdAt,
    };
  }

  /**
   * Gets the game for a specific lobby.
   */
  async getGameByLobbyId(lobbyId: string): Promise<Game | null> {
    const db = getDB();

    const game = await db.game.findFirst({
      where: { lobbyId },
      orderBy: { createdAt: 'desc' },
    });

    if (!game) {
      return null;
    }

    return {
      id: game.id,
      lobbyId: game.lobbyId,
      currentRound: game.currentRound,
      currentTurnPlayerId: game.currentTurnPlayerId,
      status: game.status as GameStatus,
      gameState: game.gameStateJson as unknown as GameState,
      createdAt: game.createdAt,
    };
  }

  /**
   * Gets the client-facing game state for a specific player.
   * Hides other players' cards.
   */
  getClientGameState(game: Game, playerId: string): ClientGameState {
    const state = game.gameState;
    const currentPlayer = state.players.find(p => p.id === playerId);

    return {
      id: game.id,
      lobbyId: game.lobbyId,
      currentRound: state.currentRound,
      totalRounds: state.totalRounds,
      status: state.status,
      players: state.players.map(p => ({
        id: p.id,
        name: p.name,
        seatPosition: p.seatPosition,
        bid: p.bid,
        tricksWon: p.tricksWon,
        score: p.score,
        isCurrentTurn: p.isCurrentTurn,
        cardCount: p.hand.length,
      })),
      myHand: currentPlayer?.hand || [],
      currentTurnPlayerId: game.currentTurnPlayerId,
      roundState: state.roundState ? {
        roundNumber: state.roundState.roundNumber,
        cardsPerPlayer: state.roundState.cardsPerPlayer,
        trumpSuit: state.roundState.trumpSuit,
        bids: state.roundState.bids,
        tricksWon: state.roundState.tricksWon,
        currentTrick: state.roundState.currentTrick,
        trickNumber: state.roundState.trickNumber,
      } : null,
      scores: state.scores,
      isMyTurn: game.currentTurnPlayerId === playerId,
    };
  }

  /**
   * Submits a bid for the current player.
   */
  async submitBid(input: SubmitBidInput): Promise<GameState> {
    const db = getDB();
    const game = await this.getGameById(input.gameId);

    if (!game) {
      throw new Error('Game not found');
    }

    if (game.status !== 'BIDDING') {
      throw new Error('Not in bidding phase');
    }

    if (game.currentTurnPlayerId !== input.playerId) {
      throw new Error('Not your turn');
    }

    const state = game.gameState;
    const roundState = state.roundState!;

    // Calculate if this is the last player to bid
    const totalBidsSoFar = Object.values(roundState.bids).reduce((sum, b) => sum + b, 0);
    const biddedCount = Object.keys(roundState.bids).length;
    const isLastPlayer = biddedCount === state.players.length - 1;

    // Validate bid
    const bidValidation = validateBid(
      input.bid,
      roundState.cardsPerPlayer,
      totalBidsSoFar,
      isLastPlayer
    );

    if (!bidValidation.valid) {
      throw new Error(bidValidation.error || 'Invalid bid');
    }

    // Record bid
    roundState.bids[input.playerId] = input.bid;

    // Update player's bid
    const playerIndex = state.players.findIndex(p => p.id === input.playerId);
    state.players[playerIndex].bid = input.bid;

    // Log action
    await this.logAction(input.gameId, input.playerId, 'BID_SUBMIT', { bid: input.bid });

    // Check if all bids are in
    if (Object.keys(roundState.bids).length === state.players.length) {
      // Move to playing phase
      state.status = 'PLAYING';
      roundState.trickNumber = 1;
      roundState.currentTrick = {
        leadPlayerId: state.turnOrder[0],
        leadSuit: null,
        cardsPlayed: [],
        winnerId: null,
      };
      state.currentTurnIndex = 0;
    } else {
      // Move to next player
      state.currentTurnIndex = (state.currentTurnIndex + 1) % state.players.length;
    }

    // Update current turn
    const nextPlayerId = state.turnOrder[state.currentTurnIndex];
    state.players.forEach(p => {
      p.isCurrentTurn = p.id === nextPlayerId;
    });

    // Save state
    await db.game.update({
      where: { id: input.gameId },
      data: {
        status: state.status,
        currentTurnPlayerId: nextPlayerId,
        gameStateJson: state as any,
      },
    });

    return state;
  }

  /**
   * Plays a card.
   */
  async playCard(input: PlayCardInput): Promise<{ state: GameState; trickComplete: boolean; roundComplete: boolean }> {
    const db = getDB();
    const game = await this.getGameById(input.gameId);

    if (!game) {
      throw new Error('Game not found');
    }

    if (game.status !== 'PLAYING') {
      throw new Error('Not in playing phase');
    }

    if (game.currentTurnPlayerId !== input.playerId) {
      throw new Error('Not your turn');
    }

    const state = game.gameState;
    const roundState = state.roundState!;
    const trick = roundState.currentTrick!;

    // Find player and their hand
    const player = state.players.find(p => p.id === input.playerId)!;
    const cardIndex = player.hand.findIndex(
      c => c.suit === input.card.suit && c.rank === input.card.rank
    );

    if (cardIndex === -1) {
      throw new Error('Card not in hand');
    }

    // Validate card play
    if (!canPlayCard(input.card, player.hand, trick.leadSuit)) {
      throw new Error('Invalid card play - must follow suit if possible');
    }

    // Remove card from hand
    player.hand.splice(cardIndex, 1);

    // Add to trick
    if (trick.cardsPlayed.length === 0) {
      trick.leadSuit = input.card.suit;
    }
    trick.cardsPlayed.push({ playerId: input.playerId, card: input.card });

    // Log action
    await this.logAction(input.gameId, input.playerId, 'CARD_PLAY', { card: input.card });

    let trickComplete = false;
    let roundComplete = false;

    // Check if trick is complete
    if (trick.cardsPlayed.length === state.players.length) {
      trickComplete = true;

      // Determine winner
      const winnerId = determineTrickWinner(
        trick.cardsPlayed,
        trick.leadSuit!,
        roundState.trumpSuit
      );
      trick.winnerId = winnerId;

      // Update tricks won
      roundState.tricksWon[winnerId] = (roundState.tricksWon[winnerId] || 0) + 1;
      const winnerPlayer = state.players.find(p => p.id === winnerId)!;
      winnerPlayer.tricksWon++;

      // Check if round is complete
      if (player.hand.length === 0) {
        roundComplete = true;

        // Calculate scores
        for (const p of state.players) {
          const roundScore = calculateScore(
            p.bid!,
            p.tricksWon,
            state.settings.scoringMode
          );
          p.score += roundScore;
          state.scores[p.id] = p.score;
        }

        // Log round end
        await this.logAction(input.gameId, input.playerId, 'ROUND_END', {
          round: roundState.roundNumber,
          scores: state.scores,
        });

        // Check if game is over
        if (state.currentRound >= state.totalRounds) {
          state.status = 'GAME_OVER';

          // Log game end
          await this.logAction(input.gameId, input.playerId, 'GAME_END', {
            finalScores: state.scores,
          });
        } else {
          // Start next round
          state.currentRound++;
          await this.startNewRound(state, input.gameId);
        }
      } else {
        // Start new trick, winner leads
        const winnerIndex = state.turnOrder.indexOf(winnerId);
        state.currentTurnIndex = winnerIndex;

        roundState.trickNumber++;
        roundState.currentTrick = {
          leadPlayerId: winnerId,
          leadSuit: null,
          cardsPlayed: [],
          winnerId: null,
        };
      }
    } else {
      // Move to next player
      state.currentTurnIndex = (state.currentTurnIndex + 1) % state.players.length;
    }

    // Update current turn
    const nextPlayerId = state.turnOrder[state.currentTurnIndex];
    state.players.forEach(p => {
      p.isCurrentTurn = p.id === nextPlayerId;
    });

    // Save state
    await db.game.update({
      where: { id: input.gameId },
      data: {
        currentRound: state.currentRound,
        status: state.status,
        currentTurnPlayerId: nextPlayerId,
        gameStateJson: state as any,
      },
    });

    return { state, trickComplete, roundComplete };
  }

  /**
   * Starts a new round.
   */
  private async startNewRound(state: GameState, gameId: string): Promise<void> {
    const cardsForRound = getCardsForRound(state.currentRound, state.totalRounds);
    const hands = dealCards(state.players.length, cardsForRound);

    // Reset players for new round
    state.players.forEach((p, index) => {
      p.hand = hands[index];
      p.bid = null;
      p.tricksWon = 0;
    });

    // Rotate dealer
    const dealerIndex = (state.currentRound - 1) % state.players.length;
    state.currentTurnIndex = (dealerIndex + 1) % state.players.length;

    // Create new round state
    state.roundState = {
      roundNumber: state.currentRound,
      cardsPerPlayer: cardsForRound,
      trumpSuit: pickTrumpSuit(),
      dealerId: state.turnOrder[dealerIndex],
      bids: {},
      tricksWon: {},
      currentTrick: null,
      trickNumber: 0,
    };

    state.status = 'BIDDING';

    // Log round start
    await this.logAction(gameId, state.turnOrder[dealerIndex], 'ROUND_START', {
      round: state.currentRound,
      trumpSuit: state.roundState.trumpSuit,
    });
  }

  /**
   * Logs a game action.
   */
  private async logAction(
    gameId: string,
    playerId: string,
    actionType: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    const db = getDB();

    await db.gameAction.create({
      data: {
        gameId,
        playerId,
        actionType: actionType as any,
        actionPayload: payload as any,
      },
    });
  }

  /**
   * Gets the winner of a completed game.
   */
  getWinner(state: GameState): { id: string; name: string; score: number } | null {
    if (state.status !== 'GAME_OVER') {
      return null;
    }

    let winner = state.players[0];
    for (const player of state.players) {
      if (player.score > winner.score) {
        winner = player;
      }
    }

    return {
      id: winner.id,
      name: winner.name,
      score: winner.score,
    };
  }
}

// Export singleton instance
export const gameService = new GameService();
