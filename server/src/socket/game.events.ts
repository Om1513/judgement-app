// Socket.IO game event handlers

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
import { handleAfterCardPlay, broadcastGameUpdate } from './playFlow';
import { perfStart, perfEnd } from '../utils/perf';

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

/**
 * Registers game-related socket event handlers.
 */
export function registerGameEvents(io: TypedServer, socket: TypedSocket): void {
  /**
   * Submits a bid during bidding phase.
   */
  socket.on('game:submit-bid', async (data) => {
    const _t = perfStart();
    try {
      const { bid } = data;

      if (!socket.data.playerId || !socket.data.gameId) {
        socket.emit('game:error', {
          message: 'Not in a game',
          code: SocketErrorCodes.GAME_NOT_FOUND,
        });
        return;
      }

      // Submit bid
      await gameService.submitBid({
        gameId: socket.data.gameId,
        playerId: socket.data.playerId,
        bid,
      });

      console.log(`Player ${socket.data.playerName} bid ${bid}`);

      // Broadcast personalized state to everyone (uses the cached lobby ref).
      await broadcastGameUpdate(io, socket.data.gameId);

      // Process pending bot actions
      await botService.processPendingBotActions(socket.data.gameId);

      perfEnd(_t, 'game:submit-bid');
    } catch (error) {
      console.error('Error submitting bid:', error);
      socket.emit('game:error', {
        message: error instanceof Error ? error.message : 'Failed to submit bid',
        code: error instanceof Error && error.message.includes('turn')
          ? SocketErrorCodes.NOT_YOUR_TURN
          : SocketErrorCodes.INVALID_ACTION,
      });
    }
  });

  /**
   * Plays a card during playing phase.
   */
  socket.on('game:play-card', async (data) => {
    const _t = perfStart();
    try {
      const { card } = data;

      if (!socket.data.playerId || !socket.data.gameId) {
        socket.emit('game:error', {
          message: 'Not in a game',
          code: SocketErrorCodes.GAME_NOT_FOUND,
        });
        return;
      }

      // Play card
      const { trickComplete, roundComplete } = await gameService.playCard({
        gameId: socket.data.gameId,
        playerId: socket.data.playerId,
        card,
      });

      console.log(`Player ${socket.data.playerName} played ${card.rank} of ${card.suit}`);

      // Broadcast the new state, run the hand-winner popup / inter-hand pause,
      // and drive any pending bot actions.
      await handleAfterCardPlay(io, socket.data.gameId, { trickComplete, roundComplete });

      perfEnd(_t, 'game:play-card', { trickComplete, roundComplete });
    } catch (error) {
      console.error('Error playing card:', error);
      socket.emit('game:error', {
        message: error instanceof Error ? error.message : 'Failed to play card',
        code: error instanceof Error && error.message.includes('turn')
          ? SocketErrorCodes.NOT_YOUR_TURN
          : SocketErrorCodes.INVALID_ACTION,
      });
    }
  });

  /**
   * Requests current game state (for reconnection).
   */
  socket.on('game:state-request', async () => {
    try {
      if (!socket.data.playerId || !socket.data.gameId) {
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

      const clientState = gameService.getClientGameState(game, socket.data.playerId);
      socket.emit('game:update', { gameState: clientState });
    } catch (error) {
      console.error('Error fetching game state:', error);
      socket.emit('game:error', {
        message: 'Failed to fetch game state',
        code: SocketErrorCodes.GAME_NOT_FOUND,
      });
    }
  });

  /**
   * Returns the final scoreboard (all round scores + totals) for a completed
   * game, including the backend-determined winner(s).
   */
  socket.on('game:get-final-scoreboard', async () => {
    try {
      if (!socket.data.gameId) {
        socket.emit('game:error', {
          message: 'Not in a game',
          code: SocketErrorCodes.GAME_NOT_FOUND,
        });
        return;
      }

      const scoreboard = await scoreboardService.getScoreboardState(socket.data.gameId);
      const result = await scoreboardService.finalizeGame(socket.data.gameId);
      if (!scoreboard || !result) {
        socket.emit('game:error', {
          message: 'Final scoreboard not available',
          code: SocketErrorCodes.GAME_NOT_FOUND,
        });
        return;
      }

      socket.emit('game:final-scoreboard', {
        scoreboard,
        winnerIds: result.winnerIds,
        winningScore: result.winningScore,
      });
    } catch (error) {
      console.error('Error fetching final scoreboard:', error);
      socket.emit('game:error', {
        message: error instanceof Error ? error.message : 'Failed to get final scoreboard',
        code: SocketErrorCodes.INVALID_ACTION,
      });
    }
  });
}

/**
 * Handles player disconnection during game.
 * In a real game, you might want to implement reconnection or AI takeover.
 */
export async function handleGameDisconnect(
  io: TypedServer,
  socket: TypedSocket
): Promise<void> {
  if (!socket.data.gameId) {
    return;
  }

  try {
    const game = await gameService.getGameById(socket.data.gameId);
    if (!game || game.gameState.status === 'GAME_OVER') {
      return;
    }

    // For now, just log the disconnection
    // In production, you'd want to implement:
    // - Grace period for reconnection
    // - AI takeover
    // - Pause game
    console.log(`Player ${socket.data.playerName} disconnected during game ${socket.data.gameId}`);

    // Notify other players
    const lobby = await lobbyService.getLobbyById(game.lobbyId);
    if (lobby) {
      socket.to(`lobby:${lobby.code}`).emit('error', {
        message: `${socket.data.playerName} has disconnected`,
      });
    }
  } catch (error) {
    console.error('Error handling game disconnect:', error);
  }
}
