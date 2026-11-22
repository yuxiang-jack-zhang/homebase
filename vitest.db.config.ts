import { defineProject } from "vitest/config";

// Runs against the local Supabase stack (`npx supabase start`), signed in as real test users (D18).
export default defineProject({
  test: {
    name: "db",
    include: ["supabase/tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
