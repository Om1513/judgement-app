// Socket.IO main setup and event registration

import { Server as HTTPServer } from 'http';
import { Server, Socket } from 'socket.io';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from '../types/socket';
import { playerService } from '../services/player.service';
import { lobbyService } from '../services/lobby.service';
import { gameService } from '../services/game.service';
import { botService } from '../services/bot.service';
import { registerLobbyEvents, handleLobbyDisconnect } from './lobby.events';
import { registerGameEvents, handleGameDisconnect } from './game.events';
import { registerScoreboardEvents } from './scoreboard.events';
import { getCorsOrigin } from '../utils/corsOrigin';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

let io: TypedServer;

/**
 * Initializes Socket.IO server.
 */
export function initializeSocket(httpServer: HTTPServer): TypedServer {
  io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
    httpServer,
    {
      cors: {
        origin: getCorsOrigin(),
        methods: ['GET', 'POST'],
        credentials: getCorsOrigin() !== '*',
      },
      // Ping settings for mobile connections
      pingInterval: 25000,
      pingTimeout: 60000,
      // Transport settings
      transports: ['websocket', 'polling'],
    }
  );

  // Connection handler
  io.on('connection', async (socket: TypedSocket) => {
    console.log(`New connection: ${socket.id}`);

    // Initialize socket data
    socket.data.playerId = '';
    socket.data.playerName = '';
    socket.data.lobbyId = null;
    socket.data.gameId = null;

    // Handle player connection with name
    socket.on('player:connect', async (data) => {
      try {
        const { name, clientId } = data;

        if (!name || typeof name !== 'string' || name.trim().length === 0) {
          socket.emit('error', { message: 'Name is required' });
          return;
        }

        // Resolve identity by stable clientId (survives reconnects).
        const player = await playerService.getOrCreatePlayer(
          name.trim(),
          socket.id,
          typeof clientId === 'string' && clientId.length > 0 ? clientId : null
        );

        // Store player info in socket data
        socket.data.playerId = player.id;
        socket.data.playerName = player.name;

        console.log(`Player connected: ${player.name} (${player.id})`);

        // Restore an in-flight session (lobby / active game) for a returning
        // player, then tell them whether this was a fresh connect or a recovery.
        const restored = await restoreSession(socket);
        socket.emit('connected', { playerId: player.id, reconnected: restored });
      } catch (error) {
        console.error('Error connecting player:', error);
        socket.emit('error', {
          message: error instanceof Error ? error.message : 'Failed to connect',
        });
      }
    });

    // Register event handlers
    registerLobbyEvents(io, socket);
    registerGameEvents(io, socket);
    registerScoreboardEvents(io, socket);

    // Handle disconnection
    socket.on('disconnect', async (reason) => {
      console.log(`Disconnected: ${socket.id} (${reason})`);

      // Handle lobby/game cleanup
      await handleLobbyDisconnect(io, socket);
      await handleGameDisconnect(io, socket);

      // Clear player's socket ID
      if (socket.data.playerId) {
        try {
          await playerService.handleDisconnect(socket.id);
        } catch (error) {
          console.error('Error handling disconnect:', error);
        }
      }
    });

    // Handle errors
    socket.on('error', (error) => {
      console.error(`Socket error for ${socket.id}:`, error);
    });
  });

  // Initialize bot service with Socket.IO server
  botService.setIO(io);

  console.log('Socket.IO initialized');

  return io;
}

/**
 * Restores an in-flight session for a (re)connecting socket.
 *
 * If the player is still a member of a lobby (and possibly an active game),
 * this re-attaches the socket to the lobby room, repopulates socket.data, and
 * pushes the current lobby/game state so the client can resume where it left
 * off after a disconnect, app background, or WiFi<->mobile-data switch.
 *
 * Returns true when an existing session was restored.
 */
async function restoreSession(socket: TypedSocket): Promise<boolean> {
  if (!socket.data.playerId) {
    return false;
  }

  try {
    const lobby = await lobbyService.getPlayerLobby(socket.data.playerId);
    if (!lobby) {
      return false;
    }

    // Re-join the room so future broadcasts reach this socket again.
    socket.data.lobbyId = lobby.id;
    socket.join(`lobby:${lobby.code}`);

    let clientState = null;
    if (lobby.status === 'IN_GAME') {
      const game = await gameService.getGameByLobbyId(lobby.id);
      if (game) {
        socket.data.gameId = game.id;
        clientState = gameService.getClientGameState(game, socket.data.playerId);
      }
    }

    console.log(
      `Restored session for ${socket.data.playerName} -> lobby ${lobby.code}` +
        (clientState ? ' (in game)' : '')
    );

    // Tell the client what to resume, and also refresh any already-mounted
    // screens that listen for the standard update events.
    socket.emit('session:restore', { lobby, gameState: clientState });
    socket.emit('lobby:update', { lobby });
    if (clientState) {
      socket.emit('game:update', { gameState: clientState });
    }

    return true;
  } catch (error) {
    console.error('Error restoring session:', error);
    return false;
  }
}

/**
 * Gets the Socket.IO server instance.
 */
export function getIO(): TypedServer {
  if (!io) {
    throw new Error('Socket.IO not initialized');
  }
  return io;
}

/**
 * Broadcasts to all sockets in a lobby room.
 */
export function broadcastToLobby(lobbyCode: string, event: string, data: any): void {
  io.to(`lobby:${lobbyCode}`).emit(event as any, data);
}

/**
 * Gets all sockets in a lobby.
 */
export async function getLobbySockets(lobbyCode: string): Promise<TypedSocket[]> {
  const sockets = await io.in(`lobby:${lobbyCode}`).fetchSockets();
  return sockets as unknown as TypedSocket[];
}
