// The rules for a game's settings, shared by Create Game and the lobby's
// settings panel so the two can never disagree.
//
// They mirror the server (validateLobbySettings in
// server/src/utils/validateLobby.ts), which has the final say: round N deals N
// cards to everyone, so a full table's last round needs players x rounds cards
// from one 52-card deck.

export const DECK_SIZE = 52;
export const MIN_ROUNDS = 4;
export const MAX_ROUNDS = 8;
// The server accepts 2 for testing; the app has always offered 3 and up.
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;

export const DEFAULT_SETTINGS = {
  maxPlayers: 4,
  rounds: 4,
  orderMode: "Kachuful",
  scoringMode: "+10",
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * What each selector may offer, given the current settings. `minPlayers` is the
 * floor for players - in a lobby, nobody already seated can be pushed out.
 */
export function settingsLimits({ maxPlayers, rounds }, minPlayers = MIN_PLAYERS) {
  const playersFloor = clamp(minPlayers, MIN_PLAYERS, MAX_PLAYERS);
  return {
    minPlayers: playersFloor,
    maxPlayers: Math.max(playersFloor, Math.min(MAX_PLAYERS, Math.floor(DECK_SIZE / rounds))),
    minRounds: MIN_ROUNDS,
    // Never more rounds than the smallest table we may still have can deal.
    maxRounds: Math.min(MAX_ROUNDS, Math.floor(DECK_SIZE / Math.max(maxPlayers, playersFloor))),
  };
}

/** Changes players, pulling rounds down if one deck could no longer deal them. */
export function withPlayers(settings, maxPlayers) {
  const rounds = Math.min(settings.rounds, Math.floor(DECK_SIZE / maxPlayers));
  return { ...settings, maxPlayers, rounds: clamp(rounds, MIN_ROUNDS, MAX_ROUNDS) };
}

/**
 * Changes rounds, pulling players down if one deck could no longer deal them -
 * but never below `minPlayers`.
 */
export function withRounds(settings, rounds, minPlayers = MIN_PLAYERS) {
  const maxPlayers = Math.max(
    minPlayers,
    Math.min(settings.maxPlayers, Math.floor(DECK_SIZE / rounds))
  );
  return { ...settings, rounds, maxPlayers };
}

/** Only the settings that differ, for sending as an update. */
export function changedSettings(before, after) {
  const changes = {};
  for (const key of ["maxPlayers", "rounds", "orderMode", "scoringMode"]) {
    if (after[key] !== before[key]) changes[key] = after[key];
  }
  return changes;
}

/** "4 rounds · Kachuful order · +10 scoring" */
export function describeSettings({ rounds, orderMode, scoringMode }) {
  return `${rounds} rounds · ${orderMode} order · ${scoringMode} scoring`;
}
