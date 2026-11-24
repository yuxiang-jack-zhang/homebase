import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "core", include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "evals/**/*.test.ts", "supabase/functions/**/*.test.ts"], exclude: [...configDefaults.exclude, "apps/mobile/**"] } },
      "./vitest.db.config.ts",
    ],
  },
});
