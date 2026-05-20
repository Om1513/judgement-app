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
  TrumpInfo,
  ClientPlayer,
  ClientRoundState,
} from '../types/game';
import { Card, GamePlayer } from '../types/player';
import { LobbySettings } from '../types/lobby';
import { lobbyService } from './lobby.service';
import {
  dealCards,
  getCardsForRound,
  determineTrickWinner,
  canPlayCard,
  calculateScore,
} from '../utils/cardUtils';
import { validateBid } from '../utils/validateLobby';
import {
  generateTrumpOrder,
  getTrumpForRound,
  canBidValue,
} from '../utils/trump';

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

    // Generate trump order for all rounds
    const trumpOrder = generateTrumpOrder(settings.rounds).map(trump => ({
      key: trump.key,
      name: trump.name,
      suit: trump.suit,
      symbol: trump.symbol,
    }));

    // Get trump for round 1
    const round1Trump = trumpOrder[0];

    // Initialize players
    const cardsForRound = getCardsForRound(1, settings.rounds);
    const hands = dealCards(playerCount, cardsForRound);

    // Dealer is first player, bidding starts with next player
    const dealerIndex = 0;
    const firstBidderIndex = (dealerIndex + 1) % playerCount;

    // Create bid order (clockwise from dealer)
    const bidOrder: string[] = [];
    for (let i = 0; i < playerCount; i++) {
      const idx = (firstBidderIndex + i) % playerCount;
      bidOrder.push(turnOrder[idx]);
    }

    const gamePlayers: GamePlayer[] = lobby.players
      .sort((a, b) => a.seatPosition - b.seatPosition)
      .map((p, index) => ({
        id: p.playerId,
        name: p.name,
        seatPosition: p.seatPosition,
        hand: hands[index],
        bid: null,
        tricksWon: 0,
        score: 0,
        isCurrentTurn: p.playerId === bidOrder[0],
      }));

    // Initialize round state
    const roundState: RoundState = {
      roundNumber: 1,
      cardsPerPlayer: cardsForRound,
      trumpSuit: round1Trump.suit as Card['suit'],
      trump: round1Trump,
      dealerId: turnOrder[dealerIndex],
      bids: {},
      tricksWon: {},
      currentTrick: null,
      trickNumber: 0,
      bidOrder,
      currentBidderIndex: 0,
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
      currentTurnIndex: firstBidderIndex,
      trumpOrder,
    };

    // Save game state and create game round record
    await db.game.update({
      where: { id: gameId },
      data: {
        totalRounds: settings.rounds,
        currentRound: 1,
        currentHandSize: cardsForRound,
        currentTurnPlayerId: bidOrder[0],
        status: 'BIDDING',
        trumpOrderJson: trumpOrder as any,
        gameStateJson: gameState as any,
      },
    });

    // Create game round record
    await db.gameRound.create({
      data: {
        gameId,
        roundNumber: 1,
        handSize: cardsForRound,
        trumpKey: round1Trump.key,
        trumpName: round1Trump.name,
        trumpSuit: round1Trump.suit,
        status: 'BIDDING',
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
    const roundState = state.roundState;

    // Build client round state with bidding info
    let clientRoundState: ClientRoundState | null = null;
    if (roundState) {
      const totalBidsSoFar = Object.values(roundState.bids).reduce((sum, b) => sum + b, 0);
      const biddedCount = Object.keys(roundState.bids).length;
      const isLastBidder = biddedCount === state.players.length - 1;
      const currentBidderId = roundState.bidOrder[roundState.currentBidderIndex] || null;

      clientRoundState = {
        roundNumber: roundState.roundNumber,
        cardsPerPlayer: roundState.cardsPerPlayer,
        trumpSuit: roundState.trumpSuit,
        trump: roundState.trump,
        bids: roundState.bids,
        tricksWon: roundState.tricksWon,
        currentTrick: roundState.currentTrick,
        trickNumber: roundState.trickNumber,
        bidOrder: roundState.bidOrder,
        currentBidderIndex: roundState.currentBidderIndex,
        currentBidderId,
        totalBidsSoFar,
        isLastBidder: isLastBidder && currentBidderId === playerId,
      };
    }

    // Build client players with bidding info
    const clientPlayers: ClientPlayer[] = state.players.map(p => ({
      id: p.id,
      name: p.name,
      seatPosition: p.seatPosition,
      bid: p.bid,
      tricksWon: p.tricksWon,
      score: p.score,
      isCurrentTurn: p.isCurrentTurn,
      cardCount: p.hand.length,
      hasBid: roundState ? roundState.bids[p.id] !== undefined : false,
    }));

    return {
      id: game.id,
      lobbyId: game.lobbyId,
      currentRound: state.currentRound,
      totalRounds: state.totalRounds,
      status: state.status,
      players: clientPlayers,
      myHand: currentPlayer?.hand || [],
      currentTurnPlayerId: game.currentTurnPlayerId,
      roundState: clientRoundState,
      scores: state.scores,
      isMyTurn: game.currentTurnPlayerId === playerId,
      trumpOrder: state.trumpOrder,
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

    // Calculate if this is the last player to bid (dealer is always last)
    const totalBidsSoFar = Object.values(roundState.bids).reduce((sum, b) => sum + b, 0);
    const biddedCount = Object.keys(roundState.bids).length;
    const isLastBidder = biddedCount === state.players.length - 1;

    // Validate bid using trump utility
    const bidValidation = canBidValue(
      input.bid,
      roundState.cardsPerPlayer,
      totalBidsSoFar,
      isLastBidder
    );

    if (!bidValidation.valid) {
      throw new Error(bidValidation.reason || 'Invalid bid');
    }

    // Record bid
    roundState.bids[input.playerId] = input.bid;

    // Update player's bid
    const playerIndex = state.players.findIndex(p => p.id === input.playerId);
    state.players[playerIndex].bid = input.bid;

    // Get current game round to save bid
    const gameRound = await db.gameRound.findFirst({
      where: { gameId: input.gameId, roundNumber: roundState.roundNumber },
    });

    if (gameRound) {
      // Save bid to round_bids table
      await db.roundBid.create({
        data: {
          gameId: input.gameId,
          roundId: gameRound.id,
          playerId: input.playerId,
          bidValue: input.bid,
        },
      });
    }

    // Log action
    await this.logAction(input.gameId, input.playerId, 'BID_SUBMIT', { bid: input.bid });

    // Check if all bids are in
    if (Object.keys(roundState.bids).length === state.players.length) {
      // Move to playing phase
      state.status = 'PLAYING';
      roundState.trickNumber = 1;

      // Player after dealer leads (first bidder)
      const firstPlayerId = roundState.bidOrder[0];
      const firstPlayerIndex = state.turnOrder.indexOf(firstPlayerId);

      roundState.currentTrick = {
        leadPlayerId: firstPlayerId,
        leadSuit: null,
        cardsPlayed: [],
        winnerId: null,
      };
      state.currentTurnIndex = firstPlayerIndex;

      // Update game round status
      if (gameRound) {
        await db.gameRound.update({
          where: { id: gameRound.id },
          data: { status: 'PLAYING' },
        });
      }
    } else {
      // Move to next bidder
      roundState.currentBidderIndex++;
      state.currentTurnIndex = state.turnOrder.indexOf(
        roundState.bidOrder[roundState.currentBidderIndex]
      );
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
    const db = getDB();
    const cardsForRound = getCardsForRound(state.currentRound, state.totalRounds);
    const hands = dealCards(state.players.length, cardsForRound);

    // Reset players for new round
    state.players.forEach((p, index) => {
      p.hand = hands[index];
      p.bid = null;
      p.tricksWon = 0;
    });

    // Rotate dealer (each round dealer moves clockwise)
    const dealerIndex = (state.currentRound - 1) % state.players.length;
    const firstBidderIndex = (dealerIndex + 1) % state.players.length;

    // Create bid order (clockwise from dealer, dealer bids last)
    const bidOrder: string[] = [];
    for (let i = 0; i < state.players.length; i++) {
      const idx = (firstBidderIndex + i) % state.players.length;
      bidOrder.push(state.turnOrder[idx]);
    }

    // Get trump from pre-generated order (0-indexed)
    const roundTrump = state.trumpOrder[state.currentRound - 1];

    // Create new round state
    state.roundState = {
      roundNumber: state.currentRound,
      cardsPerPlayer: cardsForRound,
      trumpSuit: roundTrump.suit as Card['suit'],
      trump: roundTrump,
      dealerId: state.turnOrder[dealerIndex],
      bids: {},
      tricksWon: {},
      currentTrick: null,
      trickNumber: 0,
      bidOrder,
      currentBidderIndex: 0,
    };

    state.status = 'BIDDING';
    state.currentTurnIndex = firstBidderIndex;

    // Update current turn markers
    state.players.forEach(p => {
      p.isCurrentTurn = p.id === bidOrder[0];
    });

    // Create game round record
    await db.gameRound.create({
      data: {
        gameId,
        roundNumber: state.currentRound,
        handSize: cardsForRound,
        trumpKey: roundTrump.key,
        trumpName: roundTrump.name,
        trumpSuit: roundTrump.suit,
        status: 'BIDDING',
      },
    });

    // Log round start
    await this.logAction(gameId, state.turnOrder[dealerIndex], 'ROUND_START', {
      round: state.currentRound,
      trump: roundTrump,
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
