# Homebase MCP server

Ask Claude Desktop or Claude Code "is Sam home?" and get the answer from Homebase. A local stdio
[MCP](https://modelcontextprotocol.io) server that signs in as you, so it sees and does exactly what you can in the
app: same row-level security, same `ask`/`reply` edge functions, same rate limits. No Anthropic key here; Homebase's
own agent answers on the server. Design: `docs/superpowers/specs/2026-11-24-mcp-server-design.md`.

## Tools

| Tool | What it does |
|---|---|
| `list_households` | Your households |
| `whos_home` | Each member's last reported home/away (members who hide it show "not shared") |
| `ask` | Ask about roommates by name, or `everyone`; returns Homebase's answer or "waiting for a reply" |
| `my_inbox` | Questions waiting for your reply, with the suggested answer and an id |
| `reply` | Reply to one: `approve` (send the suggestion), `yes`, `no`, `not_sure`, or `text` |
| `my_questions` | Your last 10 questions in a household and the answers so far |

Household arguments take a name or id and default to your only household. Answers about roommates are best guesses.

## Setup

From the repo root, `npm install`, then:

```sh
cp apps/mcp/.env.example apps/mcp/.env   # fill in; .env is git-ignored
```

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are the same values the app uses (local: `npx supabase status`).
`HOMEBASE_EMAIL` / `HOMEBASE_PASSWORD` are your Homebase account. The server signs in on the first tool call,
not at start, so a bad password shows up as a tool error.

## Claude Code

```sh
claude mcp add homebase -- npx tsx /ABSOLUTE/PATH/TO/homebase/apps/mcp/src/index.ts
```

To pass the settings instead of using `.env`, add `-e KEY=value` for each before `--`
(`claude mcp add homebase -e SUPABASE_URL=... -e ... -- npx tsx ...`). Check with `claude mcp list`, then ask
"is anyone home?".

## Claude Desktop

Settings > Developer > Edit Config, add to `claude_desktop_config.json`, restart Claude Desktop:

```json
{
  "mcpServers": {
    "homebase": {
      "command": "npx",
      "args": ["tsx", "/ABSOLUTE/PATH/TO/homebase/apps/mcp/src/index.ts"],
      "env": {
        "SUPABASE_URL": "https://your-project.supabase.co",
        "SUPABASE_ANON_KEY": "your-anon-key",
        "HOMEBASE_EMAIL": "you@example.com",
        "HOMEBASE_PASSWORD": "your-homebase-password"
      }
    }
  }
}
```

Leave out `env` if `apps/mcp/.env` is filled in. If Desktop can't find `npx`, use its absolute path (`which npx`).

## Tests

`npm test` runs the tool unit tests (`src/tools.test.ts`). `supabase/tests/mcp.test.ts` runs the tools against the
local stack with `npm run test:db` (needs the functions served; see `supabase/tests/README.md`).
