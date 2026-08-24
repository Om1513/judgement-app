// The persisted session pointer.
//
// Small surface, but it is the only client state a cold start has to work from,
// so the failure modes that matter are the ugly ones: a half-written record, a
// record from an older build, storage that throws. None of them may wedge a
// launch, and none of them may resurrect a session that was deliberately ended.

import AsyncStorage from "@react-native-async-storage/async-storage";

import { SESSION_KEY, clearSession, loadSession, saveSession } from "../session";

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("saving and loading", () => {
  test("a saved session comes back intact", async () => {
    await saveSession({
      playerId: "p-om",
      playerName: "Om",
      lobbyCode: "ABC123",
      lobbyId: "lobby-1",
    });

    expect(await loadSession()).toEqual({
      playerId: "p-om",
      playerName: "Om",
      lobbyCode: "ABC123",
      lobbyId: "lobby-1",
    });
  });

  test("nothing saved means no session", async () => {
    expect(await loadSession()).toBeNull();
  });

  test("saving again replaces the previous lobby rather than merging", async () => {
    await saveSession({ playerId: "p-om", playerName: "Om", lobbyCode: "AAA111", lobbyId: "l1" });
    await saveSession({ playerId: "p-om", playerName: "Om", lobbyCode: "BBB222", lobbyId: "l2" });

    const loaded = await loadSession();
    expect(loaded.lobbyCode).toBe("BBB222");
    expect(loaded.lobbyId).toBe("l2");
  });

  test("a record with no player id is not worth storing", async () => {
    await saveSession({ playerName: "Om", lobbyCode: "ABC123" });
    expect(await loadSession()).toBeNull();
  });

  test("missing optional fields normalise rather than coming back undefined", async () => {
    await saveSession({ playerId: "p-om" });

    expect(await loadSession()).toEqual({
      playerId: "p-om",
      playerName: "",
      lobbyCode: null,
      lobbyId: null,
    });
  });
});

describe("clearing", () => {
  test("a cleared session is gone", async () => {
    await saveSession({ playerId: "p-om", lobbyCode: "ABC123" });
    await clearSession();

    expect(await loadSession()).toBeNull();
  });

  test("clearing when there is nothing saved is harmless", async () => {
    await expect(clearSession()).resolves.toBeUndefined();
  });
});

describe("bad data cannot wedge a launch", () => {
  test("unparseable JSON reads as no session, and is thrown away", async () => {
    await AsyncStorage.setItem(SESSION_KEY, "{not json");

    expect(await loadSession()).toBeNull();
    // Discarded, so the next launch does not walk into the same record again.
    expect(await AsyncStorage.getItem(SESSION_KEY)).toBeNull();
  });

  test("a record of the wrong shape reads as no session", async () => {
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify({ lobbyCode: "ABC123" }));

    expect(await loadSession()).toBeNull();
  });

  test("storage failures are reported as no session, not thrown", async () => {
    const spy = jest
      .spyOn(AsyncStorage, "getItem")
      .mockRejectedValueOnce(new Error("storage unavailable"));

    expect(await loadSession()).toBeNull();
    spy.mockRestore();
  });

  test("a failed write does not throw at the caller", async () => {
    const spy = jest
      .spyOn(AsyncStorage, "setItem")
      .mockRejectedValueOnce(new Error("disk full"));

    expect(await saveSession({ playerId: "p-om" })).toBeNull();
    spy.mockRestore();
  });
});
