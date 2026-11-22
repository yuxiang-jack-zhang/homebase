import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "core", include: ["packages/**/*.test.ts", "apps/**/*.test.ts"] } },
      // db project (supabase-js against local stack) is added in the DB task.
    ],
  },
});
