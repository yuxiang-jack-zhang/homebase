import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "core", include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "evals/**/*.test.ts"] } },
      "./vitest.db.config.ts",
    ],
  },
});
