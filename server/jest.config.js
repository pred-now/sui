export default {
    preset: "ts-jest/presets/default-esm",
    testEnvironment: "node",
    testMatch: ["**/tests/**/*.test.ts"],
    setupFiles: ["<rootDir>/tests/setup-env.ts"],
    testTimeout: 30000,
    forceExit: true,
    maxWorkers: 1, // integration tests share the live API and redis
};
