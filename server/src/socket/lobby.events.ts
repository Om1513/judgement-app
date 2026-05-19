// Socket.IO lobby event handlers

import { Server, Socket } from 'socket.io';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  SocketErrorCodes,
} from '../types/socket';
import { LobbySettings } from '../types/lobby';
import { playerService } from '../services/player.service';
import { lobbyService } from '../services/lobby.service';
import { gameService } from '../services/game.service';

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

/**
 * Registers lobby-related socket event handlers.
 */
export function registerLobbyEvents(io: TypedServer, socket: TypedSocket): void {
  /**
   * Creates a new lobby.
   * The socket's player becomes the host.
   */
  socket.on('lobby:create', async (data) => {
    try {
      const { playerName, settings } = data;

      if (!socket.data.playerId) {
        socket.emit('lobby:error', {
          message: 'Not connected. Please reconnect.',
          code: SocketErrorCodes.PLAYER_NOT_FOUND,
        });
        return;
      }

      // Check if player is already in a lobby
      const existingLobby = await lobbyService.getPlayerLobby(socket.data.playerId);
      if (existingLobby) {
        socket.emit('lobby:error', {
          message: 'Already in a lobby. Leave first to create a new one.',
          code: SocketErrorCodes.ALREADY_IN_LOBBY,
        });
        return;
      }

      // Create the lobby
      const lobby = await lobbyService.createLobby({
        hostPlayerId: socket.data.playerId,
        hostName: playerName || socket.data.playerName,
        settings,
      });

      // Update socket data
      socket.data.lobbyId = lobby.id;

      // Join the Socket.IO room
      socket.join(`lobby:${lobby.code}`);

      console.log(`Player ${socket.data.playerName} created lobby ${lobby.code}`);

      // Send lobby created event
      socket.emit('lobby:created', { lobby });
    } catch (error) {
      console.error('Error creating lobby:', error);
      socket.emit('lobby:error', {
        message: error instanceof Error ? error.message : 'Failed to create lobby',
        code: SocketErrorCodes.INVALID_ACTION,
      });
    }
  });

  /**
   * Joins an existing lobby.
   */
  socket.on('lobby:join', async (data) => {
    try {
      const { code, playerName } = data;

      if (!socket.data.playerId) {
        socket.emit('lobby:error', {
          message: 'Not connected. Please reconnect.',
          code: SocketErrorCodes.PLAYER_NOT_FOUND,
        });
        return;
      }

      // Check if player is already in a lobby
      const existingLobby = await lobbyService.getPlayerLobby(socket.data.playerId);
      if (existingLobby) {
        socket.emit('lobby:error', {
          message: 'Already in a lobby. Leave first to join another.',
          code: SocketErrorCodes.ALREADY_IN_LOBBY,
        });
        return;
      }

      // Find the lobby
      const lobbyBefore = await lobbyService.getLobbyByCode(code.toUpperCase());
      if (!lobbyBefore) {
        socket.emit('lobby:error', {
          message: 'Lobby not found. Check the code and try again.',
          code: SocketErrorCodes.LOBBY_NOT_FOUND,
        });
        return;
      }

      // Join the lobby
      const lobby = await lobbyService.joinLobby({
        code: code.toUpperCase(),
        playerId: socket.data.playerId,
        playerName: playerName || socket.data.playerName,
      });

      // Update socket data
      socket.data.lobbyId = lobby.id;

      // Join the Socket.IO room
      socket.join(`lobby:${lobby.code}`);

      console.log(`Player ${socket.data.playerName} joined lobby ${lobby.code}`);

      // Send joined event to this player
      socket.emit('lobby:joined', { lobby });

      // Notify other players in the lobby
      socket.to(`lobby:${lobby.code}`).emit('lobby:player-joined', {
        player: { id: socket.data.playerId, name: socket.data.playerName },
        lobby,
      });

      // Broadcast updated lobby state to all
      io.to(`lobby:${lobby.code}`).emit('lobby:update', { lobby });
    } catch (error) {
      console.error('Error joining lobby:', error);
      socket.emit('lobby:error', {
        message: error instanceof Error ? error.message : 'Failed to join lobby',
        code: SocketErrorCodes.INVALID_ACTION,
      });
    }
  });

  /**
   * Leaves the current lobby.
   */
  socket.on('lobby:leave', async () => {
    try {
      if (!socket.data.playerId || !socket.data.lobbyId) {
        socket.emit('lobby:error', {
          message: 'Not in a lobby',
          code: SocketErrorCodes.LOBBY_NOT_FOUND,
        });
        return;
      }

      const lobby = await lobbyService.getLobbyById(socket.data.lobbyId);
      if (!lobby) {
        socket.data.lobbyId = null;
        return;
      }

      const lobbyCode = lobby.code;

      // Leave the lobby
      const updatedLobby = await lobbyService.leaveLobby(
        socket.data.lobbyId,
        socket.data.playerId
      );

      // Leave the Socket.IO room
      socket.leave(`lobby:${lobbyCode}`);

      console.log(`Player ${socket.data.playerName} left lobby ${lobbyCode}`);

      // Clear socket data
      socket.data.lobbyId = null;
      socket.data.gameId = null;

      // Notify remaining players
      if (updatedLobby) {
        io.to(`lobby:${lobbyCode}`).emit('lobby:player-left', {
          playerId: socket.data.playerId,
          lobby: updatedLobby,
        });
        io.to(`lobby:${lobbyCode}`).emit('lobby:update', { lobby: updatedLobby });
      }
    } catch (error) {
      console.error('Error leaving lobby:', error);
      socket.emit('lobby:error', {
        message: error instanceof Error ? error.message : 'Failed to leave lobby',
        code: SocketErrorCodes.INVALID_ACTION,
      });
    }
  });

  /**
   * Kicks a player from the lobby (host only).
   */
  socket.on('lobby:kick-player', async (data) => {
    try {
      const { playerId: targetPlayerId } = data;

      if (!socket.data.playerId || !socket.data.lobbyId) {
        socket.emit('lobby:error', {
          message: 'Not in a lobby',
          code: SocketErrorCodes.LOBBY_NOT_FOUND,
        });
        return;
      }

      const lobby = await lobbyService.kickPlayer(
        socket.data.lobbyId,
        socket.data.playerId,
        targetPlayerId
      );

      console.log(`Host ${socket.data.playerName} kicked player ${targetPlayerId} from lobby ${lobby.code}`);

      // Find the kicked player's socket and notify them
      const sockets = await io.in(`lobby:${lobby.code}`).fetchSockets();
      for (const s of sockets) {
        if (s.data.playerId === targetPlayerId) {
          s.emit('lobby:kicked', { message: 'You have been removed from the lobby by the host.' });
          s.leave(`lobby:${lobby.code}`);
          s.data.lobbyId = null;
          s.data.gameId = null;
          break;
        }
      }

      // Broadcast updated lobby state
      io.to(`lobby:${lobby.code}`).emit('lobby:update', { lobby });
    } catch (error) {
      console.error('Error kicking player:', error);
      socket.emit('lobby:error', {
        message: error instanceof Error ? error.message : 'Failed to kick player',
        code: error instanceof Error && error.message.includes('host')
          ? SocketErrorCodes.NOT_HOST
          : SocketErrorCodes.INVALID_ACTION,
      });
    }
  });

  /**
   * Updates lobby settings (host only).
   */
  socket.on('lobby:update-settings', async (data) => {
    try {
      const { settings } = data;

      if (!socket.data.playerId || !socket.data.lobbyId) {
        socket.emit('lobby:error', {
          message: 'Not in a lobby',
          code: SocketErrorCodes.LOBBY_NOT_FOUND,
        });
        return;
      }

      const lobby = await lobbyService.updateSettings({
        lobbyId: socket.data.lobbyId,
        hostPlayerId: socket.data.playerId,
        settings,
      });

      console.log(`Host ${socket.data.playerName} updated settings for lobby ${lobby.code}`);

      // Broadcast updated lobby state
      io.to(`lobby:${lobby.code}`).emit('lobby:update', { lobby });
    } catch (error) {
      console.error('Error updating settings:', error);
      socket.emit('lobby:error', {
        message: error instanceof Error ? error.message : 'Failed to update settings',
        code: error instanceof Error && error.message.includes('host')
          ? SocketErrorCodes.NOT_HOST
          : SocketErrorCodes.INVALID_ACTION,
      });
    }
  });

  /**
   * Starts the game (host only).
   */
  socket.on('lobby:start-game', async () => {
    try {
      if (!socket.data.playerId || !socket.data.lobbyId) {
        socket.emit('lobby:error', {
          message: 'Not in a lobby',
          code: SocketErrorCodes.LOBBY_NOT_FOUND,
        });
        return;
      }

      // Start the game
      const { lobby, gameId } = await lobbyService.startGame(
        socket.data.lobbyId,
        socket.data.playerId
      );

      // Initialize game state
      const gameState = await gameService.initializeGame(gameId, lobby.id);

      console.log(`Game started in lobby ${lobby.code}`);

      // Update all sockets in the lobby with game ID
      const sockets = await io.in(`lobby:${lobby.code}`).fetchSockets();
      for (const s of sockets) {
        s.data.gameId = gameId;
      }

      // Send personalized game state to each player (hiding others' cards)
      const game = await gameService.getGameById(gameId);
      if (game) {
        for (const s of sockets) {
          const clientState = gameService.getClientGameState(game, s.data.playerId);
          s.emit('game:started', { gameState: clientState });
        }
      }
    } catch (error) {
      console.error('Error starting game:', error);
      socket.emit('lobby:error', {
        message: error instanceof Error ? error.message : 'Failed to start game',
        code: error instanceof Error && error.message.includes('host')
          ? SocketErrorCodes.NOT_HOST
          : SocketErrorCodes.INVALID_ACTION,
      });
    }
  });
}

/**
 * Handles player disconnection from lobby.
 */
export async function handleLobbyDisconnect(
  io: TypedServer,
  socket: TypedSocket
): Promise<void> {
  if (!socket.data.lobbyId || !socket.data.playerId) {
    return;
  }

  try {
    const lobby = await lobbyService.getLobbyById(socket.data.lobbyId);
    if (!lobby) {
      return;
    }

    // Only remove from lobby if game hasn't started
    if (lobby.status === 'WAITING') {
      const updatedLobby = await lobbyService.leaveLobby(
        socket.data.lobbyId,
        socket.data.playerId
      );

      if (updatedLobby) {
        io.to(`lobby:${lobby.code}`).emit('lobby:player-left', {
          playerId: socket.data.playerId,
          lobby: updatedLobby,
        });
        io.to(`lobby:${lobby.code}`).emit('lobby:update', { lobby: updatedLobby });
      }
    }
    // If game is in progress, player stays in game but disconnected
    // Could implement reconnection logic here
  } catch (error) {
    console.error('Error handling lobby disconnect:', error);
  }
}
