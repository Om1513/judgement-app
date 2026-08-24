// Socket.IO event types for Kachuful game

import { LobbyState, LobbySettings } from './lobby';
import { ClientGameState, ScoreboardState, GameWinner } from './game';
import { Card } from './player';

/** Why a connection was not given a session back. */
export type SessionRestoreFailure =
  /** The player is not a member of any lobby: finished, kicked, left, expired. */
  | 'SESSION_NOT_FOUND'
  /** The lookup itself failed (database error). The client must NOT treat this
   *  as "your session is gone" - its saved session may still be perfectly good. */
  | 'RESTORE_FAILED';

/**
 * The answer to "does this player have somewhere to be?", sent once per
 * identified connection.
 *
 * `restored: true` carries everything the client needs to put the player back
 * where they were, including - for a game sitting on the round scoreboard - the
 * scoreboard itself, so a cold-started app can render the right phase without a
 * second round trip. `gameState` is the same per-player view used during normal
 * play: the player's own hand, and only card *counts* for everyone else.
 */
export interface SessionRestorePayload {
  restored: boolean;
  reason?: SessionRestoreFailure;
  lobby: LobbyState | null;
  gameState: ClientGameState | null;
  scoreboard?: ScoreboardState | null;
}

// Client to Server events
export interface ClientToServerEvents {
  // Player events. `clientId` is a stable, app-generated id used to recover the
  // same player across reconnects; `playerId` is an optional hint from a prior
  // session. Older clients may send neither.
  'player:connect': (data: { name: string; clientId?: string; playerId?: string }) => void;

  // Lobby events
  'lobby:create': (data: { playerName: string; settings?: Partial<LobbySettings> }) => void;
  'lobby:join': (data: { code: string; playerName: string }) => void;
  'lobby:leave': () => void;
  'lobby:kick-player': (data: { playerId: string }) => void;
  'lobby:update-settings': (data: { settings: Partial<LobbySettings> }) => void;
  'lobby:start-game': () => void;
  'lobby:add-bot': () => void;

  // Game events
  'game:submit-bid': (data: { bid: number }) => void;
  'game:play-card': (data: { card: Card }) => void;
  'game:state-request': () => void;

  // Scoreboard events
  'scoreboard:get-state': () => void;
  'scoreboard:continue': () => void;

  // Final game events
  'game:get-final-scoreboard': () => void;
}

// Server to Client events
export interface ServerToClientEvents {
  // Connection events
  'connected': (data: { playerId: string; reconnected?: boolean }) => void;
  'error': (data: { message: string; code?: string }) => void;

  // Emitted exactly once per `player:connect`, immediately before `connected`,
  // whether or not there was a session to give back. A warm reconnect uses it to
  // refresh the open screen; a cold-started app uses it to decide between
  // navigating back into the lobby/game and staying on Home. Always answering -
  // including with `restored: false` - is what lets a cold start tell "you have
  // nothing to come back to" apart from "the server never replied".
  'session:restore': (data: SessionRestorePayload) => void;

  // Lobby events
  'lobby:created': (data: { lobby: LobbyState }) => void;
  'lobby:joined': (data: { lobby: LobbyState }) => void;
  'lobby:update': (data: { lobby: LobbyState }) => void;
  'lobby:error': (data: { message: string; code?: string }) => void;
  'lobby:kicked': (data: { message: string }) => void;
  'lobby:player-joined': (data: { player: { id: string; name: string }; lobby: LobbyState }) => void;
  'lobby:player-left': (data: { playerId: string; lobby: LobbyState }) => void;

  // A waiting-lobby player dropped out and is inside their reconnect grace
  // period. Their seat is still theirs: show them as reconnecting, do not
  // remove the card. `reconnectDeadline` is an ISO timestamp.
  'lobby:player-disconnected': (data: {
    playerId: string;
    playerName: string;
    reconnectDeadline: string;
    lobby: LobbyState;
  }) => void;
  // The same player is back on a new socket with their original seat. This is
  // deliberately NOT `lobby:player-joined` - a reconnect is not a new join, and
  // must not replay join feedback such as sounds.
  'lobby:player-reconnected': (data: {
    playerId: string;
    playerName: string;
    lobby: LobbyState;
  }) => void;

  // Game events
  'game:started': (data: { gameState: ClientGameState }) => void;
  'game:update': (data: { gameState: ClientGameState }) => void;
  'game:error': (data: { message: string; code?: string }) => void;
  'game:trick-completed': (data: {
    trickNumber: number;
    winnerId: string;
    winnerName: string;
    cardsPlayed: { playerId: string; card: Card }[];
  }) => void;
  'game:round-complete': (data: { roundNumber: number; scores: Record<string, number> }) => void;
  'game:over': (data: { finalScores: Record<string, number>; winner: { id: string; name: string } }) => void;
  'game:completed': (data: { finalScores: Record<string, number>; winner: { id: string; name: string } }) => void;

  // Hand (trick) winner events
  'hand:winner-announced': (data: { playerId: string; playerName: string; trickNumber: number }) => void;
  'hand:next-started': (data: { trickNumber: number; leaderId: string }) => void;

  // Final game winner events
  'game:final-winner': (data: {
    winners: GameWinner[];
    winnerIds: string[];
    winningScore: number;
    isTie: boolean;
    finalScores: Record<string, number>;
  }) => void;
  'game:final-scoreboard': (data: {
    scoreboard: ScoreboardState;
    winnerIds: string[];
    winningScore: number;
  }) => void;

  // Scoreboard events
  'scoreboard:state': (data: { scoreboard: ScoreboardState }) => void;
  'scoreboard:player-continued': (data: { playerId: string; playerName: string }) => void;
  'scoreboard:all-continued': () => void;
  'round:bidding-started': (data: { gameState: ClientGameState }) => void;
}

// Inter-server events (for future Redis scaling)
export interface InterServerEvents {
  ping: () => void;
}

// Socket data attached to each socket
export interface SocketData {
  playerId: string;
  playerName: string;
  lobbyId: string | null;
  gameId: string | null;
}

// Error codes for consistent error handling
export const SocketErrorCodes = {
  INVALID_INPUT: 'INVALID_INPUT',
  PLAYER_NOT_FOUND: 'PLAYER_NOT_FOUND',
  LOBBY_NOT_FOUND: 'LOBBY_NOT_FOUND',
  LOBBY_FULL: 'LOBBY_FULL',
  NOT_HOST: 'NOT_HOST',
  GAME_NOT_FOUND: 'GAME_NOT_FOUND',
  NOT_YOUR_TURN: 'NOT_YOUR_TURN',
  INVALID_ACTION: 'INVALID_ACTION',
  ALREADY_IN_LOBBY: 'ALREADY_IN_LOBBY',
} as const;

export type SocketErrorCode = typeof SocketErrorCodes[keyof typeof SocketErrorCodes];
