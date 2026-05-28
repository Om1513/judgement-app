// Bot strategy utilities for AI players in Kachuful game
// Only uses publicly available information (no cheating)

import { Card } from '../types/player';
import { RANK_VALUES } from './cardUtils';

/**
 * Determines which cards are legal to play based on follow-suit rules.
 */
export function getLegalCards(hand: Card[], leadSuit: Card['suit'] | null): Card[] {
  // If no lead suit (first card of trick), any card can be played
  if (!leadSuit) {
    return [...hand];
  }

  // Check if player has the lead suit
  const cardsInLeadSuit = hand.filter(c => c.suit === leadSuit);

  if (cardsInLeadSuit.length > 0) {
    // Must follow suit
    return cardsInLeadSuit;
  }

  // If no lead suit cards, any card is valid
  return [...hand];
}

/**
 * Counts "strong" cards in a hand for bid estimation.
 * Strong cards are high cards (10+) or trump cards.
 */
function countStrongCards(hand: Card[], trumpSuit: Card['suit']): number {
  let count = 0;

  for (const card of hand) {
    // Trump cards are always strong
    if (card.suit === trumpSuit) {
      // High trumps worth more
      if (card.value >= 10) {
        count += 1;
      } else if (card.value >= 7) {
        count += 0.6;
      } else {
        count += 0.3;
      }
    } else {
      // Non-trump high cards
      if (card.value >= 13) { // K or A
        count += 0.7;
      } else if (card.value >= 11) { // J or Q
        count += 0.4;
      } else if (card.value >= 10) {
        count += 0.2;
      }
    }
  }

  return count;
}

/**
 * Chooses a bid value for a bot based on hand strength.
 * Respects the last-bidder constraint where total bids cannot equal hand size.
 */
export function chooseBotBid(
  hand: Card[],
  trumpSuit: Card['suit'],
  handSize: number,
  totalBidsSoFar: number,
  isLastBidder: boolean
): number {
  // Count strong cards and estimate bid
  const strongCount = countStrongCards(hand, trumpSuit);

  // Base bid is floored strong count with some randomness
  let baseBid = Math.floor(strongCount);

  // Add some randomness (-1 to +1)
  const randomAdjust = Math.floor(Math.random() * 3) - 1;
  let bid = Math.max(0, Math.min(handSize, baseBid + randomAdjust));

  // If last bidder, respect the constraint: total bids cannot equal hand size
  if (isLastBidder) {
    const forbiddenBid = handSize - totalBidsSoFar;

    if (bid === forbiddenBid) {
      // Adjust bid away from forbidden value
      if (forbiddenBid === 0) {
        // Can't bid 0, bid 1 instead
        bid = 1;
      } else if (forbiddenBid === handSize) {
        // Can't bid handSize, bid handSize - 1
        bid = handSize - 1;
      } else {
        // Prefer bidding down, but up if that would be negative
        bid = forbiddenBid > 0 ? forbiddenBid - 1 : forbiddenBid + 1;
      }
    }
  }

  // Clamp to valid range
  return Math.max(0, Math.min(handSize, bid));
}

/**
 * Determines if the bot still needs to win more tricks to meet their bid.
 */
function botNeedsWin(bid: number, tricksMade: number): boolean {
  return tricksMade < bid;
}

/**
 * Determines if the bot has already met their bid and should avoid winning.
 */
function botShouldAvoidWin(bid: number, tricksMade: number): boolean {
  return tricksMade >= bid;
}

/**
 * Finds the currently winning card and player in the trick.
 */
function findCurrentWinner(
  cardsPlayed: { playerId: string; card: Card }[],
  leadSuit: Card['suit'],
  trumpSuit: Card['suit']
): { playerId: string; card: Card } | null {
  if (cardsPlayed.length === 0) return null;

  let winner = cardsPlayed[0];
  let winnerIsTrump = winner.card.suit === trumpSuit;

  for (let i = 1; i < cardsPlayed.length; i++) {
    const play = cardsPlayed[i];
    const isTrump = play.card.suit === trumpSuit;

    // Trump beats non-trump
    if (isTrump && !winnerIsTrump) {
      winner = play;
      winnerIsTrump = true;
      continue;
    }

    // Non-trump cannot beat trump
    if (!isTrump && winnerIsTrump) {
      continue;
    }

    // Both trump - higher wins
    if (isTrump && winnerIsTrump) {
      if (play.card.value > winner.card.value) {
        winner = play;
      }
    } else {
      // Neither is trump - only lead suit matters
      if (play.card.suit === leadSuit && winner.card.suit === leadSuit) {
        if (play.card.value > winner.card.value) {
          winner = play;
        }
      } else if (play.card.suit === leadSuit) {
        winner = play;
      }
    }
  }

  return winner;
}

/**
 * Determines if a card would win against the current winning card.
 */
function wouldWin(
  card: Card,
  currentWinner: { playerId: string; card: Card } | null,
  leadSuit: Card['suit'] | null,
  trumpSuit: Card['suit']
): boolean {
  if (!currentWinner || !leadSuit) return true; // First card always "wins" temporarily

  const winnerCard = currentWinner.card;
  const winnerIsTrump = winnerCard.suit === trumpSuit;
  const cardIsTrump = card.suit === trumpSuit;

  // Trump beats non-trump
  if (cardIsTrump && !winnerIsTrump) return true;
  if (!cardIsTrump && winnerIsTrump) return false;

  // Both trump - higher wins
  if (cardIsTrump && winnerIsTrump) {
    return card.value > winnerCard.value;
  }

  // Neither is trump
  // Must follow lead suit to have a chance
  if (card.suit !== leadSuit) return false;
  if (winnerCard.suit !== leadSuit) return true;

  return card.value > winnerCard.value;
}

/**
 * Chooses which card a bot should play.
 * Uses strategy based on whether bot needs to win or avoid winning.
 */
export function chooseBotCard(
  hand: Card[],
  leadSuit: Card['suit'] | null,
  trumpSuit: Card['suit'],
  bid: number,
  tricksMade: number,
  cardsPlayed: { playerId: string; card: Card }[]
): Card {
  const legalCards = getLegalCards(hand, leadSuit);

  if (legalCards.length === 1) {
    return legalCards[0];
  }

  // Sort cards by value (ascending for low play, descending for high play)
  const sortedAsc = [...legalCards].sort((a, b) => a.value - b.value);
  const sortedDesc = [...legalCards].sort((a, b) => b.value - a.value);

  const currentWinner = findCurrentWinner(cardsPlayed, leadSuit!, trumpSuit);
  const needsWin = botNeedsWin(bid, tricksMade);
  const shouldAvoid = botShouldAvoidWin(bid, tricksMade);

  // Leading the trick (no cards played yet)
  if (cardsPlayed.length === 0) {
    if (needsWin) {
      // Lead with a high card or trump to try to win
      const trumpCards = legalCards.filter(c => c.suit === trumpSuit);
      if (trumpCards.length > 0 && bid - tricksMade > 1) {
        // Lead low trump to draw out other trumps
        return trumpCards.sort((a, b) => a.value - b.value)[0];
      }
      // Lead with highest non-trump
      const nonTrump = legalCards.filter(c => c.suit !== trumpSuit);
      if (nonTrump.length > 0) {
        return nonTrump.sort((a, b) => b.value - a.value)[0];
      }
      return sortedDesc[0];
    } else {
      // Lead with lowest card to avoid winning
      return sortedAsc[0];
    }
  }

  // Following in the trick
  if (needsWin) {
    // Try to win the trick
    // Find the lowest card that would win
    for (const card of sortedAsc) {
      if (wouldWin(card, currentWinner, leadSuit, trumpSuit)) {
        return card;
      }
    }

    // Can't win - play lowest card
    return sortedAsc[0];
  } else {
    // Try to avoid winning
    // Find the highest card that won't win
    for (const card of sortedDesc) {
      if (!wouldWin(card, currentWinner, leadSuit, trumpSuit)) {
        return card;
      }
    }

    // All cards would win - play lowest to minimize damage
    return sortedAsc[0];
  }
}
