// Card utilities for the Kachuful game

import { Card } from '../types/player';

export const SUITS: Card['suit'][] = ['hearts', 'diamonds', 'clubs', 'spades'];

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;

export const RANK_VALUES: Record<string, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  'J': 11,
  'Q': 12,
  'K': 13,
  'A': 14,
};

/**
 * Creates a standard 52-card deck.
 */
export function createDeck(): Card[] {
  const deck: Card[] = [];

  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({
        suit,
        rank,
        value: RANK_VALUES[rank],
      });
    }
  }

  return deck;
}

/**
 * Shuffles a deck using Fisher-Yates algorithm.
 */
export function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}

/**
 * Deals cards to players.
 * Returns an array of hands, one for each player.
 */
export function dealCards(
  playerCount: number,
  cardsPerPlayer: number
): Card[][] {
  const deck = shuffleDeck(createDeck());
  const hands: Card[][] = [];

  for (let i = 0; i < playerCount; i++) {
    const startIndex = i * cardsPerPlayer;
    const hand = deck.slice(startIndex, startIndex + cardsPerPlayer);
    hands.push(sortHand(hand));
  }

  return hands;
}

/**
 * Sorts a hand by suit and then by rank.
 */
export function sortHand(hand: Card[]): Card[] {
  const suitOrder: Record<Card['suit'], number> = {
    spades: 0,
    hearts: 1,
    diamonds: 2,
    clubs: 3,
  };

  return [...hand].sort((a, b) => {
    if (suitOrder[a.suit] !== suitOrder[b.suit]) {
      return suitOrder[a.suit] - suitOrder[b.suit];
    }
    return b.value - a.value; // Higher cards first within suit
  });
}

/**
 * Determines the winner of a trick.
 */
export function determineTrickWinner(
  cardsPlayed: { playerId: string; card: Card }[],
  leadSuit: Card['suit'],
  trumpSuit: Card['suit'] | null
): string {
  if (cardsPlayed.length === 0) {
    throw new Error('No cards played');
  }

  let winningPlay = cardsPlayed[0];
  let winningIsTrump = trumpSuit !== null && winningPlay.card.suit === trumpSuit;

  for (let i = 1; i < cardsPlayed.length; i++) {
    const play = cardsPlayed[i];
    const isTrump = trumpSuit !== null && play.card.suit === trumpSuit;

    // Trump beats non-trump
    if (isTrump && !winningIsTrump) {
      winningPlay = play;
      winningIsTrump = true;
      continue;
    }

    // Non-trump cannot beat trump
    if (!isTrump && winningIsTrump) {
      continue;
    }

    // Both trump or both non-trump
    if (isTrump && winningIsTrump) {
      // Both are trump - higher value wins
      if (play.card.value > winningPlay.card.value) {
        winningPlay = play;
      }
    } else {
      // Neither is trump - must follow lead suit to win
      if (play.card.suit === leadSuit && winningPlay.card.suit === leadSuit) {
        if (play.card.value > winningPlay.card.value) {
          winningPlay = play;
        }
      } else if (play.card.suit === leadSuit) {
        winningPlay = play;
      }
      // If neither follows lead suit, first card wins
    }
  }

  return winningPlay.playerId;
}

/**
 * Checks if a card can be legally played.
 */
export function canPlayCard(
  card: Card,
  hand: Card[],
  leadSuit: Card['suit'] | null
): boolean {
  // If no lead suit (first card of trick), any card can be played
  if (!leadSuit) {
    return hand.some(c => c.suit === card.suit && c.rank === card.rank);
  }

  // Check if player has the lead suit
  const hasLeadSuit = hand.some(c => c.suit === leadSuit);

  if (hasLeadSuit) {
    // Must follow suit if possible
    return card.suit === leadSuit;
  }

  // If player doesn't have lead suit, any card is valid
  return hand.some(c => c.suit === card.suit && c.rank === card.rank);
}

/**
 * Calculates score for a round.
 *
 * For +10 scoring mode:
 * - If player's handsMade equals bid: score = bid * 10 (or 10 if bid is 0)
 * - If player misses their bid: score = 0
 *
 * For +1 scoring mode:
 * - If player's handsMade equals bid: score = bid (or 1 if bid is 0)
 * - If player misses their bid: score = 0
 */
export function calculateScore(
  bid: number,
  tricksWon: number,
  scoringMode: '+10' | '+1'
): number {
  if (bid === tricksWon) {
    // Made the bid exactly
    if (scoringMode === '+10') {
      // Bid 0 and made 0 = 10 points, else bid * 10
      return bid === 0 ? 10 : bid * 10;
    } else {
      // Bid 0 and made 0 = 1 point, else bid
      return bid === 0 ? 1 : bid;
    }
  } else {
    // Failed to make bid - 0 points
    return 0;
  }
}

/**
 * Gets the number of cards per player for a given round in Kachuful order.
 * In Kachuful, rounds start with 1 card and increase by 1 each round.
 * Round 1: 1 card, Round 2: 2 cards, ..., Round N: N cards
 */
export function getCardsForRound(round: number, _totalRounds: number): number {
  // Simple ascending: round 1 = 1 card, round 2 = 2 cards, etc.
  return round;
}

/**
 * Picks a random trump suit for the round.
 */
export function pickTrumpSuit(): Card['suit'] {
  const index = Math.floor(Math.random() * SUITS.length);
  return SUITS[index];
}
