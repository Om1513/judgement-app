// Follow-suit legality.
//
// The rule the whole game hangs on: if you hold the lead suit you must play it.
// Trump does not excuse you - you may only trump when you are void.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { canPlayCard, RANK_VALUES } from '../../utils/cardUtils';
import { getLegalCards } from '../../utils/bot.strategy';
import { Card } from '../../types/player';

const card = (suit: Card['suit'], rank: string): Card => ({
  suit,
  rank,
  value: RANK_VALUES[rank],
});

const HEARTS_HAND = [card('hearts', '4'), card('hearts', 'K'), card('spades', 'A'), card('clubs', '2')];
const VOID_IN_HEARTS = [card('spades', '3'), card('spades', 'K'), card('clubs', '9'), card('diamonds', 'Q')];

describe('leading a trick', () => {
  test('any card in hand may be led', () => {
    for (const c of HEARTS_HAND) {
      assert.equal(canPlayCard(c, HEARTS_HAND, null), true, `${c.rank} of ${c.suit}`);
    }
  });

  test('a card that is not in hand may not be led', () => {
    assert.equal(canPlayCard(card('diamonds', 'A'), HEARTS_HAND, null), false);
  });
});

describe('following when holding the lead suit', () => {
  const leadSuit: Card['suit'] = 'hearts';

  test('only the lead suit is legal', () => {
    assert.equal(canPlayCard(card('hearts', '4'), HEARTS_HAND, leadSuit), true);
    assert.equal(canPlayCard(card('hearts', 'K'), HEARTS_HAND, leadSuit), true);
  });

  test('an off-suit discard is rejected', () => {
    assert.equal(canPlayCard(card('clubs', '2'), HEARTS_HAND, leadSuit), false);
    assert.equal(canPlayCard(card('diamonds', '7'), HEARTS_HAND, leadSuit), false);
  });

  test('trump does NOT override the follow-suit requirement', () => {
    // Spades is trump for round 1, and the player is holding the ace of it -
    // they still may not play it while they hold a heart.
    assert.equal(canPlayCard(card('spades', 'A'), HEARTS_HAND, leadSuit), false);
  });

  test('holding a single card of the lead suit still forces it', () => {
    const hand = [card('hearts', '2'), card('spades', 'A'), card('spades', 'K')];
    assert.equal(canPlayCard(card('hearts', '2'), hand, 'hearts'), true);
    assert.equal(canPlayCard(card('spades', 'A'), hand, 'hearts'), false);
  });
});

describe('following when void in the lead suit', () => {
  const leadSuit: Card['suit'] = 'hearts';

  test('any card in hand becomes legal - discard or trump', () => {
    for (const c of VOID_IN_HEARTS) {
      assert.equal(canPlayCard(c, VOID_IN_HEARTS, leadSuit), true, `${c.rank} of ${c.suit}`);
    }
  });

  test('trumping in is allowed once void', () => {
    assert.equal(canPlayCard(card('spades', 'K'), VOID_IN_HEARTS, leadSuit), true);
  });

  test('a card that is not in hand is still rejected', () => {
    assert.equal(canPlayCard(card('hearts', 'A'), VOID_IN_HEARTS, leadSuit), false);
  });
});

describe('getLegalCards (the bot-facing view of the same rule)', () => {
  test('agrees with canPlayCard for every card in every situation', () => {
    const hands = [HEARTS_HAND, VOID_IN_HEARTS];
    const leads: (Card['suit'] | null)[] = [null, 'hearts', 'spades', 'clubs', 'diamonds'];

    for (const hand of hands) {
      for (const lead of leads) {
        const legal = getLegalCards(hand, lead);
        for (const c of hand) {
          const inLegalSet = legal.some((l) => l.suit === c.suit && l.rank === c.rank);
          assert.equal(
            inLegalSet,
            canPlayCard(c, hand, lead),
            `disagreement on ${c.rank} of ${c.suit} with lead ${lead}`
          );
        }
      }
    }
  });

  test('never returns a card the player does not hold', () => {
    for (const lead of [null, 'hearts', 'spades'] as (Card['suit'] | null)[]) {
      for (const c of getLegalCards(HEARTS_HAND, lead)) {
        assert.ok(
          HEARTS_HAND.some((h) => h.suit === c.suit && h.rank === c.rank),
          'legal cards must come from the hand'
        );
      }
    }
  });

  test('returns a copy, so callers cannot mutate the hand through it', () => {
    const legal = getLegalCards(HEARTS_HAND, null);
    legal.pop();
    assert.equal(HEARTS_HAND.length, 4);
  });
});
