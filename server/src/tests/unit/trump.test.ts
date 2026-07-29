// Trump order for both lobby modes.
//
// Kachuful mode is a fixed repeating cycle. Random mode draws per round - so
// the tests assert on the properties every draw must satisfy rather than on one
// specific "random" sequence, which would just be testing the PRNG.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateTrumpOrder,
  generateKachufulTrumpOrder,
  generateRandomTrumpOrder,
  KACHUFUL_TRUMP_ORDER,
  TRUMP_SUITS,
  getTrumpColor,
  calculateHandSize,
  calculateSimpleHandSize,
} from '../../utils/trump';
import { getCardsForRound } from '../../utils/cardUtils';
import { withSeed } from '../helpers/random';

const VALID_KEYS = Object.keys(TRUMP_SUITS);

describe('Kachuful trump order', () => {
  test('runs Kari, Chukat, Falli, Lal and repeats every four rounds', () => {
    const order = generateTrumpOrder(8, 'Kachuful');

    assert.deepEqual(
      order.map((t) => t.name),
      ['Kari', 'Chukat', 'Falli', 'Lal', 'Kari', 'Chukat', 'Falli', 'Lal']
    );
  });

  test('maps each name to the right suit', () => {
    const order = generateTrumpOrder(8, 'Kachuful');

    assert.deepEqual(
      order.map((t) => t.suit),
      [
        'spades',
        'diamonds',
        'clubs',
        'hearts',
        'spades',
        'diamonds',
        'clubs',
        'hearts',
      ]
    );
  });

  test('wraps by modulo, so round 5 repeats round 1 and round 8 repeats round 4', () => {
    const order = generateTrumpOrder(8, 'Kachuful');
    assert.deepEqual(order[4], order[0]);
    assert.deepEqual(order[5], order[1]);
    assert.deepEqual(order[6], order[2]);
    assert.deepEqual(order[7], order[3]);
  });

  test('is deterministic - two games get identical sequences', () => {
    assert.deepEqual(generateKachufulTrumpOrder(6), generateKachufulTrumpOrder(6));
    assert.deepEqual(generateKachufulTrumpOrder(8), generateKachufulTrumpOrder(8));
  });

  test('produces exactly one trump per round', () => {
    for (const rounds of [4, 5, 6, 7, 8]) {
      assert.equal(generateKachufulTrumpOrder(rounds).length, rounds);
    }
  });
});

describe('Random trump order', () => {
  test('produces one fully populated, valid trump per round', () => {
    const order = withSeed(1234, () => generateRandomTrumpOrder(8));

    assert.equal(order.length, 8);
    for (const trump of order) {
      assert.ok(VALID_KEYS.includes(trump.key), `${trump.key} is not a known trump`);
      assert.ok(trump.name, 'has a display name');
      assert.ok(trump.suit, 'has a suit');
      assert.ok(trump.symbol, 'has a symbol');
      // Random mode must still yield the canonical entry for that key.
      assert.deepEqual(trump, TRUMP_SUITS[trump.key as keyof typeof TRUMP_SUITS]);
    }
  });

  test('varies between games and allows a suit to repeat', () => {
    // Not "equals this exact sequence" - just that it is not a constant.
    const sequences = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      sequences.add(
        withSeed(seed, () => generateRandomTrumpOrder(6))
          .map((t) => t.key)
          .join(',')
      );
    }
    assert.ok(sequences.size > 1, 'random order should differ between games');
  });

  test('draws each round independently, so repeats are possible', () => {
    // Over many seeds at least one sequence must contain a back-to-back repeat;
    // a "shuffle without replacement" implementation could never produce one.
    const sawRepeat = Array.from({ length: 50 }, (_, seed) =>
      withSeed(seed, () => generateRandomTrumpOrder(8))
    ).some((order) => order.some((t, i) => i > 0 && t.key === order[i - 1].key));

    assert.ok(sawRepeat, 'consecutive rounds should sometimes share a trump');
  });
});

describe('generateTrumpOrder dispatch', () => {
  test('routes on the lobby order mode', () => {
    const kachuful = generateTrumpOrder(4, 'Kachuful');
    assert.deepEqual(
      kachuful.map((t) => t.name),
      ['Kari', 'Chukat', 'Falli', 'Lal']
    );

    assert.equal(generateTrumpOrder(5, 'Random').length, 5);
  });

  test('defaults to Kachuful, so a lobby row without orderMode cannot crash', () => {
    assert.deepEqual(generateTrumpOrder(4), generateTrumpOrder(4, 'Kachuful'));
  });

  test('the generated order is a plain snapshot, safe to persist as JSON', () => {
    // The whole sequence is written to the game row once and read back on every
    // reconnect; it must survive a JSON round trip unchanged.
    const order = withSeed(7, () => generateTrumpOrder(6, 'Random'));
    assert.deepEqual(JSON.parse(JSON.stringify(order)), order);
  });
});

describe('trump display helpers', () => {
  test('colours the black and red suits correctly', () => {
    assert.equal(getTrumpColor('Kari'), '#000000', 'spades');
    assert.equal(getTrumpColor('Falli'), '#000000', 'clubs');
    assert.equal(getTrumpColor('Lal'), '#FF0000', 'hearts');
    assert.equal(getTrumpColor('Chukat'), '#FF0000', 'diamonds');
  });

  test('KACHUFUL_TRUMP_ORDER lists every trump exactly once', () => {
    assert.deepEqual([...KACHUFUL_TRUMP_ORDER].sort(), [...VALID_KEYS].sort());
  });
});

describe('hand size per round', () => {
  test('the game deals one more card each round', () => {
    assert.equal(getCardsForRound(1, 8), 1);
    assert.equal(getCardsForRound(2, 8), 2);
    assert.equal(getCardsForRound(8, 8), 8);
  });

  test('calculateSimpleHandSize clamps at the maximum', () => {
    assert.equal(calculateSimpleHandSize(3, 5), 3);
    assert.equal(calculateSimpleHandSize(9, 5), 5);
  });

  test('calculateHandSize ramps up to the midpoint then back down', () => {
    // Unused by the live game (which deals `round` cards) but exported, so it
    // is pinned here to document the shape it promises.
    const sizes = [1, 2, 3, 4, 5, 6].map((r) => calculateHandSize(r, 6, 8));
    assert.deepEqual(sizes, [1, 2, 3, 2, 1, 1]);
  });
});
