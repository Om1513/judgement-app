// Game types for the Kachuful card game

import { Card, GamePlayer } from './player';
import { LobbySettings } from './lobby';
import { TrumpSuit } from '../utils/trump';

// Trump info for the round
export interface TrumpInfo {
  key: string;       // e.g., "Kari", "Chukat", "Falli", "Lal"
  name: string;      // Display name
  suit: string;      // e.g., "spades", "diamonds", "clubs", "hearts"
  symbol: string;    // e.g., "♠", "♦", "♣", "♥"
}

export type GameStatus =
  | 'BIDDING'
  | 'PLAYING'
  | 'HAND_WINNER'
  | 'ROUND_COMPLETE'
  | 'ROUND_SCOREBOARD'
  | 'GAME_OVER'
  | 'FINAL_WINNER'
  | 'COMPLETED';

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
  trump: TrumpInfo | null;           // Full trump info with name and symbol
  dealerId: string;
  bids: Record<string, number>;      // playerId -> bid
  tricksWon: Record<string, number>; // playerId -> tricks won
  currentTrick: Trick | null;
  trickNumber: number;
  bidOrder: string[];                // Order of players for bidding
  currentBidderIndex: number;        // Index in bidOrder
  // Inter-hand pause: set when a trick completes and we are holding to show
  // the hand-winner popup before dealing/leading the next hand.
  awaitingNextHand?: boolean;
  nextLeaderId?: string | null;      // Winner of the just-completed trick; leads next hand
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
  turnOrder: string[];            // array of player IDs
  currentTurnIndex: number;
  trumpOrder: TrumpInfo[];        // Pre-generated trump order for all rounds
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

// Player info with card count (for client)
export interface ClientPlayer {
  id: string;
  name: string;
  seatPosition: number;
  bid: number | null;
  tricksWon: number;
  score: number;
  isCurrentTurn: boolean;
  cardCount: number;
  hasBid: boolean;
}

// Client round state
export interface ClientRoundState {
  roundNumber: number;
  cardsPerPlayer: number;
  trumpSuit: Card['suit'] | null;
  trump: TrumpInfo | null;
  bids: Record<string, number>;
  tricksWon: Record<string, number>;
  currentTrick: Trick | null;
  trickNumber: number;
  bidOrder: string[];
  currentBidderIndex: number;
  currentBidderId: string | null;
  totalBidsSoFar: number;
  isLastBidder: boolean;
  awaitingNextHand?: boolean;
}

// Game state broadcast to clients (may hide other players' hands)
export interface ClientGameState {
  id: string;
  lobbyId: string;
  currentRound: number;
  totalRounds: number;
  status: GameStatus;
  players: ClientPlayer[];
  myHand: Card[];
  currentTurnPlayerId: string | null;
  roundState: ClientRoundState | null;
  scores: Record<string, number>;
  isMyTurn: boolean;
  trumpOrder: TrumpInfo[];
}

// Scoreboard types
export interface ScoreboardPlayer {
  id: string;
  name: string;
  isHost: boolean;
  isBot: boolean;
  totalScore: number;
  hasContinued: boolean;
}

export interface ScoreboardRowScore {
  playerId: string;
  bid: number | null;
  handsMade: number | null;
  score: number | null;
}

export interface ScoreboardRow {
  roundNumber: number;
  trump: TrumpInfo;
  scores: ScoreboardRowScore[];
}

export interface ScoreboardState {
  gameId: string;
  roundId: string;
  currentRound: number;
  totalRounds: number;
  scoringMode: '+10' | '+1';
  status: 'round_scoreboard' | 'completed';
  players: ScoreboardPlayer[];
  rows: ScoreboardRow[];
}

// Final game result (computed by the backend, stored once)
export interface GameWinner {
  id: string;
  name: string;
}

export interface FinalResult {
  winners: GameWinner[];          // multiple winners on a tie
  winnerIds: string[];
  winningScore: number;
  isTie: boolean;
  finalScores: Record<string, number>; // playerId -> total score
}
