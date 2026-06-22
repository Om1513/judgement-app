// App configuration
//
// The game server URL is resolved from the environment so the same code can
// target local dev, a LAN device, staging and production with no code edits.
//
// Resolution order:
//   1. EXPO_PUBLIC_SERVER_URL  - set in `.env` (local) or EAS env (builds).
//                                Expo inlines any EXPO_PUBLIC_* var at build time.
//   2. Local dev fallback      - localhost, for the iOS simulator / web.
//
// ----------------------------------------------------------------------------
// HOW TO SET IT
// ----------------------------------------------------------------------------
// Local dev on a physical device (Expo Go): the phone cannot reach "localhost",
// so point it at your computer's LAN IP in `.env` at the project root:
//
//     EXPO_PUBLIC_SERVER_URL=http://192.168.0.21:3001
//
// Android emulator:  EXPO_PUBLIC_SERVER_URL=http://10.0.2.2:3001
// iOS simulator/web: leave unset (defaults to http://localhost:3001)
//
// Production: set EXPO_PUBLIC_SERVER_URL=https://your-api-host  in EAS env.
// Production builds MUST use https:// (iOS ATS / Android cleartext block http).
// ----------------------------------------------------------------------------

const DEV_FALLBACK_URL = 'http://localhost:3001';

const envUrl =
  typeof process !== 'undefined' && process.env
    ? process.env.EXPO_PUBLIC_SERVER_URL
    : undefined;

export const SERVER_URL = envUrl || (__DEV__ ? DEV_FALLBACK_URL : null);

if (!SERVER_URL) {
  // A release build with no configured server cannot connect to anything.
  console.error(
    '[config] SERVER_URL is not set. Define EXPO_PUBLIC_SERVER_URL for this build.'
  );
} else if (!__DEV__ && SERVER_URL.startsWith('http://')) {
  // Surfaces the most common production mistake early.
  console.warn(
    '[config] SERVER_URL uses http:// in a release build. iOS/Android will ' +
      'likely block it - use https:// (wss://).'
  );
}

export default {
  SERVER_URL,
};
