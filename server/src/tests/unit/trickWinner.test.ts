// Who takes the trick.
//
// Precedence: highest trump, else highest card of the lead suit. A card that is
// neither trump nor lead suit can never win, no matter how high it is.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { determineTrickWinner, RANK_VALUES, RANKS } from '../../utils/cardUtils';
import { Card } from '../../types/player';

const card = (suit: Card['suit'], rank: string): Card => ({
  suit,
  rank,
  value: RANK_VALUES[rank],
});

/** `p1: 10 of hearts` style shorthand for a trick. */
const play = (playerId: string, suit: Card['suit'], rank: string) => ({
  playerId,
  card: card(suit, rank),
});

describe('no trump in the trick', () => {
  test('the highest card of the lead suit wins', () => {
    const winner = determineTrickWinner(
      [
        play('p1', 'hearts', '10'),
        play('p2', 'hearts', 'K'),
        play('p3', 'clubs', 'A'),
        play('p4', 'hearts', '4'),
      ],
      'hearts',
      null
    );

    assert.equal(winner, 'p2', 'K of hearts beats 10 and 4; the ace of clubs is off-suit');
  });

  test('an off-suit ace loses to the lowest card of the lead suit', () => {
    const winner = determineTrickWinner(
      [play('p1', 'hearts', '2'), play('p2', 'clubs', 'A'), play('p3', 'diamonds', 'A')],
      'hearts',
      null
    );

    assert.equal(winner, 'p1');
  });

  test('the leader wins when nobody follows suit', () => {
    const winner = determineTrickWinner(
      [play('p1', 'hearts', '2'), play('p2', 'clubs', 'K'), play('p3', 'diamonds', 'A')],
      'hearts',
      null
    );

    assert.equal(winner, 'p1');
  });
});

describe('trump in the trick', () => {
  test('a low trump beats the ace of the lead suit', () => {
    const winner = determineTrickWinner(
      [play('p1', 'hearts', 'A'), play('p2', 'hearts', '2'), play('p3', 'spades', '3')],
      'hearts',
      'spades'
    );

    assert.equal(winner, 'p3', '3 of spades trumps the ace of hearts');
  });

  test('the highest trump wins when several are played', () => {
    const winner = determineTrickWinner(
      [
        play('p1', 'hearts', 'A'),
        play('p2', 'spades', '3'),
        play('p3', 'spades', 'K'),
        play('p4', 'spades', '7'),
      ],
      'hearts',
      'spades'
    );

    assert.equal(winner, 'p3');
  });

  test('a non-trump can never take a trick that has been trumped', () => {
    const winner = determineTrickWinner(
      [play('p1', 'spades', '2'), play('p2', 'hearts', 'A'), play('p3', 'hearts', 'K')],
      'spades',
      'spades'
    );

    assert.equal(winner, 'p1', 'the lone trump wins even as the lowest card played');
  });

  test('with trump set but none played, the lead suit still decides', () => {
    const winner = determineTrickWinner(
      [play('p1', 'hearts', '10'), play('p2', 'hearts', 'K'), play('p3', 'clubs', 'A')],
      'hearts',
      'spades'
    );

    assert.equal(winner, 'p2');
  });

  test('trumping is only reachable by being void, so an off-suit non-trump still loses', () => {
    const winner = determineTrickWinner(
      [play('p1', 'hearts', '5'), play('p2', 'diamonds', 'A'), play('p3', 'clubs', 'A')],
      'hearts',
      'spades'
    );

    assert.equal(winner, 'p1');
  });
});

describe('card ranking', () => {
  test('runs 2 < 3 < ... < 10 < J < Q < K < A', () => {
    const values = RANKS.map((r) => RANK_VALUES[r]);
    assert.deepEqual(values, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);

    for (let i = 1; i < values.length; i++) {
      assert.ok(values[i] > values[i - 1], `${RANKS[i]} must beat ${RANKS[i - 1]}`);
    }
  });

  test('every adjacent pair of ranks resolves in favour of the higher one', () => {
    for (let i = 1; i < RANKS.length; i++) {
      const winner = determineTrickWinner(
        [play('low', 'hearts', RANKS[i - 1]), play('high', 'hearts', RANKS[i])],
        'hearts',
        'spades'
      );
      assert.equal(winner, 'high', `${RANKS[i]} should beat ${RANKS[i - 1]}`);
    }
  });

  test('the same ranking applies among trumps', () => {
    for (let i = 1; i < RANKS.length; i++) {
      const winner = determineTrickWinner(
        [play('low', 'spades', RANKS[i - 1]), play('high', 'spades', RANKS[i])],
        'spades',
        'spades'
      );
      assert.equal(winner, 'high');
    }
  });
});

describe('degenerate input', () => {
  test('a later card of the lead suit overtakes an off-suit card in front of it', () => {
    // Defensive: in a real trick the leader defines the lead suit, so the first
    // card is always of it. If a caller ever passes a mismatched lead suit, the
    // rule must still prefer the card that actually follows it.
    const winner = determineTrickWinner(
      [play('p1', 'clubs', 'A'), play('p2', 'hearts', '2')],
      'hearts',
      'spades'
    );

    assert.equal(winner, 'p2');
  });

  test('an empty trick has no winner and says so', () => {
    assert.throws(() => determineTrickWinner([], 'hearts', 'spades'), /No cards played/);
  });

  test('a single card wins by default', () => {
    assert.equal(
      determineTrickWinner([play('p1', 'clubs', '2')], 'clubs', 'spades'),
      'p1'
    );
  });

  test('play order does not change the outcome', () => {
    const plays = [
      play('p1', 'hearts', '10'),
      play('p2', 'spades', '3'),
      play('p3', 'hearts', 'A'),
      play('p4', 'spades', 'K'),
    ];

    // Rotating who leads changes the lead suit, so instead re-order the
    // followers behind a fixed leader.
    const [leader, ...followers] = plays;
    const orderings = [
      [leader, followers[0], followers[1], followers[2]],
      [leader, followers[2], followers[1], followers[0]],
      [leader, followers[1], followers[2], followers[0]],
    ];

    for (const ordering of orderings) {
      assert.equal(determineTrickWinner(ordering, 'hearts', 'spades'), 'p4');
    }
  });
});
