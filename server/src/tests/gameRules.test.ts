// Rules tests for the two configurable lobby settings: scoring mode and trump
// order. Uses the Node built-in test runner (node --test) so the server keeps
// its zero-test-dependency footprint.
//
// Run with:  npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateScore } from '../utils/cardUtils';
import {
  generateTrumpOrder,
  generateKachufulTrumpOrder,
  generateRandomTrumpOrder,
  KACHUFUL_TRUMP_ORDER,
} from '../utils/trump';

test('+10 scoring multiplies the bid, and only pays on an exact judgement', () => {
  assert.equal(calculateScore(0, 0, '+10'), 10, 'a correct zero bid still scores');
  assert.equal(calculateScore(1, 1, '+10'), 10);
  assert.equal(calculateScore(2, 2, '+10'), 20);
  assert.equal(calculateScore(3, 3, '+10'), 30);
  assert.equal(calculateScore(4, 4, '+10'), 40);

  assert.equal(calculateScore(2, 1, '+10'), 0, 'under the bid scores nothing');
  assert.equal(calculateScore(2, 3, '+10'), 0, 'over the bid scores nothing');
  assert.equal(calculateScore(0, 1, '+10'), 0, 'a broken zero bid scores nothing');
});

test('+1 scoring adds the bid to a flat 10, and only pays on an exact judgement', () => {
  assert.equal(calculateScore(0, 0, '+1'), 10, 'a correct zero bid still scores');
  assert.equal(calculateScore(1, 1, '+1'), 11);
  assert.equal(calculateScore(2, 2, '+1'), 12);
  assert.equal(calculateScore(3, 3, '+1'), 13);
  assert.equal(calculateScore(4, 4, '+1'), 14);

  assert.equal(calculateScore(2, 1, '+1'), 0);
  assert.equal(calculateScore(2, 3, '+1'), 0);
  assert.equal(calculateScore(3, 2, '+1'), 0);
});

test('the two modes agree on zero bids and diverge as the bid grows', () => {
  assert.equal(calculateScore(0, 0, '+10'), calculateScore(0, 0, '+1'));
  assert.equal(calculateScore(1, 1, '+10'), 10);
  assert.equal(calculateScore(1, 1, '+1'), 11);
  assert.ok(calculateScore(3, 3, '+10') > calculateScore(3, 3, '+1'));
});

test('Kachuful trump follows Kari, Chukat, Falli, Lal and repeats', () => {
  const order = generateTrumpOrder(8, 'Kachuful');

  assert.deepEqual(
    order.map((t) => t.name),
    ['Kari', 'Chukat', 'Falli', 'Lal', 'Kari', 'Chukat', 'Falli', 'Lal']
  );
  assert.deepEqual(
    order.slice(0, 4).map((t) => t.suit),
    ['spades', 'diamonds', 'clubs', 'hearts']
  );
  // Round 5 wraps back to round 1's suit.
  assert.equal(order[4].name, order[0].name);
});

test('Kachuful order is deterministic - two games get identical sequences', () => {
  assert.deepEqual(generateKachufulTrumpOrder(6), generateKachufulTrumpOrder(6));
});

test('Random trump produces one suit per round, all valid', () => {
  const totalRounds = 8;
  const order = generateRandomTrumpOrder(totalRounds);

  assert.equal(order.length, totalRounds);
  for (const trump of order) {
    assert.ok(
      KACHUFUL_TRUMP_ORDER.includes(trump.key as (typeof KACHUFUL_TRUMP_ORDER)[number]),
      `${trump.key} is not a known trump`
    );
    assert.ok(trump.name && trump.suit && trump.symbol, 'trump entry is fully populated');
  }
});

test('Random trump is actually random, and allows repeats', () => {
  // Generating many sequences should produce more than one distinct result.
  // A fixed sequence would collapse this set to a single entry.
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) {
    seen.add(generateRandomTrumpOrder(6).map((t) => t.key).join(','));
  }
  assert.ok(seen.size > 1, 'random order should vary between games');
});

test('generateTrumpOrder dispatches on the lobby order mode', () => {
  const kachuful = generateTrumpOrder(4, 'Kachuful');
  assert.deepEqual(
    kachuful.map((t) => t.name),
    ['Kari', 'Chukat', 'Falli', 'Lal']
  );

  // Random still yields the right shape; its values are covered above.
  assert.equal(generateTrumpOrder(5, 'Random').length, 5);

  // Defaulting matters: an older lobby row without orderMode must not crash.
  assert.deepEqual(generateTrumpOrder(4), kachuful);
});
