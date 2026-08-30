// Cold-start auto-rejoin: one lifecycle, run once at launch.
//
// Warm reconnects already work - the socket comes back, the server pushes
// `session:restore` plus the usual lobby:update / game:update, and whichever
// screen is open updates itself. Nothing here changes that.
//
// What a *cold* start lacks is a screen to update. The process was killed, so
// the app opens on Home with no idea a game is in progress. This module closes
// that gap using the same server mechanism rather than a second one:
//
//   saved pointer  ->  connect  ->  session:restore  ->  one navigation
//
// Three rules shape the whole flow:
//
//   * The server decides. Nothing is navigated from the saved pointer alone -
//     it is only a reason to ask. The answer, and the state, come from the
//     server, so a finished or abandoned game can never be re-entered.
//   * "No session" and "no answer" are different. Only an explicit
//     SESSION_NOT_FOUND (or our own DISCARD) erases the saved pointer; a timeout
//     or an unreachable server leaves it exactly where it was, to be retried on
//     the next launch.
//   * A game the bot has taken over is NOT auto-entered. The server answers
//     REJOIN_AVAILABLE, and the launch ends by asking the player instead of
//     navigating - cards have been played in their name, and being dropped into a
//     hand they no longer recognise is worse than being asked.

import socketService from './socket';
import { clearSession, loadSession } from './session';

/** The restore lifecycle. Exactly one terminal state is reached per launch. */
export const RestoreStatus = {
  /** Nothing attempted yet. */
  IDLE: 'IDLE',
  /** Asking the server. The app shows the restoring screen. */
  RESTORING: 'RESTORING',
  /** The server confirmed a session; `target` says where to go. */
  RESTORED: 'RESTORED',
  /**
   * There is a live game holding this player's seat, played by the bot. Nothing
   * is navigated: `offer` describes what is waiting, and the player chooses.
   */
  REJOIN_AVAILABLE: 'REJOIN_AVAILABLE',
  /** There is nothing to come back to. Home, with no error shown. */
  NO_SESSION: 'NO_SESSION',
  /** We could not find out. Home, and the saved session is kept. */
  FAILED: 'FAILED',
};

// How long to wait for the server's answer before giving up and showing Home.
// The clock starts before connect(), and matches the socket's own connect
// timeout so the two expire together rather than the user waiting out both.
const RESTORE_TIMEOUT_MS = 10000;

// Which screen each game phase belongs on. Restoring "into the game" is not
// enough - a player who closed the app while bidding must come back to the
// bidding UI, and one who closed it between rounds to the scoreboard.
const GAME_ROUTES = {
  BIDDING: 'Bidding',
  PLAYING: 'GameTable',
  HAND_WINNER: 'GameTable',
  ROUND_COMPLETE: 'ScoreBoard',
  ROUND_SCOREBOARD: 'ScoreBoard',
  // The celebration has already been seen (and would replay its fanfare for a
  // game that ended hours ago); the final scoreboard is where a finished game
  // rests.
  GAME_OVER: 'FinalScoreboard',
  FINAL_WINNER: 'FinalScoreboard',
  COMPLETED: 'FinalScoreboard',
};

/**
 * Turns a confirmed `session:restore` payload into the single screen to open.
 *
 * Pure, and the whole navigation decision: given a payload it always produces
 * the same route and params, or null when the payload cannot be acted on. Every
 * route is handed exactly the params that screen already expects when reached
 * the normal way, so nothing downstream has to know it was restored.
 */
export function resolveRestoreTarget(payload, fallback = {}) {
  if (!payload || payload.restored !== true || !payload.lobby) {
    return null;
  }

  const lobby = payload.lobby;
  if (!Array.isArray(lobby.players)) {
    return null;
  }

  const currentPlayerId = fallback.playerId || null;
  const me = lobby.players.find((p) => p.playerId === currentPlayerId);
  const currentPlayerName = me?.name || fallback.playerName || 'Player';

  const gameState = payload.gameState;
  if (gameState && gameState.status) {
    const name = GAME_ROUTES[gameState.status];
    if (!name) {
      return null;
    }

    if (name === 'ScoreBoard') {
      return {
        name,
        params: {
          // May be null if the server had no scoreboard to hand over; the screen
          // asks for it itself in that case.
          scoreboard: payload.scoreboard || null,
          currentPlayerId,
          currentPlayerName,
        },
      };
    }

    if (name === 'FinalScoreboard') {
      // The screen fetches the finished scoreboard (and the winners with it) on
      // mount, so there is nothing to carry across.
      return {
        name,
        params: { currentPlayerId, currentPlayerName, winnerIds: [] },
      };
    }

    return {
      name,
      params: { gameState, currentPlayerId, currentPlayerName },
    };
  }

  // No game: a waiting lobby. Same params Create/Join hand to the lobby screen,
  // including the live player list, so seats, host badge, bots and settings all
  // come back as they were.
  return {
    name: 'Lobby',
    params: {
      lobbyCode: lobby.code,
      lobbyId: lobby.id,
      hostName: lobby.hostName,
      hostId: lobby.hostPlayerId,
      isHost: lobby.hostPlayerId === currentPlayerId,
      currentPlayerId,
      currentPlayerName,
      gameSettings: lobby.settings,
      initialPlayers: lobby.players,
    },
  };
}

/**
 * Waits for the next session answer, resolving with null if none arrives in
 * time. `cancel()` tears the wait down when the caller gives up first (a failed
 * connect), so neither the timer nor the subscription outlives the attempt.
 */
function waitForSessionAnswer(timeoutMs) {
  let finish;
  const promise = new Promise((resolve) => {
    let settled = false;
    finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(value);
    };

    const unsubscribe = socketService.onSession((payload) => finish(payload));
    const timer = setTimeout(() => finish(null), timeoutMs);
  });

  return { promise, cancel: () => finish(null) };
}

/**
 * Runs the cold-start restore once and reports what should happen.
 *
 * Never throws and never navigates - it returns a decision, so the caller owns
 * the single navigation and there is no second path that can move the user.
 */
export async function runColdStartRestore({
  timeoutMs = RESTORE_TIMEOUT_MS,
  onSessionFound,
} = {}) {
  const saved = await loadSession();
  if (!saved) {
    console.log('[Session] No active session');
    return { status: RestoreStatus.NO_SESSION };
  }

  console.log(
    `[Session] Found persisted session${saved.lobbyCode ? ` for lobby ${saved.lobbyCode}` : ''}`
  );
  // Only now is there anything to restore - a first-ever launch must never be
  // told the app is restoring a game.
  onSessionFound?.();

  // Subscribed before connecting: the server answers as part of identifying us,
  // which can complete before connect() resolves.
  const answer = waitForSessionAnswer(timeoutMs);

  try {
    await socketService.connect(saved.playerName || 'Player');
    console.log('[Session] Socket connected; requesting session restore');
  } catch (error) {
    // Unreachable server, timeout, no network. The saved session is untouched -
    // it is almost certainly still valid, and this launch simply could not ask.
    answer.cancel();
    console.log('[Session] Could not reach the server:', error?.message);
    return { status: RestoreStatus.FAILED, reason: 'CONNECT_FAILED' };
  }

  const payload = await answer.promise;

  if (!payload) {
    console.log('[Session] No restore answer from the server; staying on Home');
    return { status: RestoreStatus.FAILED, reason: 'TIMEOUT' };
  }

  if (payload.restored !== true) {
    if (payload.reason === 'REJOIN_AVAILABLE' && payload.rejoin) {
      // The game is still running, with the bot in their seat. Deliberately not
      // a navigation: the launch ends here and the player is asked.
      console.log(`[Session] Rejoin available for lobby ${payload.rejoin.lobbyCode}`);
      return { status: RestoreStatus.REJOIN_AVAILABLE, offer: payload.rejoin };
    }
    if (payload.reason === 'SESSION_NOT_FOUND' || payload.reason === 'SESSION_DISCARDED') {
      // Expired, finished, kicked, left from another device, or discarded by the
      // player themselves. Normal - the pointer is dropped and they see Home.
      console.log('[Session] Session expired');
      await clearSession();
      return { status: RestoreStatus.NO_SESSION };
    }
    console.log('[Session] Restore refused:', payload.reason || 'UNKNOWN');
    return { status: RestoreStatus.FAILED, reason: payload.reason || 'UNKNOWN' };
  }

  const target = resolveRestoreTarget(payload, {
    playerId: socketService.playerId || saved.playerId,
    playerName: saved.playerName,
  });

  if (!target) {
    // A restored session we cannot map to a screen (unknown phase, malformed
    // payload). Better to stay on Home than to crash or guess.
    console.log('[Session] Restored session could not be mapped to a screen');
    return { status: RestoreStatus.FAILED, reason: 'UNSUPPORTED_STATE' };
  }

  console.log(
    `[Session] Restored ${target.name === 'Lobby' ? 'lobby' : 'game'}: ` +
      `${payload.lobby.code} -> ${target.name}`
  );
  return { status: RestoreStatus.RESTORED, target };
}
