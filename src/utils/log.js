// Logging that only exists in development.
//
// For diagnostics that help while building the app - a sound that failed to
// load, a share sheet that was dismissed - but are noise on a player's phone.
// Logs that explain a production problem (why a session was or was not
// restored, socket connects and drops) use console directly, and failures that
// matter use console.warn / console.error.

/** console.log in development; nothing in a release build. */
export function devLog(...args) {
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    console.log(...args);
  }
}
