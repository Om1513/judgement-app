// Round scoring - the single rule every score in the game comes from.
//
// Kachuful only pays for an exact judgement. Missing the bid in either
// direction scores nothing, however close, so these tests care as much about
// the zeros as about the payouts.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { calculateScore } from '../../utils/cardUtils';

describe('+10 scoring', () => {
  test('pays bid x 10 on an exact judgement', () => {
    assert.equal(calculateScore(0, 0, '+10'), 10, 'a correct zero bid still scores 10');
    assert.equal(calculateScore(1, 1, '+10'), 10);
    assert.equal(calculateScore(2, 2, '+10'), 20);
    assert.equal(calculateScore(3, 3, '+10'), 30);
    assert.equal(calculateScore(4, 4, '+10'), 40);
    assert.equal(calculateScore(8, 8, '+10'), 80);
  });

  test('pays nothing for a missed judgement, over or under', () => {
    assert.equal(calculateScore(2, 1, '+10'), 0, 'under the bid');
    assert.equal(calculateScore(2, 3, '+10'), 0, 'over the bid');
    assert.equal(calculateScore(0, 1, '+10'), 0, 'a broken zero bid');
    assert.equal(calculateScore(4, 0, '+10'), 0, 'nowhere near');
  });
});

describe('+1 scoring', () => {
  test('pays a flat 10 plus the bid on an exact judgement', () => {
    assert.equal(calculateScore(0, 0, '+1'), 11, 'a correct zero bid pays as much as a correct one');
    assert.equal(calculateScore(1, 1, '+1'), 11);
    assert.equal(calculateScore(2, 2, '+1'), 12);
    assert.equal(calculateScore(3, 3, '+1'), 13);
    assert.equal(calculateScore(4, 4, '+1'), 14);
    assert.equal(calculateScore(8, 8, '+1'), 18);
  });

  test('pays nothing for a missed judgement, over or under', () => {
    assert.equal(calculateScore(2, 1, '+1'), 0);
    assert.equal(calculateScore(2, 3, '+1'), 0);
    assert.equal(calculateScore(3, 2, '+1'), 0);
    assert.equal(calculateScore(0, 2, '+1'), 0);
  });

  test('values a correct zero bid exactly as a correct bid of one, in both modes', () => {
    // Taking no hands on purpose is as hard as taking one, so it is not scored
    // as if nothing had been bid. This is the invariant that ties the two modes
    // together; '+10' always held it and '+1' used to pay 10 here instead of 11.
    for (const mode of ['+10', '+1'] as const) {
      assert.equal(calculateScore(0, 0, mode), calculateScore(1, 1, mode), mode);
    }
  });
});

describe('the two modes side by side', () => {
  test('treat a zero bid the same way and diverge as the bid grows', () => {
    // Not "agree on zero bids" - they no longer pay the same for one. What they
    // share is the RULE: a correct zero bid is worth a correct bid of one, which
    // is 10 under '+10' and 11 under '+1'.
    assert.equal(calculateScore(0, 0, '+10'), 10);
    assert.equal(calculateScore(0, 0, '+1'), 11);
    assert.equal(calculateScore(1, 1, '+10'), 10);
    assert.equal(calculateScore(1, 1, '+1'), 11);
    // A big bid is worth far more under +10; that is the whole point of the mode.
    assert.ok(calculateScore(3, 3, '+10') > calculateScore(3, 3, '+1'));
    assert.ok(calculateScore(8, 8, '+10') > calculateScore(8, 8, '+1'));
  });

  test('both refuse an unknown mode rather than inventing a score', () => {
    assert.throws(
      () => calculateScore(1, 1, 'x2' as unknown as '+10'),
      /Unknown scoring mode/
    );
  });
});
