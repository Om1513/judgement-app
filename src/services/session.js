// The one thing about a game that has to survive the app being killed.
//
// Everything else - the lobby, the hands, whose turn it is - lives on the
// server, which stays authoritative. All this stores is enough to *ask* for a
// session back on the next launch: who we are and, purely for logging and for
// the restoring screen, which lobby we were in. Deliberately nothing private:
// no cards, no deck, no other players' state.
//
// Identity itself is the stable clientId already persisted by socketService;
// this record is what tells a cold start there is any point connecting at all,
// and it is what an explicit "Leave" erases so the app does not rejoin a game
// the player walked away from on purpose.

import AsyncStorage from '@react-native-async-storage/async-storage';

export const SESSION_KEY = '@kachuful_session';

/**
 * Persists the current session pointer, replacing any previous one - a player is
 * only ever in one lobby, so there is nothing to merge.
 *
 * A record without a playerId is not worth storing (there would be nothing to
 * identify on the next launch) and is ignored. Never throws: failing to remember
 * a session costs an auto-rejoin, and must not take down the caller.
 */
export async function saveSession(session) {
  if (!session || typeof session.playerId !== 'string' || !session.playerId) {
    return null;
  }

  const record = {
    playerId: session.playerId,
    playerName: typeof session.playerName === 'string' ? session.playerName : '',
    lobbyCode: typeof session.lobbyCode === 'string' ? session.lobbyCode : null,
    lobbyId: typeof session.lobbyId === 'string' ? session.lobbyId : null,
  };

  try {
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(record));
    return record;
  } catch (error) {
    console.log('[Session] Could not persist session:', error?.message);
    return null;
  }
}

/**
 * Reads the saved session, or null when there is none.
 *
 * A record that is missing or unreadable (corrupt JSON, an older shape, a
 * half-written value) is treated as "no session" and cleared, so a bad write
 * can never wedge every future launch.
 */
export async function loadSession() {
  let raw;
  try {
    raw = await AsyncStorage.getItem(SESSION_KEY);
  } catch (error) {
    console.log('[Session] Could not read saved session:', error?.message);
    return null;
  }

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.playerId !== 'string' || !parsed.playerId) {
      throw new Error('malformed session record');
    }
    return {
      playerId: parsed.playerId,
      playerName: typeof parsed.playerName === 'string' ? parsed.playerName : '',
      lobbyCode: typeof parsed.lobbyCode === 'string' ? parsed.lobbyCode : null,
      lobbyId: typeof parsed.lobbyId === 'string' ? parsed.lobbyId : null,
    };
  } catch (error) {
    console.log('[Session] Discarding unreadable saved session:', error?.message);
    await clearSession();
    return null;
  }
}

/** Forgets the saved session. Called on an explicit leave, a kick, or expiry. */
export async function clearSession() {
  try {
    await AsyncStorage.removeItem(SESSION_KEY);
  } catch (error) {
    console.log('[Session] Could not clear saved session:', error?.message);
  }
}
