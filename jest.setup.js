// Shared test environment for the app.
//
// Only two things need standing in for: the audio engine (expo-audio talks to
// native players that do not exist under Jest) and AsyncStorage. Everything
// else - gradients, animations, navigation primitives - renders fine under
// jest-expo and is left real so the tests exercise the actual components.

// Render every test at the design's reference viewport: iPhone 17 Pro in
// landscape, 874 x 402 logical points.
//
// This is what makes the component tests meaningful. src/utils/responsive.js is
// the identity at exactly this size, so a test asserting "the glyph is 22pt" is
// asserting the reference design, not whatever size the default RN test window
// happens to be. Viewport-dependent behaviour is covered directly, and at many
// sizes, in src/utils/__tests__/responsive.test.js.
const { Dimensions } = require("react-native");

const BASELINE_VIEWPORT = { width: 874, height: 402, scale: 3, fontScale: 1 };
Dimensions.set({ window: BASELINE_VIEWPORT, screen: BASELINE_VIEWPORT });

// Report the web fonts as already loaded.
//
// Every screen gates its real content behind `useFonts`, which under Jest never
// resolves - so without this a rendered screen is only ever its font-loading
// placeholder, and a test that mounts one is asserting nothing about the layout
// underneath. Plain functions rather than jest.fn(), so the `clearMocks: true`
// in jest.config.js cannot strip the implementation between tests.
jest.mock("@expo-google-fonts/bangers", () => ({
  useFonts: () => [true, null],
  Bangers_400Regular: "Bangers_400Regular",
}));

jest.mock("@expo-google-fonts/inter", () => ({
  useFonts: () => [true, null],
  Inter_400Regular: "Inter_400Regular",
  Inter_700Bold: "Inter_700Bold",
}));

// The audio manager is imported by most interactive components purely to play a
// click. Replace it with spies so tests can assert a tap was registered without
// booting an audio session.
// Mirrors the real singleton's public surface (see src/services/audioManager.js).
// It has to be the whole surface, not just playSound: useSoundEnabled reads
// getSoundEnabled/initialize/subscribe on mount, so every screen with a mute
// button touches all three.
jest.mock("./src/services/audioManager", () => ({
  __esModule: true,
  default: {
    playSound: jest.fn(),
    initialize: jest.fn(async () => {}),
    playBackgroundMusic: jest.fn(async () => {}),
    pauseBackgroundMusic: jest.fn(),
    resumeBackgroundMusic: jest.fn(),
    stopBackgroundMusic: jest.fn(),
    duckMusic: jest.fn(),
    // Called from the winner screen's cleanup, so any test that unmounts it
    // needs this present.
    restoreMusicVolume: jest.fn(),
    setSoundEnabled: jest.fn(async () => {}),
    getSoundEnabled: jest.fn(() => true),
    // Returns the unsubscribe function the hook stores as its effect cleanup;
    // handing back undefined makes React throw on unmount.
    subscribe: jest.fn(() => () => {}),
  },
}));

jest.mock("@react-native-async-storage/async-storage", () => {
  const store = new Map();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
      setItem: jest.fn(async (key, value) => {
        store.set(key, value);
      }),
      removeItem: jest.fn(async (key) => {
        store.delete(key);
      }),
      clear: jest.fn(async () => store.clear()),
    },
  };
});

// React Native's Animated warns that it cannot use the native driver in this
// environment. It is expected and says nothing about the code under test, so
// keep the output readable.
const { warn } = console;
console.warn = (...args) => {
  if (typeof args[0] === "string" && args[0].includes("useNativeDriver")) return;
  warn(...args);
};
