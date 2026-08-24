// Socket.IO client service for React Native

import { io } from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SERVER_URL } from '../config';
import { clearSession, saveSession } from './session';

const CLIENT_ID_KEY = '@kachuful_client_id';

// How long to wait for the server to answer the initial connect.
const CONNECT_TIMEOUT_MS = 10000;

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
    this.playerName = '';
    this.clientId = null;
    this.isConnected = false;
    this.listeners = new Map();
    // Last *successful* session payload pushed by the server on (re)connect, so
    // screens can restore the correct view after a drop. Null whenever the
    // server's answer was "you have no session".
    this.lastSession = null;
    // In-flight connect(), so overlapping callers share one socket rather than
    // racing to open a second one.
    this.connectPromise = null;
    // Subscribers to the session answer. Held here rather than on the socket so
    // a caller can subscribe before the socket exists - which is exactly what
    // cold-start restore does.
    this.sessionListeners = new Set();
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
    } catch {
      // If storage fails, fall back to an in-memory id for this run.
      this.clientId = this.clientId || generateClientId();
    }
    return this.clientId;
  }

  /**
   * Connects to the server with player name.
   *
   * Idempotent by design, because startup calls it from more than one place: an
   * already-connected socket resolves immediately, an in-flight connect is
   * shared, and a socket that exists but is still negotiating is waited on
   * rather than replaced. There is one socket per app session - a second one
   * would double every listener and every `session:restore`.
   */
  async connect(playerName) {
    if (playerName) {
      // Remembered so automatic reconnects re-identify with the current name.
      this.playerName = playerName;
    }

    // Ensure we have a stable identity before opening the socket.
    await this.getClientId();

    if (this.socket?.connected && this.playerId) {
      return { playerId: this.playerId };
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    const attempt = new Promise((resolve, reject) => {
      if (!this.socket) {
        this.socket = io(SERVER_URL, {
          // WebSocket first, with long-polling fallback for networks/proxies
          // that block raw WS upgrades (common on mobile data / corporate WiFi).
          transports: ['websocket', 'polling'],
          reconnection: true,
          reconnectionAttempts: Infinity,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
          timeout: CONNECT_TIMEOUT_MS,
        });
        this._registerCoreHandlers();
      }

      // One-shot listeners for *this* attempt only, so a later reconnect cannot
      // settle an old promise.
      let timer = null;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        this.socket?.off('connected', onConnected);
        this.socket?.off('connect_error', onConnectError);
        // Only if it is still ours: a caller that started a *later* attempt owns
        // the field by then, and must not have it cleared out from under it.
        if (this.connectPromise === attempt) {
          this.connectPromise = null;
        }
      };
      const onConnected = (data) => {
        cleanup();
        resolve({ playerId: data.playerId });
      };
      const onConnectError = (error) => {
        cleanup();
        reject(new Error(error?.message || 'Failed to connect to server'));
      };

      this.socket.on('connected', onConnected);
      this.socket.on('connect_error', onConnectError);

      timer = setTimeout(() => {
        cleanup();
        reject(new Error('Connection timeout'));
      }, CONNECT_TIMEOUT_MS);

      // A socket created by an earlier attempt may already be connected but not
      // yet identified; nudge it rather than waiting for a 'connect' that has
      // already fired.
      if (this.socket.connected) {
        this._identify();
      }
    });

    this.connectPromise = attempt;
    return attempt;
  }

  /**
   * Wires the handlers that belong to the socket itself rather than to one
   * connect() call. Called exactly once per socket, so these can never stack up.
   */
  _registerCoreHandlers() {
    // Fires on the initial connect AND on every automatic reconnect, so we
    // always (re)authenticate with our stable clientId, which is what lets the
    // server restore our lobby/game session.
    this.socket.on('connect', () => {
      // Log the negotiated transport so production issues (e.g. stuck on HTTP
      // long-polling instead of WebSocket) are easy to spot.
      const transport = this.socket.io?.engine?.transport?.name;
      console.log('Socket connected:', this.socket.id, 'transport:', transport);
      this.socket.io?.engine?.once('upgrade', () => {
        console.log('Socket transport upgraded:', this.socket.io.engine.transport.name);
      });
      this.isConnected = true;
      this._identify();
    });

    // The server's answer to "does this player have somewhere to be?", sent once
    // per identification. Screens that need the state itself subscribe to
    // lobby:update / game:update, which the server sends alongside; this handler
    // owns the *session* consequences - what is cached, and what is persisted.
    this.socket.on('session:restore', (data) => {
      this._handleSessionRestore(data);
    });

    this.socket.on('connected', (data) => {
      console.log('Player connected:', data.playerId);
      this.playerId = data.playerId;
      // `session:restore` is sent just *before* this, so on a first connect it
      // arrives with no player id to file the session under. This is the first
      // moment there is one.
      if (this.lastSession?.lobby) {
        this._rememberSession(this.lastSession.lobby);
      }
    });

    this.socket.on('connect_error', (error) => {
      console.error('Connection error:', error?.message || error);
    });

    // A temporary drop must not touch the saved session: the whole point of it
    // is to survive exactly this.
    this.socket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
      this.isConnected = false;
    });

    // Entering a lobby is what creates a session worth surviving a cold start.
    // Recorded here, once, rather than in the create/join screens, so there is a
    // single place that decides what "being in a game" means.
    const remember = (data) => this._rememberSession(data?.lobby);
    this.socket.on('lobby:created', remember);
    this.socket.on('lobby:joined', remember);

    // Being kicked is permanent - there is nothing left to come back to.
    this.socket.on('lobby:kicked', () => {
      void this.clearSavedSession();
    });

    this.socket.on('error', (data) => {
      console.error('Socket error:', data.message);
      this._emitToListeners('error', data);
    });
  }

  /**
   * Files a lobby as the session to come back to after a cold start.
   *
   * A no-op until the server has issued a player id - the record is keyed on it,
   * and guessing would file the session under the wrong player. The `connected`
   * handler retries once the id arrives.
   */
  _rememberSession(lobby) {
    if (!lobby || !this.playerId) {
      return;
    }
    void saveSession({
      playerId: this.playerId,
      playerName: this.playerName,
      lobbyCode: lobby.code,
      lobbyId: lobby.id,
    });
  }

  /** Identifies this connection to the server. */
  _identify() {
    this.socket.emit('player:connect', {
      name: this.playerName,
      clientId: this.clientId,
      playerId: this.playerId || undefined,
    });
  }

  /**
   * Applies a `session:restore` answer: caches it, keeps the persisted pointer
   * in step, and hands it to whoever is waiting (cold-start restore).
   */
  _handleSessionRestore(data) {
    const restored = data?.restored === true && !!data?.lobby;

    if (restored) {
      console.log(
        `[Session] Session restored: lobby ${data.lobby.code}` +
          (data.gameState ? ` (in game, ${data.gameState.status})` : '')
      );
      this.lastSession = data;
      // Refresh the pointer on every restore, so a lobby joined on one launch is
      // still the one we ask for on the next.
      this._rememberSession(data.lobby);
    } else {
      this.lastSession = null;
      if (data?.reason === 'SESSION_NOT_FOUND') {
        // Authoritative: the game finished, the lobby went, or we were removed.
        console.log('[Session] No active session');
        void this.clearSavedSession();
      } else {
        // RESTORE_FAILED, or a payload we do not understand. The session may
        // still be perfectly good, so it is deliberately left alone.
        console.log('[Session] Session could not be restored:', data?.reason || 'UNKNOWN');
      }
    }

    for (const callback of [...this.sessionListeners]) {
      try {
        callback(data);
      } catch (error) {
        console.log('[Session] Restore listener failed:', error?.message);
      }
    }
  }

  /**
   * Subscribes to the server's session answer. Returns an unsubscribe function.
   * Safe to call before connect() - these listeners outlive any one socket.
   */
  onSession(callback) {
    this.sessionListeners.add(callback);
    return () => this.sessionListeners.delete(callback);
  }

  /** Forgets the persisted session pointer (and the cached payload with it). */
  async clearSavedSession() {
    this.lastSession = null;
    await clearSession();
  }

  /**
   * Disconnects from the server.
   *
   * Closing the socket is not leaving a game, so the saved session survives -
   * use leaveLobby()/leaveCurrentSession() for a deliberate exit.
   */
  disconnect() {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
      this.playerId = null;
      this.isConnected = false;
      this.connectPromise = null;
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
   *
   * This is the deliberate exit - Leave Lobby / Leave Game - so the saved
   * session goes with it. Reopening the app afterwards must land on Home, not
   * back in the game they chose to walk out of.
   */
  leaveLobby() {
    if (this.socket?.connected) {
      this.socket.emit('lobby:leave');
    }
    void this.clearSavedSession();
  }

  /**
   * Leaves whatever lobby/game the server still has this player attached to
   * (e.g. a previous session restored on reconnect), and clears the cached
   * session. Resolves after a short grace period so the server can process the
   * removal before a subsequent create/join.
   */
  leaveCurrentSession() {
    return new Promise((resolve) => {
      if (this.socket?.connected) {
        this.socket.emit('lobby:leave');
      }
      void this.clearSavedSession();
      setTimeout(resolve, 600);
    });
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
