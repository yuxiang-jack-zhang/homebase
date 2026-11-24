import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@homebase/core/src/db.types.ts";
import { makeTools, SPECS, type Tools } from "./tools.ts";

// The MCP client's env wins; apps/mcp/.env fills the rest if present.
try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
} catch {}

const KEYS = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "HOMEBASE_EMAIL", "HOMEBASE_PASSWORD"] as const;

async function signIn(): Promise<Tools> {
  const missing = KEYS.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Homebase MCP is missing ${missing.join(", ")}. Set them in apps/mcp/.env (see .env.example).`);
  const env = process.env as Record<(typeof KEYS)[number], string>;
  const client = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email: env.HOMEBASE_EMAIL, password: env.HOMEBASE_PASSWORD });
  if (error) throw new Error(`Homebase sign-in failed: ${error.message}`);
  return makeTools(client, data.user.id);
}

// Lazy, so tools can be listed without credentials; a failed sign-in is retried on the next call.
let session: Promise<Tools> | undefined;
const tools = () => (session ??= signIn().catch((e) => { session = undefined; throw e; }));

const server = new McpServer({ name: "homebase", version: "0.1.0" });
for (const [name, spec] of Object.entries(SPECS) as [keyof Tools, (typeof SPECS)[keyof Tools]][]) {
  // Thrown errors reach the model as isError tool results (McpServer does that).
  server.registerTool(name, spec, async (args: object) => {
    const run = async () => ((await tools())[name] as (a: object) => Promise<string>)(args);
    let text: string;
    try {
      text = await run();
    } catch (e) {
      // A dead session (password changed, signed out elsewhere) shows up as an expired token or RLS denials: sign in once more.
      if (!/session expired|permission denied|JWT/i.test((e as Error).message)) throw e;
      session = undefined;
      text = await run();
    }
    return { content: [{ type: "text", text }] };
  });
}
await server.connect(new StdioServerTransport());
