// Socket.IO client service for React Native

import { io } from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SERVER_URL } from '../config';

const CLIENT_ID_KEY = '@kachuful_client_id';

/**
 * Generates a stable, reasonably-unique client id without requiring a crypto
 * polyfill (not always available in React Native).
 */
function generateClientId() {
  const rand = () => Math.random().toString(36).slice(2, 10);
  return `c_${Date.now().toString(36)}_${rand()}${rand()}`;
}

class SocketService {
  constructor() {
    this.socket = null;
    this.playerId = null;
    this.clientId = null;
    this.isConnected = false;
    this.listeners = new Map();
    // Last session payload pushed by the server on (re)connect, so screens can
    // restore the correct view after a drop.
    this.lastSession = null;
  }

  /**
   * Loads (or lazily creates and persists) this device's stable client id.
   * Used so the server can recover the same player across reconnects.
   */
  async getClientId() {
    if (this.clientId) {
      return this.clientId;
    }
    try {
      let id = await AsyncStorage.getItem(CLIENT_ID_KEY);
      if (!id) {
        id = generateClientId();
        await AsyncStorage.setItem(CLIENT_ID_KEY, id);
      }
      this.clientId = id;
    } catch (error) {
      // If storage fails, fall back to an in-memory id for this run.
      this.clientId = this.clientId || generateClientId();
    }
    return this.clientId;
  }

  /**
   * Connects to the server with player name.
   */
  async connect(playerName) {
    // Ensure we have a stable identity before opening the socket.
    const clientId = await this.getClientId();

    return new Promise((resolve, reject) => {
      if (this.socket?.connected) {
        resolve({ playerId: this.playerId });
        return;
      }

      this.socket = io(SERVER_URL, {
        // WebSocket first, with long-polling fallback for networks/proxies that
        // block raw WS upgrades (common on mobile data / corporate WiFi).
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 10000,
      });

      // Handle connection. This fires on the initial connect AND on every
      // automatic reconnect, so we always (re)authenticate with our stable
      // clientId, which lets the server restore our lobby/game session.
      this.socket.on('connect', () => {
        console.log('Socket connected:', this.socket.id);
        this.isConnected = true;

        this.socket.emit('player:connect', {
          name: playerName,
          clientId,
          playerId: this.playerId || undefined,
        });
      });

      // Server-pushed session recovery (lobby/game state after a reconnect).
      // Cache only - screens that need it subscribe via socketService.on(),
      // which attaches directly to the socket, so we must not re-dispatch here.
      this.socket.on('session:restore', (data) => {
        console.log('Session restored:', data?.lobby?.code, !!data?.gameState);
        this.lastSession = data;
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
  // Scoreboard Methods
  // =====================

  /**
   * Requests current scoreboard state.
   */
  getScoreboardState() {
    if (this.socket?.connected) {
      this.socket.emit('scoreboard:get-state');
    }
  }

  /**
   * Sends continue confirmation on scoreboard.
   */
  scoreboardContinue() {
    if (this.socket?.connected) {
      this.socket.emit('scoreboard:continue');
    }
  }

  /**
   * Requests the final scoreboard for a completed game.
   */
  getFinalScoreboard() {
    if (this.socket?.connected) {
      this.socket.emit('game:get-final-scoreboard');
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
