// Jest configuration for the Expo / React Native app.
//
// The server has its own runner (node:test, see server/scripts/test.mjs); this
// covers only the client. Two kinds of test live here:
//
//   * src/utils/__tests__      - pure game-rule mirrors and layout maths
//   * src/components/__tests__ - behaviour of the shared UI pieces
//
// Deliberately no snapshot testing: a stored render tree of an animated,
// gradient-heavy card component tells us nothing when it changes, and everything
// would break on a colour tweak.

module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  testMatch: ["<rootDir>/src/**/__tests__/**/*.test.js"],
  collectCoverageFrom: [
    "src/utils/**/*.js",
    "src/components/**/*.js",
    "src/hooks/**/*.js",
    "!src/**/__tests__/**",
  ],
  coverageDirectory: "<rootDir>/coverage",
  // The pure rule mirrors in src/utils must stay well covered - they duplicate
  // server logic, so a gap there is a gap in something safety-critical.
  coverageThreshold: {
    "./src/utils/": {
      statements: 90,
      branches: 90,
      functions: 90,
      lines: 90,
    },
  },
  clearMocks: true,
};
