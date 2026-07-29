// Flat ESLint config for the whole repository.
//
// One config, one command (`npm run lint`), two very different halves:
//
//   * the Expo/React Native app at the repo root (plain JavaScript + JSX)
//   * the TypeScript game server under `server/`
//
// The rule set is deliberately small and aimed at correctness - unused
// bindings, unreachable code, broken/duplicate imports, hook dependency
// mistakes, unhandled promises. Formatting is intentionally NOT linted; there
// is no style bikeshedding here.

const js = require("@eslint/js");
const globals = require("globals");
const tseslint = require("typescript-eslint");
const expoConfig = require("eslint-config-expo/flat");

// Correctness rules we want everywhere, regardless of language.
const sharedCorrectnessRules = {
  "no-unreachable": "error",
  "no-duplicate-imports": "error",
  "no-constant-condition": ["error", { checkLoops: false }],
  "no-self-compare": "error",
  "no-unmodified-loop-condition": "error",
  "no-unused-private-class-members": "error",
  "no-template-curly-in-string": "error",
  eqeqeq: ["error", "smart"],
};

module.exports = [
  {
    // Build output, dependencies, generated clients and static assets.
    ignores: [
      "node_modules/**",
      "server/node_modules/**",
      "server/dist/**",
      "dist/**",
      "web-build/**",
      "coverage/**",
      "server/coverage/**",
      ".expo/**",
      "generated/**",
      "assets/**",
      "*.html",
    ],
  },

  // ---------------------------------------------------------------------
  // Expo / React Native app (repo root, plain JS + JSX)
  // ---------------------------------------------------------------------
  ...expoConfig.map((config) => ({
    ...config,
    files: ["App.js", "index.js", "src/**/*.js", "*.config.js"],
  })),
  {
    files: ["App.js", "index.js", "src/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
        __DEV__: "readonly",
      },
    },
    rules: {
      ...sharedCorrectnessRules,
      // eslint-config-expo wires the TypeScript-aware unused-vars rule up for
      // .js too, so use only that one - having both on double-reports.
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // Hook dependency mistakes are real bugs, but the existing screens have a
      // number of intentional mount-only animation effects. Reported, not
      // fatal, so the signal stays visible without blocking unrelated work.
      "react-hooks/exhaustive-deps": "warn",
      // Every service in `src/services` exports both a class/singleton default
      // and named helpers; importing the default by its own name is intended.
      "import/no-named-as-default": "off",
    },
  },

  // Node-side config files at the repo root run in CommonJS, not the app.
  {
    files: ["*.config.js", "eslint.config.js", "jest.setup.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { ...globals.node, ...globals.jest },
    },
    rules: {
      ...sharedCorrectnessRules,
      "@typescript-eslint/no-require-imports": "off",
    },
  },

  // Frontend Jest tests.
  {
    files: ["src/**/__tests__/**/*.js", "src/**/*.test.js", "tests/**/*.js"],
    languageOptions: {
      globals: { ...globals.jest, ...globals.node },
    },
  },

  // ---------------------------------------------------------------------
  // TypeScript game server
  // ---------------------------------------------------------------------
  {
    files: ["server/src/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        // Type-aware linting so we can catch unhandled promises, which is the
        // most common real defect in this async, socket-driven codebase.
        projectService: true,
        tsconfigRootDir: __dirname + "/server",
      },
      globals: { ...globals.node },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      ...js.configs.recommended.rules,
      ...tseslint.configs.recommended
        .map((c) => c.rules)
        .reduce((acc, r) => ({ ...acc, ...r }), {}),
      ...sharedCorrectnessRules,

      // `no-unused-vars` must be the TS-aware version or it misreports types.
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // A dropped promise in a socket handler silently loses a game action.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",

      // Prisma's generated JSON types force a handful of `as any` casts at the
      // persistence boundary; banning them outright would mean rewriting the
      // storage layer. Everything else about `any` still applies.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  // Server tests. `node:test`'s `test()` returns a promise that the runner
  // itself awaits; calling it at the top level is the documented usage, so the
  // floating-promise rule would fire on every single test.
  {
    files: ["server/src/tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
];
