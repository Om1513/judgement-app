// Lobby types for the Kachuful game

import { LobbyPlayer } from './player';

export type LobbyStatus = 'WAITING' | 'IN_GAME' | 'COMPLETED';

export type OrderMode = 'Kachuful' | 'Random';
export type ScoringMode = '+10' | '+1';

export interface LobbySettings {
  rounds: number;      // 4 to 8
  orderMode: OrderMode;
  scoringMode: ScoringMode;
  maxPlayers: number;  // 3 to 8
}

export interface Lobby {
  id: string;
  code: string;
  hostPlayerId: string;
  hostName: string;
  status: LobbyStatus;
  settings: LobbySettings;
  players: LobbyPlayer[];
  createdAt: Date;
}

export interface CreateLobbyInput {
  hostPlayerId: string;
  hostName: string;
  settings?: Partial<LobbySettings>;
}

export interface JoinLobbyInput {
  code: string;
  playerId: string;
  playerName: string;
}

export interface UpdateLobbySettingsInput {
  lobbyId: string;
  hostPlayerId: string;
  settings: Partial<LobbySettings>;
}

// Lobby state broadcast to all clients
export interface LobbyState {
  id: string;
  code: string;
  hostPlayerId: string;
  hostName: string;
  status: LobbyStatus;
  settings: LobbySettings;
  players: LobbyPlayer[];
  playerCount: number;
  canStart: boolean;
}

// Default lobby settings
export const DEFAULT_LOBBY_SETTINGS: LobbySettings = {
  rounds: 4,
  orderMode: 'Kachuful',
  scoringMode: '+10',
  maxPlayers: 8,
};
