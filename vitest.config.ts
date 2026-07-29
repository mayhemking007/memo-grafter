import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "src/**/*.test.ts"],
    // Keep Windows watch runs stable on high-core machines without disabling file isolation.
    maxWorkers: 4,
  },
});
