import { defineConfig } from "vitest/config";

/**
 * Vitest replaces mocha+ts-node for `src/**\/*.test.ts` (v2.6.4 onwards).
 *
 * `test/package.js` + `test/integration.js` keep using mocha because
 * `@iobroker/testing` is mocha-only.
 */
export default defineConfig({
    test: {
        globals: true,
        include: ["src/**/*.test.ts"],
        setupFiles: ["./test/vitest.setup.ts"],
        // No watch mode by default — match the existing CI/local UX of
        // `vitest run`.
        watch: false,
        // Single process keeps the existing chai `should()` global setup
        // straightforward (no per-worker re-init). Test count is moderate
        // and tests are fast; parallelism isn't a hot issue.
        pool: "forks",
        forks: {
            singleFork: true,
        },
    },
});
