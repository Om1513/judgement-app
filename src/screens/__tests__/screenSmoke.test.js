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
import { Dimensions, Keyboard, StyleSheet } from "react-native";
import { act, fireEvent, render, within } from "@testing-library/react-native";

import HomeScreen from "../HomeScreen";
import HowToPlayScreen from "../HowToPlayScreen";
import GameTableScreen from "../GameTableScreen";
import BiddingScreen from "../BiddingScreen";
import LobbyScreen from "../LobbyScreen";
import JoinGameScreen from "../JoinGameScreen";
import ScoreBoardScreen from "../ScoreBoardScreen";
import FinalWinnerScreen from "../FinalWinnerScreen";
import socketService from "../../services/socket";

jest.mock("../../services/socket", () => ({
  __esModule: true,
  default: {
    on: jest.fn(() => jest.fn()),
    onSession: jest.fn(() => jest.fn()),
    playCard: jest.fn(),
    submitBid: jest.fn(),
    leaveLobby: jest.fn(),
    getScoreboardState: jest.fn(),
    scoreboardContinue: jest.fn(),
    startGame: jest.fn(),
    addBot: jest.fn(),
    kickPlayer: jest.fn(),
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

  // Every lobby size, because the player grid chunks into rows of four: 5 is
  // the first size that wraps, 8 the first that fills two rows exactly.
  it.each([1, 2, 3, 4, 5, 6, 7, 8])("renders a lobby of %i", (count) => {
    expect(() =>
      mounts(
        <LobbyScreen
          navigation={navigation}
          route={{
            params: {
              lobbyCode: "ABC123",
              hostId: "p0",
              currentPlayerId: "p0",
              currentPlayerName: "P0",
              gameSettings: { maxPlayers: 8 },
              initialPlayers: Array.from({ length: count }, (_, i) => ({
                playerId: `p${i}`,
                name: i === 1 ? "Bartholomew Winterbottom" : `P${i}`,
                isHost: i === 0,
                isBot: i > 2,
                joinedAt: "2026-01-01T00:00:00.000Z",
              })),
            },
          }}
        />
      )
    ).not.toThrow();
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

// On our turn the cards we may play pop up out of the hand, and one tap plays
// one. The hand's own behaviour is covered alongside it; this is the wiring -
// the follow-suit rule picks the cards, and the tap reaches the server.
describe("playing a card from the table", () => {
  const renderTable = () =>
    render(
      <GameTableScreen
        navigation={navigation}
        route={{
          params: {
            // Spades were led; this hand holds the 2 and 6 of spades.
            gameState: gameState(3, { cardsPlayed: 1 }),
            currentPlayerId: "p0",
            currentPlayerName: "P0",
          },
        }}
      />
    );

  // A hand card can be tapped only while it is popped up and playable.
  const tappable = (utils, key) =>
    utils.getByTestId(`hand-card-${key}`).props.accessibilityState?.disabled !== true;

  it("offers only the cards that follow suit", () => {
    const utils = renderTable();
    expect(tappable(utils, "spades-2")).toBe(true);
    expect(tappable(utils, "spades-6")).toBe(true);
    expect(tappable(utils, "hearts-3")).toBe(false);
    utils.unmount();
  });

  it("keeps the cards down while a finished trick is still on the table", () => {
    // We won the trick, so the server already names us to lead - but the
    // winner popup has not run yet, so we cannot play.
    const state = gameState(3, { cardsPlayed: 3 });
    state.roundState.currentTrick.winnerId = "p0";
    const utils = render(
      <GameTableScreen
        navigation={navigation}
        route={{ params: { gameState: state, currentPlayerId: "p0", currentPlayerName: "P0" } }}
      />
    );
    expect(tappable(utils, "spades-2")).toBe(false);
    utils.unmount();
  });

  it("sends the tapped card with one tap, the moment it is tapped", () => {
    const utils = renderTable();
    act(() => jest.advanceTimersByTime(1000));

    fireEvent.press(utils.getByTestId("hand-card-spades-6"));

    expect(socketService.playCard).toHaveBeenCalledTimes(1);
    expect(socketService.playCard).toHaveBeenCalledWith({ suit: "spades", rank: "6" });

    // Landing does not send it again, and nothing else can be played meanwhile.
    act(() => jest.advanceTimersByTime(1000));
    expect(socketService.playCard).toHaveBeenCalledTimes(1);
    expect(tappable(utils, "spades-2")).toBe(false);
    utils.unmount();
  });

  it("pops the cards back up if the server rejects a play that has already landed", () => {
    const utils = renderTable();
    act(() => jest.advanceTimersByTime(1000));

    fireEvent.press(utils.getByTestId("hand-card-spades-6"));
    act(() => jest.advanceTimersByTime(1000));
    // Landed and handed to the table: nothing is popped up any more.
    expect(tappable(utils, "spades-2")).toBe(false);

    const onError = socketService.on.mock.calls.find(([event]) => event === "game:error")[1];
    act(() => onError({ message: "Not your turn" }));
    act(() => jest.advanceTimersByTime(1000));

    expect(tappable(utils, "spades-2")).toBe(true);
    expect(tappable(utils, "spades-6")).toBe(true);
    utils.unmount();
  });
});

// A bid shows the moment it is tapped, as if accepted; the server's update
// replaces it.
describe("placing a bid", () => {
  const myTurnToBid = {
    status: "BIDDING",
    totalRounds: 4,
    myHand: [{ suit: "spades", rank: "5" }],
    players: [
      { id: "p0", name: "Asha", hasBid: false, bid: null, isHost: true },
      { id: "p1", name: "Bilal", hasBid: false, bid: null },
      { id: "p2", name: "Chen", hasBid: false, bid: null },
    ],
    roundState: {
      roundNumber: 1,
      cardsPerPlayer: 3,
      currentBidderId: "p0",
      bidOrder: ["p0", "p1", "p2"],
      totalBidsSoFar: 0,
      trump: { suit: "hearts", symbol: "♥", name: "Hearts" },
    },
  };

  it("shows the bid and passes the turn on at once", () => {
    const { getByText, queryByText, getAllByTestId, unmount } = render(
      <BiddingScreen
        navigation={navigation}
        route={{ params: { gameState: myTurnToBid, currentPlayerId: "p0" } }}
      />
    );

    fireEvent.press(getByText("2"));

    expect(socketService.submitBid).toHaveBeenCalledWith(2);
    // The buttons are gone and the table names the next bidder...
    expect(queryByText("3")).toBeNull();
    expect(getByText(/Waiting for/)).toBeTruthy();
    // ...and our cell holds the bid.
    const [myCell] = getAllByTestId("bid-cell");
    expect(within(myCell).getByText("2")).toBeTruthy();
    unmount();
  });

  it("takes the bid back if the server rejects it", () => {
    const { getByText, unmount } = render(
      <BiddingScreen
        navigation={navigation}
        route={{ params: { gameState: myTurnToBid, currentPlayerId: "p0" } }}
      />
    );

    fireEvent.press(getByText("2"));
    const onError = socketService.on.mock.calls.find(([event]) => event === "game:error")[1];
    act(() => onError({ message: "Invalid bid" }));

    expect(getByText("3")).toBeTruthy();
    unmount();
  });
});

// A bid landing used to grow the whole bidding panel: the green "bid placed" box
// was ~7pt taller than the amber "..." badge it replaced, which pushed the bid
// row past its minHeight and took the panel with it. The row is now a fixed
// height, so this asserts the thing that actually broke - that every cell in the
// row resolves to the same height no matter which of the three states it holds.
describe("the bidding row does not resize when a bid lands", () => {
  /** One player who has bid, one mid-bid, one still to bid. */
  const mixedBids = {
    status: "BIDDING",
    totalRounds: 4,
    myHand: [{ suit: "spades", rank: "5" }],
    players: [
      { id: "p0", name: "P0", hasBid: true, bid: 2, isHost: true },
      { id: "p1", name: "P1", hasBid: false, bid: null },
      { id: "p2", name: "P2", hasBid: false, bid: null },
    ],
    roundState: {
      roundNumber: 1,
      cardsPerPlayer: 3,
      currentBidderId: "p1",
      trump: { suit: "hearts", symbol: "♥", name: "Hearts" },
    },
  };

  it("gives every bid cell the same fixed height, whatever it contains", () => {
    const { getAllByTestId, unmount } = render(
      <BiddingScreen
        navigation={navigation}
        route={{ params: { gameState: mixedBids, currentPlayerId: "p2" } }}
      />
    );

    const heights = getAllByTestId("bid-cell").map(
      (cell) => StyleSheet.flatten(cell.props.style).height
    );

    expect(heights).toHaveLength(3);
    // Fixed, not merely equal: a minHeight would also come out equal here while
    // still being free to grow on a device with different font metrics.
    for (const height of heights) expect(height).toBe(32);
    unmount();
  });
});

// The lobby-code field is one of only two text inputs in the app, and its
// keyboard used to be dismissable only by submitting - tapping the artwork
// around it left it up, covering the JOIN button underneath.
describe("the join screen dismisses its keyboard on an outside tap", () => {
  it("calls Keyboard.dismiss when the backdrop is pressed", () => {
    const dismiss = jest.spyOn(Keyboard, "dismiss").mockImplementation(() => {});

    const { getByTestId, unmount } = render(
      <JoinGameScreen navigation={navigation} route={{ params: { playerName: "P0" } }} />
    );

    expect(dismiss).not.toHaveBeenCalled();
    fireEvent.press(getByTestId("join-screen"));
    expect(dismiss).toHaveBeenCalled();

    unmount();
    dismiss.mockRestore();
  });
});
