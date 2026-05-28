// Socket.IO client service for React Native

import { io } from 'socket.io-client';
import { SERVER_URL } from '../config';

class SocketService {
  constructor() {
    this.socket = null;
    this.playerId = null;
    this.isConnected = false;
    this.listeners = new Map();
  }

  /**
   * Connects to the server with player name.
   */
  connect(playerName) {
    return new Promise((resolve, reject) => {
      if (this.socket?.connected) {
        resolve({ playerId: this.playerId });
        return;
      }

      this.socket = io(SERVER_URL, {
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        timeout: 10000,
      });

      // Handle connection
      this.socket.on('connect', () => {
        console.log('Socket connected:', this.socket.id);
        this.isConnected = true;

        // Send player connect event
        this.socket.emit('player:connect', { name: playerName });
      });

      // Handle player connected confirmation
      this.socket.on('connected', (data) => {
        console.log('Player connected:', data.playerId);
        this.playerId = data.playerId;
        resolve({ playerId: data.playerId });
      });

      // Handle connection error
      this.socket.on('connect_error', (error) => {
        console.error('Connection error:', error);
        reject(new Error('Failed to connect to server'));
      });

      // Handle disconnection
      this.socket.on('disconnect', (reason) => {
        console.log('Socket disconnected:', reason);
        this.isConnected = false;
      });

      // Handle generic errors
      this.socket.on('error', (data) => {
        console.error('Socket error:', data.message);
        this._emitToListeners('error', data);
      });

      // Set timeout for initial connection
      setTimeout(() => {
        if (!this.isConnected) {
          reject(new Error('Connection timeout'));
        }
      }, 10000);
    });
  }

  /**
   * Disconnects from the server.
   */
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.playerId = null;
      this.isConnected = false;
    }
  }

  // =====================
  // Lobby Methods
  // =====================

  /**
   * Creates a new lobby.
   */
  createLobby(playerName, settings = {}) {
    return new Promise((resolve, reject) => {
      if (!this.socket?.connected) {
        reject(new Error('Not connected'));
        return;
      }

      // Listen for response
      const onCreated = (data) => {
        this.socket.off('lobby:created', onCreated);
        this.socket.off('lobby:error', onError);
        resolve(data.lobby);
      };

      const onError = (data) => {
        this.socket.off('lobby:created', onCreated);
        this.socket.off('lobby:error', onError);
        reject(new Error(data.message));
      };

      this.socket.on('lobby:created', onCreated);
      this.socket.on('lobby:error', onError);

      // Send create request
      this.socket.emit('lobby:create', { playerName, settings });
    });
  }

  /**
   * Joins an existing lobby.
   */
  joinLobby(code, playerName) {
    return new Promise((resolve, reject) => {
      if (!this.socket?.connected) {
        reject(new Error('Not connected'));
        return;
      }

      const onJoined = (data) => {
        this.socket.off('lobby:joined', onJoined);
        this.socket.off('lobby:error', onError);
        resolve(data.lobby);
      };

      const onError = (data) => {
        this.socket.off('lobby:joined', onJoined);
        this.socket.off('lobby:error', onError);
        reject(new Error(data.message));
      };

      this.socket.on('lobby:joined', onJoined);
      this.socket.on('lobby:error', onError);

      this.socket.emit('lobby:join', { code, playerName });
    });
  }

  /**
   * Leaves the current lobby.
   */
  leaveLobby() {
    if (this.socket?.connected) {
      this.socket.emit('lobby:leave');
    }
  }

  /**
   * Kicks a player from the lobby (host only).
   */
  kickPlayer(playerId) {
    if (this.socket?.connected) {
      this.socket.emit('lobby:kick-player', { playerId });
    }
  }

  /**
   * Updates lobby settings (host only).
   */
  updateSettings(settings) {
    if (this.socket?.connected) {
      this.socket.emit('lobby:update-settings', { settings });
    }
  }

  /**
   * Starts the game (host only).
   */
  startGame() {
    if (this.socket?.connected) {
      this.socket.emit('lobby:start-game');
    }
  }

  /**
   * Adds a bot to the lobby (host only).
   */
  addBot() {
    if (this.socket?.connected) {
      this.socket.emit('lobby:add-bot');
    }
  }

  // =====================
  // Game Methods
  // =====================

  /**
   * Submits a bid.
   */
  submitBid(bid) {
    if (this.socket?.connected) {
      this.socket.emit('game:submit-bid', { bid });
    }
  }

  /**
   * Plays a card.
   */
  playCard(card) {
    if (this.socket?.connected) {
      this.socket.emit('game:play-card', { card });
    }
  }

  /**
   * Requests current game state (for reconnection).
   */
  requestGameState() {
    if (this.socket?.connected) {
      this.socket.emit('game:state-request');
    }
  }

  // =====================
  // Event Listeners
  // =====================

  /**
   * Subscribes to an event.
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);

    // Also subscribe to socket event
    if (this.socket) {
      this.socket.on(event, callback);
    }

    return () => this.off(event, callback);
  }

  /**
   * Unsubscribes from an event.
   */
  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
    if (this.socket) {
      this.socket.off(event, callback);
    }
  }

  /**
   * Emits to all listeners for an event.
   */
  _emitToListeners(event, data) {
    if (this.listeners.has(event)) {
      for (const callback of this.listeners.get(event)) {
        callback(data);
      }
    }
  }

  /**
   * Re-subscribes all listeners (called after reconnection).
   */
  _resubscribeListeners() {
    for (const [event, callbacks] of this.listeners) {
      for (const callback of callbacks) {
        this.socket.on(event, callback);
      }
    }
  }
}

// Export singleton instance
export const socketService = new SocketService();

export default socketService;
