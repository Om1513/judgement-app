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
import { lobbyService } from '../services/lobby.service';
import { botService } from '../services/bot.service';
import { broadcastScoreboard } from './scoreboard.events';

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
      const state = await gameService.submitBid({
        gameId: socket.data.gameId,
        playerId: socket.data.playerId,
        bid,
      });

      console.log(`Player ${socket.data.playerName} bid ${bid}`);

      // Get the game to send personalized states
      const game = await gameService.getGameById(socket.data.gameId);
      if (!game) {
        throw new Error('Game not found after bid');
      }

      // Get lobby for room name
      const lobby = await lobbyService.getLobbyById(game.lobbyId);
      if (!lobby) {
        throw new Error('Lobby not found');
      }

      // Send personalized game state to each player
      const sockets = await io.in(`lobby:${lobby.code}`).fetchSockets();
      for (const s of sockets) {
        const clientState = gameService.getClientGameState(game, s.data.playerId);
        s.emit('game:update', { gameState: clientState });
      }

      // Process pending bot actions
      await botService.processPendingBotActions(socket.data.gameId);
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
      const { state, trickComplete, roundComplete } = await gameService.playCard({
        gameId: socket.data.gameId,
        playerId: socket.data.playerId,
        card,
      });

      console.log(`Player ${socket.data.playerName} played ${card.rank} of ${card.suit}`);

      // Get the updated game
      const game = await gameService.getGameById(socket.data.gameId);
      if (!game) {
        throw new Error('Game not found after play');
      }

      // Get lobby for room name
      const lobby = await lobbyService.getLobbyById(game.lobbyId);
      if (!lobby) {
        throw new Error('Lobby not found');
      }

      // Send personalized game state to each player
      const sockets = await io.in(`lobby:${lobby.code}`).fetchSockets();
      for (const s of sockets) {
        const clientState = gameService.getClientGameState(game, s.data.playerId);
        s.emit('game:update', { gameState: clientState });
      }

      // Process pending bot actions
      await botService.processPendingBotActions(socket.data.gameId);

      // Send trick complete event if applicable
      if (trickComplete && state.roundState?.currentTrick) {
        const trick = state.roundState.currentTrick;
        const winner = state.players.find(p => p.id === trick.winnerId);
        io.to(`lobby:${lobby.code}`).emit('game:trick-completed', {
          trickNumber: state.roundState.trickNumber - 1,
          winnerId: trick.winnerId || '',
          winnerName: winner?.name || 'Unknown',
          cardsPlayed: trick.cardsPlayed,
        });
      }

      // Send round complete event and scoreboard if applicable
      if (roundComplete && state.status === 'ROUND_SCOREBOARD') {
        io.to(`lobby:${lobby.code}`).emit('game:round-complete', {
          roundNumber: state.currentRound,
          scores: state.scores,
        });

        // Broadcast scoreboard state and trigger bot continues
        await broadcastScoreboard(io, socket.data.gameId);
      }
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
