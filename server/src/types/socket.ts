// Socket.IO event types for Kachuful game

import { LobbyState, LobbySettings, CreateLobbyInput, JoinLobbyInput } from './lobby';
import { ClientGameState, SubmitBidInput, PlayCardInput, ScoreboardState, GameWinner } from './game';
import { Card } from './player';

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

  // Emitted right after (re)connect when the player was already in a lobby or
  // an in-progress game, so the client can restore the correct screen/state.
  'session:restore': (data: {
    lobby: LobbyState | null;
    gameState: ClientGameState | null;
  }) => void;

  // Lobby events
  'lobby:created': (data: { lobby: LobbyState }) => void;
  'lobby:joined': (data: { lobby: LobbyState }) => void;
  'lobby:update': (data: { lobby: LobbyState }) => void;
  'lobby:error': (data: { message: string; code?: string }) => void;
  'lobby:kicked': (data: { message: string }) => void;
  'lobby:player-joined': (data: { player: { id: string; name: string }; lobby: LobbyState }) => void;
  'lobby:player-left': (data: { playerId: string; lobby: LobbyState }) => void;

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
