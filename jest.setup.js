// Shared test environment for the app.
//
// Only two things need standing in for: the audio engine (expo-audio talks to
// native players that do not exist under Jest) and AsyncStorage. Everything
// else - gradients, animations, navigation primitives - renders fine under
// jest-expo and is left real so the tests exercise the actual components.

// The audio manager is imported by most interactive components purely to play a
// click. Replace it with spies so tests can assert a tap was registered without
// booting an audio session.
jest.mock("./src/services/audioManager", () => ({
  __esModule: true,
  default: {
    playSound: jest.fn(),
    init: jest.fn(async () => {}),
    startBackgroundMusic: jest.fn(async () => {}),
    stopBackgroundMusic: jest.fn(async () => {}),
    setSoundEnabled: jest.fn(async () => {}),
    isSoundEnabled: jest.fn(() => true),
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
