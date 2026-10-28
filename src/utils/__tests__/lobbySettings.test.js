import {
  changedSettings,
  describeSettings,
  settingsLimits,
  withPlayers,
  withRounds,
} from "../lobbySettings";

const base = { maxPlayers: 4, rounds: 4, orderMode: "Kachuful", scoringMode: "+10" };

describe("settingsLimits", () => {
  it("offers what one deck can deal", () => {
    // 52 cards: six players can play eight rounds, eight players only six.
    expect(settingsLimits({ maxPlayers: 6, rounds: 4 }).maxRounds).toBe(8);
    expect(settingsLimits({ maxPlayers: 8, rounds: 4 }).maxRounds).toBe(6);
    expect(settingsLimits({ maxPlayers: 4, rounds: 8 }).maxPlayers).toBe(6);
    expect(settingsLimits({ maxPlayers: 4, rounds: 4 }).maxPlayers).toBe(8);
  });

  it("never offers fewer players than are already seated", () => {
    expect(settingsLimits(base, 5).minPlayers).toBe(5);
    // The app's floor of three holds even for a smaller lobby.
    expect(settingsLimits(base, 2).minPlayers).toBe(3);
  });

  it("caps rounds by the seated players, not just the chosen maximum", () => {
    // Seven seated: whatever maxPlayers says, at most seven rounds fit.
    expect(settingsLimits({ maxPlayers: 4, rounds: 4 }, 7).maxRounds).toBe(7);
  });
});

describe("withPlayers / withRounds", () => {
  it("pulls rounds down when more players would not fit", () => {
    expect(withPlayers({ ...base, rounds: 8 }, 8)).toMatchObject({ maxPlayers: 8, rounds: 6 });
  });

  it("pulls players down when more rounds would not fit", () => {
    expect(withRounds({ ...base, maxPlayers: 8 }, 8)).toMatchObject({ maxPlayers: 6, rounds: 8 });
  });

  it("never pulls players below who is seated", () => {
    expect(withRounds({ ...base, maxPlayers: 8 }, 8, 7).maxPlayers).toBe(7);
  });

  it("leaves the other settings alone", () => {
    const next = withPlayers({ ...base, orderMode: "Random", scoringMode: "+1" }, 5);
    expect(next).toMatchObject({ orderMode: "Random", scoringMode: "+1" });
  });
});

describe("changedSettings", () => {
  it("lists only what differs", () => {
    expect(changedSettings(base, { ...base, scoringMode: "+1" })).toEqual({ scoringMode: "+1" });
    expect(changedSettings(base, base)).toEqual({});
  });
});

describe("describeSettings", () => {
  it("reads as one line", () => {
    expect(describeSettings(base)).toBe("4 rounds · Kachuful order · +10 scoring");
  });
});
