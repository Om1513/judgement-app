// Screens render, at three very different viewports.
//
// Not a snapshot test and not an assertion about pixels - the layout maths is
// covered in src/utils/__tests__. This exists because the responsive migration
// touched every stylesheet in the app, and the failure mode of that kind of
// change is a screen that throws on a path no unit test walks: a component that
// reads `styles` its enclosing function never built, or an inset applied to a
// style that was deleted. Mounting each screen is the cheapest way to catch it.
//
// The game table is the one that matters most: it is the only screen whose
// positions are computed rather than declared, so it is rendered at every table
// size from three to eight players.

import React from "react";
import { Dimensions } from "react-native";
import { render } from "@testing-library/react-native";

import HomeScreen from "../HomeScreen";
import HowToPlayScreen from "../HowToPlayScreen";
import GameTableScreen from "../GameTableScreen";
import BiddingScreen from "../BiddingScreen";
import ScoreBoardScreen from "../ScoreBoardScreen";
import FinalWinnerScreen from "../FinalWinnerScreen";

jest.mock("../../services/socket", () => ({
  __esModule: true,
  default: {
    on: jest.fn(() => jest.fn()),
    playCard: jest.fn(),
    submitBid: jest.fn(),
    leaveLobby: jest.fn(),
    getScoreboardState: jest.fn(),
    scoreboardContinue: jest.fn(),
  },
}));

const VIEWPORTS = {
  smallPhone: { width: 640, height: 360, scale: 2, fontScale: 1 },
  baseline: { width: 874, height: 402, scale: 3, fontScale: 1 },
  tablet: { width: 1024, height: 768, scale: 2, fontScale: 1 },
};

const navigation = {
  navigate: jest.fn(),
  replace: jest.fn(),
  goBack: jest.fn(),
  addListener: jest.fn(() => jest.fn()),
};

const setViewport = (v) => Dimensions.set({ window: v, screen: v });

// Several screens start a looping entrance/glow animation on mount and never
// stop it. Under real timers that loop outlives the test and tears the runner
// down mid-frame, so time is frozen and each tree is unmounted immediately -
// mounting is the whole point here, not animating.
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  setViewport(VIEWPORTS.baseline);
});

/** Mounts, then unmounts. Throws if the render throws. */
function mounts(element) {
  const tree = render(element);
  tree.unmount();
}

/** A game in progress, with `count` players and a trick partly played. */
function gameState(count, { cardsPlayed = 2, handSize = 8 } = {}) {
  const players = Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    // A deliberately long name on one seat: names must not push a seat around.
    name: i === 1 ? "Bartholomew Winterbottom" : `P${i}`,
    bid: i % 3,
    tricksWon: i % 2,
    hasBid: true,
    isHost: i === 0,
  }));

  return {
    status: "PLAYING",
    players,
    isMyTurn: true,
    currentTurnPlayerId: "p0",
    totalRounds: 8,
    myHand: Array.from({ length: handSize }, (_, i) => ({
      suit: ["spades", "hearts", "diamonds", "clubs"][i % 4],
      rank: String(2 + i),
    })),
    roundState: {
      roundNumber: 8,
      cardsPerPlayer: handSize,
      trump: { suit: "hearts", symbol: "♥", name: "Hearts" },
      currentBidderId: "p0",
      currentTrick: {
        leadSuit: "spades",
        cardsPlayed: players.slice(0, cardsPlayed).map((p, i) => ({
          playerId: p.id,
          card: { suit: "spades", rank: String(5 + i) },
        })),
      },
    },
  };
}

function scoreboard(count) {
  const players = Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${i}`,
    totalScore: i * 10,
    hasContinued: false,
  }));
  return {
    players,
    currentRound: 3,
    rows: Array.from({ length: 8 }, (_, round) => ({
      roundNumber: round + 1,
      trump: { suit: "spades", name: "Spades" },
      scores: players.map((p) => ({ playerId: p.id, bid: 1, handsMade: 1, score: 10 })),
    })),
  };
}

describe.each(Object.entries(VIEWPORTS))("on %s", (_name, viewport) => {
  beforeEach(() => setViewport(viewport));

  it("renders the home screen", () => {
    expect(() => mounts(<HomeScreen navigation={navigation} />)).not.toThrow();
  });

  it("renders how to play", () => {
    expect(() => mounts(<HowToPlayScreen navigation={navigation} />)).not.toThrow();
  });

  it("renders the bidding screen with a full table", () => {
    expect(() =>
      mounts(
        <BiddingScreen
          navigation={navigation}
          route={{ params: { gameState: gameState(8), currentPlayerId: "p0" } }}
        />
      )
    ).not.toThrow();
  });

  it("renders the scoreboard with a full table and a long game", () => {
    expect(() =>
      mounts(
        <ScoreBoardScreen
          navigation={navigation}
          route={{ params: { scoreboard: scoreboard(8), currentPlayerId: "p0" } }}
        />
      )
    ).not.toThrow();
  });

  it("renders the winner screen", () => {
    expect(() =>
      mounts(
        <FinalWinnerScreen
          navigation={navigation}
          route={{
            params: { winners: [{ id: "p0", name: "Player 0" }], winningScore: 80 },
          }}
        />
      )
    ).not.toThrow();
  });

  // Every table size, because the seat and card positions are computed per
  // player count and only the four-player table is the common path.
  it.each([3, 4, 5, 6, 7, 8])("renders the game table with %i players", (count) => {
    expect(() =>
      mounts(
        <GameTableScreen
          navigation={navigation}
          route={{
            params: {
              gameState: gameState(count),
              currentPlayerId: "p0",
              currentPlayerName: "P0",
            },
          }}
        />
      )
    ).not.toThrow();
  });
});
