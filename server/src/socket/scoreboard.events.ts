// Scoreboard socket event handlers

import { Server, Socket } from 'socket.io';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  SocketErrorCodes,
} from '../types/socket';
import { gameService } from '../services/game.service';
import { scoreboardService } from '../services/scoreboard.service';
import { lobbyService } from '../services/lobby.service';
import { botService } from '../services/bot.service';
import { broadcastFinalWinner } from './playFlow';

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

/**
 * Registers scoreboard event handlers.
 */
export function registerScoreboardEvents(io: TypedServer, socket: TypedSocket): void {
  /**
   * Gets the current scoreboard state.
   */
  socket.on('scoreboard:get-state', async () => {
    try {
      if (!socket.data.gameId) {
        socket.emit('game:error', {
          message: 'Not in a game',
          code: SocketErrorCodes.GAME_NOT_FOUND,
        });
        return;
      }

      const scoreboard = await scoreboardService.getScoreboardState(socket.data.gameId);
      if (!scoreboard) {
        socket.emit('game:error', {
          message: 'Scoreboard not found',
          code: SocketErrorCodes.GAME_NOT_FOUND,
        });
        return;
      }

      socket.emit('scoreboard:state', { scoreboard });
    } catch (error) {
      console.error('Error getting scoreboard state:', error);
      socket.emit('game:error', {
        message: error instanceof Error ? error.message : 'Failed to get scoreboard',
        code: SocketErrorCodes.INVALID_ACTION,
      });
    }
  });

  /**
   * Handles player clicking Continue on scoreboard.
   */
  socket.on('scoreboard:continue', async () => {
    try {
      if (!socket.data.gameId || !socket.data.playerId) {
        socket.emit('game:error', {
          message: 'Not in a game',
          code: SocketErrorCodes.GAME_NOT_FOUND,
        });
        return;
      }

      const game = await gameService.getGameById(socket.data.gameId);
      if (!game) {
        socket.emit('game:error', {
          message: 'Game not found',
          code: SocketErrorCodes.GAME_NOT_FOUND,
        });
        return;
      }

      // Validate game is in scoreboard phase
      if (game.gameState.status !== 'ROUND_SCOREBOARD') {
        socket.emit('game:error', {
          message: 'Game is not in scoreboard phase',
          code: SocketErrorCodes.INVALID_ACTION,
        });
        return;
      }

      // Record the player's continue
      const { allContinued, scoreboard } = await scoreboardService.playerContinue(
        socket.data.gameId,
        socket.data.playerId
      );

      const lobby = await lobbyService.getLobbyById(game.lobbyId);
      if (!lobby) {
        throw new Error('Lobby not found');
      }

      // Broadcast updated scoreboard
      io.to(`lobby:${lobby.code}`).emit('scoreboard:state', { scoreboard });

      // Notify that player continued
      const player = lobby.players.find(p => p.playerId === socket.data.playerId);
      io.to(`lobby:${lobby.code}`).emit('scoreboard:player-continued', {
        playerId: socket.data.playerId,
        playerName: player?.name || 'Unknown',
      });

      // If all players have continued, advance to next round
      if (allContinued) {
        io.to(`lobby:${lobby.code}`).emit('scoreboard:all-continued');

        // Advance to next round
        const updatedGame = await gameService.advanceToNextRound(socket.data.gameId);

        if (updatedGame) {
          if (updatedGame.gameState.status === 'GAME_OVER') {
            // Game is complete - finalize and broadcast the winner(s).
            await broadcastFinalWinner(io, socket.data.gameId);
          } else {
            // Send new round bidding state
            const sockets = await io.in(`lobby:${lobby.code}`).fetchSockets();
            for (const s of sockets) {
              const clientState = gameService.getClientGameState(updatedGame, s.data.playerId);
              s.emit('round:bidding-started', { gameState: clientState });
            }

            // Trigger bot actions if first bidder is a bot
            await botService.processPendingBotActions(socket.data.gameId);
          }
        }
      } else {
        // Schedule bot continues (if any bots haven't continued yet)
        botService.scheduleBotContinues(socket.data.gameId);
      }
    } catch (error) {
      console.error('Error processing continue:', error);
      socket.emit('game:error', {
        message: error instanceof Error ? error.message : 'Failed to continue',
        code: SocketErrorCodes.INVALID_ACTION,
      });
    }
  });
}

/**
 * Broadcasts scoreboard state to all players in a lobby.
 */
export async function broadcastScoreboard(io: TypedServer, gameId: string): Promise<void> {
  const game = await gameService.getGameById(gameId);
  if (!game) {
    return;
  }

  const lobby = await lobbyService.getLobbyById(game.lobbyId);
  if (!lobby) {
    return;
  }

  const scoreboard = await scoreboardService.getScoreboardState(gameId);
  if (!scoreboard) {
    return;
  }

  io.to(`lobby:${lobby.code}`).emit('scoreboard:state', { scoreboard });

  // Trigger bot continues
  botService.scheduleBotContinues(gameId);
}
