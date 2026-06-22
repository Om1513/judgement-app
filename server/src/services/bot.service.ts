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
  CONTINUE_MIN: 700,
  CONTINUE_MAX: 1800,
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

    const ref = await gameService.getLobbyRef(gameId);
    if (!ref) {
      return;
    }

    // Get all sockets in the lobby room
    const sockets = await this.io.in(`lobby:${ref.code}`).fetchSockets();

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

        // Release lock BEFORE processing next action
        actionLocks.delete(lockKey);

        // Process next bot action if needed
        await this.processPendingBotActions(gameId);
      } catch (error) {
        console.error(`Error in bot bid for ${botPlayerId}:`, error);
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
        const { trickComplete, roundComplete } = await gameService.playCard({
          gameId,
          playerId: botPlayerId,
          card,
        });

        // Release this bot's lock before orchestrating follow-up actions so the
        // same bot can be scheduled again (e.g. it wins the trick and leads next).
        actionLocks.delete(lockKey);

        // Shared post-play orchestration: broadcasts state, runs the
        // hand-winner popup / inter-hand pause, advances to the next hand or
        // scoreboard, and drives any pending bot actions.
        if (this.io) {
          const { handleAfterCardPlay } = await import('../socket/playFlow');
          await handleAfterCardPlay(this.io, gameId, { trickComplete, roundComplete });
        }
      } catch (error) {
        console.error(`Error in bot card play for ${botPlayerId}:`, error);
        actionLocks.delete(lockKey);
      }
    }, delay);
  }

  /**
   * Schedules bot continues for scoreboard phase.
   */
  scheduleBotContinues(gameId: string): void {
    // Delay to fetch game state after other operations
    setTimeout(async () => {
      try {
        const db = getDB();
        const game = await gameService.getGameById(gameId);
        if (!game || game.gameState.status !== 'ROUND_SCOREBOARD') {
          return;
        }

        const lobby = await lobbyService.getLobbyById(game.lobbyId);
        if (!lobby) {
          return;
        }

        // Get current round
        const currentRound = await db.gameRound.findFirst({
          where: { gameId, roundNumber: game.currentRound },
        });
        if (!currentRound) {
          return;
        }

        // Get existing confirmations
        const confirmations = await db.scoreboardConfirmation.findMany({
          where: { gameId, roundId: currentRound.id },
        });
        const continuedPlayerIds = new Set(
          confirmations.filter(c => c.hasContinued).map(c => c.playerId)
        );

        // Find bots that haven't continued yet
        for (const lp of lobby.players) {
          if (lp.isBot && !continuedPlayerIds.has(lp.playerId)) {
            this.scheduleSingleBotContinue(gameId, lp.playerId, currentRound.id);
          }
        }
      } catch (error) {
        console.error('Error scheduling bot continues:', error);
      }
    }, 100);
  }

  /**
   * Schedules a single bot's continue action.
   */
  private scheduleSingleBotContinue(gameId: string, botPlayerId: string, roundId: string): void {
    const lockKey = `continue:${gameId}:${botPlayerId}`;

    // Check if already processing
    if (actionLocks.get(lockKey)) {
      return;
    }
    actionLocks.set(lockKey, true);

    const delay = this.getRandomDelay(BOT_TIMING.CONTINUE_MIN, BOT_TIMING.CONTINUE_MAX);

    setTimeout(async () => {
      try {
        const db = getDB();

        // Re-verify game is still in scoreboard phase
        const game = await gameService.getGameById(gameId);
        if (!game || game.gameState.status !== 'ROUND_SCOREBOARD') {
          return;
        }

        // Check if bot already continued
        const existing = await db.scoreboardConfirmation.findUnique({
          where: {
            gameId_roundId_playerId: { gameId, roundId, playerId: botPlayerId },
          },
        });
        if (existing?.hasContinued) {
          return;
        }

        // Get bot player info
        const bot = await db.player.findUnique({ where: { id: botPlayerId } });
        console.log(`Bot ${bot?.name || 'Unknown'} clicking Continue`);

        // Update confirmation
        await db.scoreboardConfirmation.upsert({
          where: {
            gameId_roundId_playerId: { gameId, roundId, playerId: botPlayerId },
          },
          update: {
            hasContinued: true,
            continuedAt: new Date(),
          },
          create: {
            gameId,
            roundId,
            playerId: botPlayerId,
            hasContinued: true,
            continuedAt: new Date(),
          },
        });

        // Broadcast updated scoreboard
        await this.broadcastScoreboardAndCheckAllContinued(gameId);
      } catch (error) {
        console.error(`Error in bot continue for ${botPlayerId}:`, error);
      } finally {
        actionLocks.delete(lockKey);
      }
    }, delay);
  }

  /**
   * Broadcasts scoreboard state and checks if all have continued.
   */
  private async broadcastScoreboardAndCheckAllContinued(gameId: string): Promise<void> {
    if (!this.io) {
      console.error('Socket.IO server not initialized in bot service');
      return;
    }

    const db = getDB();
    const game = await gameService.getGameById(gameId);
    if (!game) {
      return;
    }

    const lobby = await lobbyService.getLobbyById(game.lobbyId);
    if (!lobby) {
      return;
    }

    // Import scoreboardService dynamically to avoid circular dependency
    const { scoreboardService } = await import('./scoreboard.service');

    const scoreboard = await scoreboardService.getScoreboardState(gameId);
    if (!scoreboard) {
      return;
    }

    // Broadcast scoreboard state
    this.io.to(`lobby:${lobby.code}`).emit('scoreboard:state', { scoreboard });

    // Check if all continued
    const currentRound = await db.gameRound.findFirst({
      where: { gameId, roundNumber: game.currentRound },
    });
    if (!currentRound) {
      return;
    }

    const confirmations = await db.scoreboardConfirmation.findMany({
      where: { gameId, roundId: currentRound.id },
    });
    const continuedCount = confirmations.filter(c => c.hasContinued).length;

    if (continuedCount >= lobby.playerCount) {
      // All continued
      this.io.to(`lobby:${lobby.code}`).emit('scoreboard:all-continued');

      // Advance to next round
      const updatedGame = await gameService.advanceToNextRound(gameId);

      if (updatedGame) {
        if (updatedGame.gameState.status === 'GAME_OVER') {
          // Finalize and broadcast the winner(s).
          const { broadcastFinalWinner } = await import('../socket/playFlow');
          await broadcastFinalWinner(this.io, gameId);
        } else {
          // Send new round bidding state
          const sockets = await this.io.in(`lobby:${lobby.code}`).fetchSockets();
          for (const s of sockets) {
            const clientState = gameService.getClientGameState(updatedGame, s.data.playerId);
            s.emit('round:bidding-started', { gameState: clientState });
          }

          // Trigger bot actions if first bidder is a bot
          await this.processPendingBotActions(gameId);
        }
      }
    }
  }
}

// Export singleton instance
export const botService = new BotService();
