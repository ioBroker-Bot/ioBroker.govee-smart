import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.test.ts"],
    watch: false,
    pool: "forks",
    forks: {
      singleFork: false,
    },
    coverage: {
      // Explicit include so files that no test imports still show up as 0 %
      // — without this the v8 provider silently omits them and the headline
      // number overstates real coverage (found in the v2.16.1 audit: the
      // handler modules were invisible at "81 %" while true src coverage
      // was 66 %).
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.d.ts",
        // Lifecycle wiring only — covered by test/integration.js (adapter
        // boot harness); unit-mocking it would test the mocks.
        "src/main.ts",
        // Test scaffolding, not production code.
        "src/lib/test-helpers.ts",
      ],
    },
  },
});
