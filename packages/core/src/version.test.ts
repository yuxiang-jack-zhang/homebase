import { expect, test } from "vitest";
import { CORE_VERSION } from "./version.ts";

test("CORE_VERSION is semver", () => {
  expect(CORE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
});
