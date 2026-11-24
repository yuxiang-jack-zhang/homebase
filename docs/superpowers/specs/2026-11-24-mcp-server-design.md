# Local MCP server: design

Status: approved, 2026-11-24.

## Why

Asking "is Sam home?" should work from wherever the person already talks to Claude, not only the phone app.
A local MCP server lets Claude Desktop or Claude Code call Homebase as tools. It also shows the agent from the
other side: Homebase's own agent answers, and an outside model is just another asker.

## Tools

Few and plain. Household arguments take a name or id and default to the only household.

| Tool | Does | Backed by |
|---|---|---|
| `list_households` | My households | `households` (RLS) |
| `whos_home` | Last reported home/away of each visible member | `current_presence`, `household_members`, `profiles` |
| `ask` | Ask about one or more roommates by name, or everyone | `ask` edge function |
| `my_inbox` | Questions waiting for my reply, with the suggested answer | `question_targets` + drafts (RLS) |
| `reply` | Answer one of them: approve / yes / no / not_sure / text | `reply` edge function |
| `my_questions` | My recent questions in a household and their answers | `questions`, `question_targets`, `target_guesses`, sent `responses` |

Outputs are short text: names, home/away, the asker-facing answer text. No claims, confidence or ids other than the
one `reply` needs. Tool descriptions tell the calling model that answers about roommates are best guesses.

## Auth

The server signs in as the person (`signInWithPassword`) with `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`HOMEBASE_EMAIL`, `HOMEBASE_PASSWORD` from a git-ignored `apps/mcp/.env` or the MCP client's env. Every read goes
through that session, so RLS applies exactly as in the app; asks and replies go through the existing edge
functions, so rate limits, the circuit breaker and the facts-only writer apply too. The Anthropic key never touches
this package. Sign-in is lazy (first tool call), so listing tools needs no credentials.

## Non-goals

- No hosted or OAuth MCP server yet.
- No new server code, migrations or endpoints.
- No realtime or notifications: tools are pull-only.

## Alternatives

- **Hosted remote MCP with OAuth (later).** One URL, no password on disk, works from claude.ai. Needs an OAuth
  authorization server in front of Supabase Auth and a host to run it. Worth it once more than the owner uses this.
- **Personal access tokens.** Avoids the password but needs new tables and an edge function; not "no new server code".
