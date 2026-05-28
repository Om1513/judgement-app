// Bot service - handles bot creation and automated bot actions

import { Server } from 'socket.io';
import { getDB } from '../db/connection';
import { Player } from '../types/player';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from '../types/socket';
import { gameService } from './game.service';
import { lobbyService } from './lobby.service';
import { chooseBotBid, chooseBotCard } from '../utils/bot.strategy';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

// Bot configuration
const BOT_NAMES = [
  'Omkar',
  'Riya',
  'Judge',
  'Maya',
  'Ace',
  'Chai',
  'Raja',
  'Queen',
];

const BOT_TIMING = {
  BID_MIN: 700,
  BID_MAX: 1800,
  PLAY_MIN: 900,
  PLAY_MAX: 2200,
};

// Action locks to prevent duplicate bot actions
const actionLocks = new Map<string, boolean>();

export class BotService {
  private io: TypedServer | null = null;

  /**
   * Sets the Socket.IO server instance for emitting events.
   */
  setIO(io: TypedServer): void {
    this.io = io;
  }

  /**
   * Adds a bot to a lobby.
   */
  async addBotToLobby(lobbyId: string, hostPlayerId: string): Promise<Player> {
    const db = getDB();

    // Get the lobby
    const lobby = await lobbyService.getLobbyById(lobbyId);
    if (!lobby) {
      throw new Error('Lobby not found');
    }

    // Validate host
    if (lobby.hostPlayerId !== hostPlayerId) {
      throw new Error('Only the host can add bots');
    }

    // Check lobby status
    if (lobby.status !== 'WAITING') {
      throw new Error('Cannot add bots after game has started');
    }

    // Check player count
    if (lobby.playerCount >= lobby.settings.maxPlayers) {
      throw new Error('Lobby is full');
    }

    // Get existing bot names in this lobby (bots are identified by isBot flag)
    const existingBotNames = lobby.players
      .filter(p => p.isBot)
      .map(p => p.name);

    // Find an available bot name
    const availableName = BOT_NAMES.find(name => !existingBotNames.includes(name));
    if (!availableName) {
      throw new Error('No more bot names available');
    }

    // Create bot player
    const botPlayer = await db.player.create({
      data: {
        name: availableName,
        socketId: null,
        isBot: true,
        botDifficulty: 'normal',
      },
    });

    // Find next available seat position
    const usedSeats = new Set(lobby.players.map(p => p.seatPosition));
    let nextSeat = 0;
    while (usedSeats.has(nextSeat)) {
      nextSeat++;
    }

    // Add bot to lobby
    await db.lobbyPlayer.create({
      data: {
        lobbyId,
        playerId: botPlayer.id,
        isHost: false,
        seatPosition: nextSeat,
      },
    });

    console.log(`Bot ${availableName} added to lobby ${lobby.code}`);

    return {
      id: botPlayer.id,
      name: botPlayer.name,
      socketId: null,
      isBot: botPlayer.isBot,
      botDifficulty: botPlayer.botDifficulty,
      createdAt: botPlayer.createdAt,
    };
  }

  /**
   * Gets a random delay for bot actions.
   */
  private getRandomDelay(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Broadcasts updated game state to all players in the lobby.
   */
  private async broadcastGameState(gameId: string): Promise<void> {
    if (!this.io) {
      console.error('Socket.IO server not initialized in bot service');
      return;
    }

    const game = await gameService.getGameById(gameId);
    if (!game) {
      return;
    }

    const lobby = await lobbyService.getLobbyById(game.lobbyId);
    if (!lobby) {
      return;
    }

    // Get all sockets in the lobby room
    const sockets = await this.io.in(`lobby:${lobby.code}`).fetchSockets();

    // Send personalized game state to each player
    for (const socket of sockets) {
      const clientState = gameService.getClientGameState(game, socket.data.playerId);
      socket.emit('game:update', { gameState: clientState });
    }
  }

  /**
   * Checks if the current turn player is a bot and schedules their action.
   */
  async processPendingBotActions(gameId: string): Promise<void> {
    const game = await gameService.getGameById(gameId);
    if (!game) {
      return;
    }

    const state = game.gameState;
    if (state.status === 'GAME_OVER') {
      return;
    }

    const currentTurnPlayerId = game.currentTurnPlayerId;
    if (!currentTurnPlayerId) {
      return;
    }

    // Check if current turn player is a bot
    const db = getDB();
    const currentPlayer = await db.player.findUnique({
      where: { id: currentTurnPlayerId },
    });

    if (!currentPlayer || !currentPlayer.isBot) {
      return;
    }

    // Schedule bot action based on game phase
    if (state.status === 'BIDDING') {
      this.scheduleBotBid(gameId, currentTurnPlayerId);
    } else if (state.status === 'PLAYING') {
      this.scheduleBotCardPlay(gameId, currentTurnPlayerId);
    }
  }

  /**
   * Schedules a delayed bid submission for a bot.
   */
  private scheduleBotBid(gameId: string, botPlayerId: string): void {
    const lockKey = `bid:${gameId}:${botPlayerId}`;

    // Check if already processing
    if (actionLocks.get(lockKey)) {
      return;
    }
    actionLocks.set(lockKey, true);

    const delay = this.getRandomDelay(BOT_TIMING.BID_MIN, BOT_TIMING.BID_MAX);

    setTimeout(async () => {
      try {
        // Re-fetch game state to ensure it's still bot's turn
        const game = await gameService.getGameById(gameId);
        if (!game) {
          return;
        }

        // Verify it's still the bot's turn and we're still bidding
        if (game.currentTurnPlayerId !== botPlayerId || game.gameState.status !== 'BIDDING') {
          return;
        }

        const state = game.gameState;
        const roundState = state.roundState;
        if (!roundState) {
          return;
        }

        // Find the bot's hand
        const botPlayer = state.players.find(p => p.id === botPlayerId);
        if (!botPlayer) {
          return;
        }

        // Calculate bidding info
        const totalBidsSoFar = Object.values(roundState.bids).reduce((sum, b) => sum + b, 0);
        const biddedCount = Object.keys(roundState.bids).length;
        const isLastBidder = biddedCount === state.players.length - 1;

        // Choose bid using bot strategy
        // trumpSuit is always set during bidding phase
        const bid = chooseBotBid(
          botPlayer.hand,
          roundState.trumpSuit!,
          roundState.cardsPerPlayer,
          totalBidsSoFar,
          isLastBidder
        );

        console.log(`Bot ${botPlayer.name} bidding ${bid}`);

        // Submit bid using game service
        await gameService.submitBid({
          gameId,
          playerId: botPlayerId,
          bid,
        });

        // Broadcast updated game state to all clients
        await this.broadcastGameState(gameId);

        // Process next bot action if needed
        await this.processPendingBotActions(gameId);
      } catch (error) {
        console.error(`Error in bot bid for ${botPlayerId}:`, error);
      } finally {
        actionLocks.delete(lockKey);
      }
    }, delay);
  }

  /**
   * Schedules a delayed card play for a bot.
   */
  private scheduleBotCardPlay(gameId: string, botPlayerId: string): void {
    const lockKey = `play:${gameId}:${botPlayerId}`;

    // Check if already processing
    if (actionLocks.get(lockKey)) {
      return;
    }
    actionLocks.set(lockKey, true);

    const delay = this.getRandomDelay(BOT_TIMING.PLAY_MIN, BOT_TIMING.PLAY_MAX);

    setTimeout(async () => {
      try {
        // Re-fetch game state to ensure it's still bot's turn
        const game = await gameService.getGameById(gameId);
        if (!game) {
          return;
        }

        // Verify it's still the bot's turn and we're still playing
        if (game.currentTurnPlayerId !== botPlayerId || game.gameState.status !== 'PLAYING') {
          return;
        }

        const state = game.gameState;
        const roundState = state.roundState;
        if (!roundState || !roundState.currentTrick) {
          return;
        }

        // Find the bot's player data
        const botPlayer = state.players.find(p => p.id === botPlayerId);
        if (!botPlayer || botPlayer.hand.length === 0) {
          return;
        }

        // Get current trick info
        const trick = roundState.currentTrick;

        // Choose card using bot strategy
        // trumpSuit is always set during playing phase
        const card = chooseBotCard(
          botPlayer.hand,
          trick.leadSuit,
          roundState.trumpSuit!,
          botPlayer.bid || 0,
          botPlayer.tricksWon,
          trick.cardsPlayed
        );

        console.log(`Bot ${botPlayer.name} playing ${card.rank} of ${card.suit}`);

        // Play card using game service
        const { state: newState, trickComplete, roundComplete } = await gameService.playCard({
          gameId,
          playerId: botPlayerId,
          card,
        });

        // Broadcast updated game state to all clients
        await this.broadcastGameState(gameId);

        // Send trick complete event if applicable
        if (trickComplete && this.io) {
          const lobby = await lobbyService.getLobbyById(game.lobbyId);
          if (lobby && newState.roundState?.currentTrick) {
            const completedTrick = newState.roundState.currentTrick;
            const winner = newState.players.find(p => p.id === completedTrick.winnerId);
            this.io.to(`lobby:${lobby.code}`).emit('game:trick-completed', {
              trickNumber: newState.roundState.trickNumber - 1,
              winnerId: completedTrick.winnerId || '',
              winnerName: winner?.name || 'Unknown',
              cardsPlayed: completedTrick.cardsPlayed,
            });
          }
        }

        // Send round complete event if applicable
        if (roundComplete && this.io) {
          const lobby = await lobbyService.getLobbyById(game.lobbyId);
          if (lobby) {
            this.io.to(`lobby:${lobby.code}`).emit('game:round-complete', {
              roundNumber: newState.currentRound - 1,
              scores: newState.scores,
            });
          }
        }

        // Check if game is over
        if (newState.status === 'GAME_OVER' && this.io) {
          const lobby = await lobbyService.getLobbyById(game.lobbyId);
          if (lobby) {
            const winner = gameService.getWinner(newState);
            if (winner) {
              this.io.to(`lobby:${lobby.code}`).emit('game:over', {
                finalScores: newState.scores,
                winner: { id: winner.id, name: winner.name },
              });
            }
          }
        }

        // Process next bot action if needed (only if game not over)
        if (newState.status !== 'GAME_OVER') {
          await this.processPendingBotActions(gameId);
        }
      } catch (error) {
        console.error(`Error in bot card play for ${botPlayerId}:`, error);
      } finally {
        actionLocks.delete(lockKey);
      }
    }, delay);
  }
}

// Export singleton instance
export const botService = new BotService();
