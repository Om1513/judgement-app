// Bot decision making.
//
// The point of these tests is that a bot is not privileged: every bid it makes
// must pass the same validator a human bid passes, and every card it plays must
// pass the same follow-suit rule. So rather than asserting "the bot plays the
// king here", they fuzz thousands of seeded situations and assert the bot never
// produces an output the game would reject.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { chooseBotBid, chooseBotCard, getLegalCards } from '../../utils/bot.strategy';
import { canPlayCard, createDeck, shuffleDeck, RANK_VALUES } from '../../utils/cardUtils';
import { canBidValue } from '../../utils/trump';
import { validateBid } from '../../utils/validateLobby';
import { Card } from '../../types/player';
import { withSeed, seededRandom } from '../helpers/random';

const SUITS: Card['suit'][] = ['hearts', 'diamonds', 'clubs', 'spades'];
const card = (suit: Card['suit'], rank: string): Card => ({
  suit,
  rank,
  value: RANK_VALUES[rank],
});

/** A random legal-looking hand of `size` distinct cards. */
function randomHand(rng: () => number, size: number): Card[] {
  const deck = createDeck();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck.slice(0, size);
}

describe('bot bidding', () => {
  test('always bids inside the legal range for the hand', () => {
    for (let seed = 0; seed < 300; seed++) {
      const rng = seededRandom(seed);
      const handSize = 1 + Math.floor(rng() * 8);
      const hand = randomHand(rng, handSize);
      const trump = SUITS[Math.floor(rng() * 4)];

      const bid = withSeed(seed, () => chooseBotBid(hand, trump, handSize, 0, false));

      assert.ok(Number.isInteger(bid), `seed ${seed}: bid ${bid} is not an integer`);
      assert.ok(bid >= 0 && bid <= handSize, `seed ${seed}: bid ${bid} outside 0..${handSize}`);
    }
  });

  test('its bid passes exactly the validator a human bid passes', () => {
    for (let seed = 0; seed < 400; seed++) {
      const rng = seededRandom(seed);
      const handSize = 1 + Math.floor(rng() * 8);
      const hand = randomHand(rng, handSize);
      const trump = SUITS[Math.floor(rng() * 4)];
      const isLastBidder = rng() < 0.5;
      const totalBidsSoFar = Math.floor(rng() * (handSize + 1));

      const bid = withSeed(seed, () =>
        chooseBotBid(hand, trump, handSize, totalBidsSoFar, isLastBidder)
      );

      const viaTrumpRule = canBidValue(bid, handSize, totalBidsSoFar, isLastBidder);
      const viaLobbyRule = validateBid(bid, handSize, totalBidsSoFar, isLastBidder);

      assert.equal(
        viaTrumpRule.valid,
        true,
        `seed ${seed}: bot bid ${bid} rejected - ${viaTrumpRule.reason}`
      );
      assert.equal(viaLobbyRule.valid, true, `seed ${seed}: ${viaLobbyRule.error}`);
    }
  });

  test('as dealer it never lands on the forbidden total', () => {
    for (let seed = 0; seed < 300; seed++) {
      const rng = seededRandom(seed);
      const handSize = 1 + Math.floor(rng() * 8);
      const totalBidsSoFar = Math.floor(rng() * (handSize + 1));
      const hand = randomHand(rng, handSize);
      const trump = SUITS[Math.floor(rng() * 4)];

      const bid = withSeed(seed, () =>
        chooseBotBid(hand, trump, handSize, totalBidsSoFar, true)
      );

      assert.notEqual(
        bid,
        handSize - totalBidsSoFar,
        `seed ${seed}: dealer bot bid the forbidden ${bid}`
      );
    }
  });

  test('bids higher with a hand full of trumps than with a hand of junk', () => {
    const junk = [card('hearts', '2'), card('clubs', '3'), card('diamonds', '4'), card('hearts', '5')];
    const monster = [card('spades', 'A'), card('spades', 'K'), card('spades', 'Q'), card('spades', 'J')];

    // Averaged over seeds, because the bid carries a deliberate +-1 jitter.
    const average = (hand: Card[]) =>
      Array.from({ length: 60 }, (_, seed) =>
        withSeed(seed, () => chooseBotBid(hand, 'spades', 4, 0, false))
      ).reduce((a, b) => a + b, 0) / 60;

    assert.ok(
      average(monster) > average(junk),
      'a hand of high trumps should bid higher than a hand of low off-suit cards'
    );
  });
});

describe('bot card play', () => {
  test('only ever plays a card it actually holds', () => {
    for (let seed = 0; seed < 300; seed++) {
      const rng = seededRandom(seed);
      const hand = randomHand(rng, 1 + Math.floor(rng() * 8));
      const trump = SUITS[Math.floor(rng() * 4)];
      const leadSuit = rng() < 0.3 ? null : SUITS[Math.floor(rng() * 4)];
      const cardsPlayed = leadSuit
        ? [{ playerId: 'other', card: card(leadSuit, 'K') }]
        : [];

      const chosen = withSeed(seed, () =>
        chooseBotCard(hand, leadSuit, trump, 1, 0, cardsPlayed)
      );

      assert.ok(
        hand.some((c) => c.suit === chosen.suit && c.rank === chosen.rank),
        `seed ${seed}: bot played ${chosen.rank} of ${chosen.suit}, which it does not hold`
      );
    }
  });

  test('always follows suit when it can - the same rule humans get', () => {
    for (let seed = 0; seed < 400; seed++) {
      const rng = seededRandom(seed);
      const hand = randomHand(rng, 1 + Math.floor(rng() * 8));
      const trump = SUITS[Math.floor(rng() * 4)];
      const leadSuit = SUITS[Math.floor(rng() * 4)];
      const bid = Math.floor(rng() * (hand.length + 1));
      const tricksMade = Math.floor(rng() * (bid + 1));

      const chosen = withSeed(seed, () =>
        chooseBotCard(hand, leadSuit, trump, bid, tricksMade, [
          { playerId: 'other', card: card(leadSuit, '9') },
        ])
      );

      assert.equal(
        canPlayCard(chosen, hand, leadSuit),
        true,
        `seed ${seed}: bot played an illegal ${chosen.rank} of ${chosen.suit} (lead ${leadSuit})`
      );
    }
  });

  test('cannot see other hands - only its own hand and the public trick', () => {
    // Same hand, same visible trick, but the rest of the deck differs. A bot
    // that peeked at anything else could not be deterministic here.
    const hand = [card('hearts', '3'), card('hearts', 'Q'), card('spades', '8')];
    const trick = [{ playerId: 'p1', card: card('hearts', '9') }];

    const first = chooseBotCard(hand, 'hearts', 'spades', 1, 0, trick);
    // Shuffle the rest of the world between calls.
    withSeed(5, () => shuffleDeck(createDeck()));
    const second = chooseBotCard(hand, 'hearts', 'spades', 1, 0, trick);

    assert.deepEqual(first, second);
  });

  test('plays its only legal card without deliberating', () => {
    const hand = [card('hearts', '2'), card('spades', 'A')];
    const chosen = chooseBotCard(hand, 'hearts', 'spades', 1, 0, [
      { playerId: 'p1', card: card('hearts', 'K') },
    ]);
    assert.deepEqual(chosen, card('hearts', '2'));
  });

  test('tries to take the trick while it is still short of its bid', () => {
    // Needs one more trick; holds a winner and a loser in the lead suit.
    const hand = [card('hearts', '2'), card('hearts', 'A')];
    const chosen = chooseBotCard(hand, 'hearts', 'spades', 1, 0, [
      { playerId: 'p1', card: card('hearts', 'K') },
    ]);
    assert.equal(chosen.rank, 'A', 'should take the trick it still needs');
  });

  test('ducks once it has already made its bid', () => {
    // Bid met: the bot should shed the highest card that cannot win.
    const hand = [card('hearts', '2'), card('hearts', 'Q')];
    const chosen = chooseBotCard(hand, 'hearts', 'spades', 1, 1, [
      { playerId: 'p1', card: card('hearts', 'K') },
    ]);
    assert.equal(chosen.rank, 'Q', 'Q loses to the K, so it is the safe discard');
  });

  test('leads its lowest card when it wants no more tricks', () => {
    const hand = [card('hearts', '4'), card('clubs', 'A'), card('spades', 'K')];
    const chosen = chooseBotCard(hand, null, 'spades', 0, 0, []);
    assert.equal(chosen.rank, '4');
  });

  test('always returns a legal lead when leading', () => {
    for (let seed = 0; seed < 200; seed++) {
      const rng = seededRandom(seed);
      const hand = randomHand(rng, 1 + Math.floor(rng() * 8));
      const trump = SUITS[Math.floor(rng() * 4)];
      const chosen = withSeed(seed, () => chooseBotCard(hand, null, trump, 2, 0, []));
      assert.equal(canPlayCard(chosen, hand, null), true, `seed ${seed}`);
    }
  });
});

describe('getLegalCards', () => {
  test('returns the whole hand when leading', () => {
    const hand = [card('hearts', '2'), card('spades', 'A')];
    assert.deepEqual(getLegalCards(hand, null), hand);
  });

  test('narrows to the lead suit when the bot holds it', () => {
    const hand = [card('hearts', '2'), card('hearts', 'K'), card('spades', 'A')];
    assert.deepEqual(getLegalCards(hand, 'hearts'), [card('hearts', '2'), card('hearts', 'K')]);
  });

  test('opens back up to the whole hand when void', () => {
    const hand = [card('clubs', '2'), card('spades', 'A')];
    assert.deepEqual(getLegalCards(hand, 'hearts'), hand);
  });

  test('never returns an empty set for a non-empty hand', () => {
    for (let seed = 0; seed < 100; seed++) {
      const rng = seededRandom(seed);
      const hand = randomHand(rng, 1 + Math.floor(rng() * 8));
      for (const lead of [null, ...SUITS]) {
        assert.ok(getLegalCards(hand, lead).length > 0, `seed ${seed} lead ${lead}`);
      }
    }
  });
});
