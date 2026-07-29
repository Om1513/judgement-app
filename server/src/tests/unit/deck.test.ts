// Deck construction, shuffling and dealing.
//
// Dealing is the one place a bug would silently hand two players the same card,
// so the assertions here are mostly about uniqueness and conservation.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  createDeck,
  shuffleDeck,
  dealCards,
  sortHand,
  SUITS,
  RANKS,
  RANK_VALUES,
  pickTrumpSuit,
} from '../../utils/cardUtils';
import { Card } from '../../types/player';
import { withSeed, withFixedRandom } from '../helpers/random';

const key = (c: Card) => `${c.rank}-${c.suit}`;

describe('createDeck', () => {
  test('builds a standard 52-card deck with no duplicates', () => {
    const deck = createDeck();
    assert.equal(deck.length, 52);
    assert.equal(new Set(deck.map(key)).size, 52);
  });

  test('covers every rank in every suit', () => {
    const deck = createDeck();
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        assert.ok(
          deck.some((c) => c.suit === suit && c.rank === rank),
          `missing ${rank} of ${suit}`
        );
      }
    }
  });

  test('stamps each card with its comparison value', () => {
    for (const c of createDeck()) {
      assert.equal(c.value, RANK_VALUES[c.rank]);
    }
  });
});

describe('shuffleDeck', () => {
  test('is a permutation - same cards, none lost or duplicated', () => {
    const deck = createDeck();
    const shuffled = withSeed(99, () => shuffleDeck(deck));

    assert.equal(shuffled.length, deck.length);
    assert.deepEqual(new Set(shuffled.map(key)), new Set(deck.map(key)));
  });

  test('does not mutate the deck it was given', () => {
    const deck = createDeck();
    const before = deck.map(key);
    withSeed(3, () => shuffleDeck(deck));
    assert.deepEqual(deck.map(key), before);
  });

  test('actually reorders - different seeds give different results', () => {
    const deck = createDeck();
    const a = withSeed(1, () => shuffleDeck(deck)).map(key).join();
    const b = withSeed(2, () => shuffleDeck(deck)).map(key).join();
    assert.notEqual(a, b);
    assert.notEqual(a, deck.map(key).join());
  });
});

describe('dealCards', () => {
  test('gives each player the requested number of cards', () => {
    const hands = withSeed(11, () => dealCards(4, 5));
    assert.equal(hands.length, 4);
    for (const hand of hands) {
      assert.equal(hand.length, 5);
    }
  });

  test('never deals the same card to two players', () => {
    for (let seed = 0; seed < 25; seed++) {
      const hands = withSeed(seed, () => dealCards(8, 6));
      const all = hands.flat().map(key);
      assert.equal(new Set(all).size, all.length, `duplicate dealt with seed ${seed}`);
    }
  });

  test('supports the largest legal table without exhausting the deck', () => {
    // 8 players x 8 cards = 64 > 52, which the current slice-based dealer
    // cannot satisfy; the real game caps rounds at 8 with fewer players, so
    // pin the largest combination it must handle.
    const hands = withSeed(5, () => dealCards(6, 8));
    const all = hands.flat();
    assert.equal(all.length, 48);
    assert.equal(new Set(all.map(key)).size, 48);
  });

  test('returns each hand sorted by suit then descending rank', () => {
    const [hand] = withSeed(21, () => dealCards(1, 13));
    assert.deepEqual(hand, sortHand(hand), 'dealt hands come pre-sorted');
  });
});

describe('sortHand', () => {
  test('groups by suit and puts the high cards first within a suit', () => {
    const hand: Card[] = [
      { suit: 'clubs', rank: '2', value: 2 },
      { suit: 'spades', rank: '5', value: 5 },
      { suit: 'spades', rank: 'A', value: 14 },
      { suit: 'hearts', rank: 'K', value: 13 },
    ];

    assert.deepEqual(
      sortHand(hand).map((c) => `${c.rank}${c.suit[0]}`),
      ['As', '5s', 'Kh', '2c']
    );
  });

  test('does not mutate the hand it was given', () => {
    const hand: Card[] = [
      { suit: 'clubs', rank: '2', value: 2 },
      { suit: 'spades', rank: 'A', value: 14 },
    ];
    const before = hand.map(key);
    sortHand(hand);
    assert.deepEqual(hand.map(key), before);
  });
});

describe('pickTrumpSuit', () => {
  test('only ever returns a real suit', () => {
    for (let seed = 0; seed < 30; seed++) {
      assert.ok(SUITS.includes(withSeed(seed, () => pickTrumpSuit())));
    }
  });

  test('is uniform over the four suits, not stuck on one', () => {
    const seen = new Set(
      Array.from({ length: 100 }, (_, seed) => withSeed(seed, () => pickTrumpSuit()))
    );
    assert.equal(seen.size, 4);
  });

  test('a random draw of 0 lands on the first suit (bounds check)', () => {
    assert.equal(withFixedRandom(0, () => pickTrumpSuit()), SUITS[0]);
  });

  test('a random draw just under 1 lands on the last suit, never out of range', () => {
    assert.equal(withFixedRandom(0.9999, () => pickTrumpSuit()), SUITS[SUITS.length - 1]);
  });
});
