// Game types for the Kachuful card game

import { Card, GamePlayer } from './player';
import { LobbySettings } from './lobby';

export type GameStatus = 'BIDDING' | 'PLAYING' | 'ROUND_COMPLETE' | 'GAME_OVER';

export type GameActionType =
  | 'BID_SUBMIT'
  | 'CARD_PLAY'
  | 'ROUND_START'
  | 'ROUND_END'
  | 'GAME_START'
  | 'GAME_END';

export interface GameAction {
  id: string;
  gameId: string;
  playerId: string;
  actionType: GameActionType;
  actionPayload: Record<string, unknown>;
  createdAt: Date;
}

// Current trick state
export interface Trick {
  leadPlayerId: string;
  leadSuit: Card['suit'] | null;
  cardsPlayed: {
    playerId: string;
    card: Card;
  }[];
  winnerId: string | null;
}

// Round state
export interface RoundState {
  roundNumber: number;
  cardsPerPlayer: number;
  trumpSuit: Card['suit'] | null;
  dealerId: string;
  bids: Record<string, number>; // playerId -> bid
  tricksWon: Record<string, number>; // playerId -> tricks won
  currentTrick: Trick | null;
  trickNumber: number;
}

// Full game state stored in gameStateJson
export interface GameState {
  players: GamePlayer[];
  currentRound: number;
  totalRounds: number;
  status: GameStatus;
  roundState: RoundState | null;
  scores: Record<string, number>; // playerId -> total score
  settings: LobbySettings;
  turnOrder: string[]; // array of player IDs
  currentTurnIndex: number;
}

export interface Game {
  id: string;
  lobbyId: string;
  currentRound: number;
  currentTurnPlayerId: string | null;
  status: GameStatus;
  gameState: GameState;
  createdAt: Date;
}

// Input types for game actions
export interface SubmitBidInput {
  gameId: string;
  playerId: string;
  bid: number;
}

export interface PlayCardInput {
  gameId: string;
  playerId: string;
  card: Card;
}

// Game state broadcast to clients (may hide other players' hands)
export interface ClientGameState {
  id: string;
  lobbyId: string;
  currentRound: number;
  totalRounds: number;
  status: GameStatus;
  players: Omit<GamePlayer, 'hand'>[];
  myHand: Card[];
  currentTurnPlayerId: string | null;
  roundState: {
    roundNumber: number;
    cardsPerPlayer: number;
    trumpSuit: Card['suit'] | null;
    bids: Record<string, number>;
    tricksWon: Record<string, number>;
    currentTrick: Trick | null;
    trickNumber: number;
  } | null;
  scores: Record<string, number>;
  isMyTurn: boolean;
}
