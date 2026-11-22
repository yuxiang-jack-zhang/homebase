import { CORE_VERSION } from "../../../packages/core/src/version.ts";

Deno.serve(() =>
  Response.json({ ok: true, coreVersion: CORE_VERSION })
);
