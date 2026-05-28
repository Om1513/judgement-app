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
import { botService } from '../services/bot.service';
import { registerLobbyEvents, handleLobbyDisconnect } from './lobby.events';
import { registerGameEvents, handleGameDisconnect } from './game.events';

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
        origin: process.env.CORS_ORIGIN || '*',
        methods: ['GET', 'POST'],
        credentials: true,
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
        const { name } = data;

        if (!name || typeof name !== 'string' || name.trim().length === 0) {
          socket.emit('error', { message: 'Name is required' });
          return;
        }

        // Get or create player
        const player = await playerService.getOrCreatePlayer(name.trim(), socket.id);

        // Store player info in socket data
        socket.data.playerId = player.id;
        socket.data.playerName = player.name;

        console.log(`Player connected: ${player.name} (${player.id})`);

        // Send confirmation
        socket.emit('connected', { playerId: player.id });
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
