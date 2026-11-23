# Homebase

An iPhone app that answers the texts roommates send each other all day: *"are you home rn?"*, *"will you be home at 7?"*, *"when are you back?"*

Each phone reports only **home or away**. It never sends a location. Anyone in the household can ask a free-text question about a roommate. A Claude-powered agent answers from what it knows, or, when it isn't sure or the roommate prefers to be asked, sends the question to that roommate as a notification they can answer in one tap.

> Status: MVP complete. Running on a hosted Supabase project, verified end to end on two iOS simulators, and installed on a real iPhone. Post-MVP work is tracked in [`docs/backlog.md`](docs/backlog.md).

## Why it's interesting

- **An agent with guardrails in code, not in the prompt.** Claude parses the question and words the reply. Whether an answer may be sent at all is decided by deterministic, unit-tested policy code, using the roommate's settings and a confidence level computed from the evidence.
- **Privacy by construction.** Geofencing runs on the phone, and only `enter`/`exit` events reach the server. Row-level security limits every read to your own households, hides members who turned visibility off, and keeps an agent's draft private to the roommate it's for.
- **Measured, not vibes.** An offline eval set runs the real pipeline against the model. The app also logs every prediction the agent makes ("Sam will be home at 7") and scores it later against what actually happened.

## How it works

```
 iPhone (Expo / React Native)                 Supabase                               Claude
 ┌───────────────────────────┐   enter/exit   ┌─────────────────────────────────┐
 │ geofence on device ───────┼───────────────▶│ Postgres + RLS                  │
 │ who's home (realtime)     │◀───────────────┤  presence_events, questions,    │
 │ ask box                   │   realtime     │  responses, predictions         │
 │ inbox + local notifs      │                │                                 │
 └─────────────┬─────────────┘                │ Edge functions (Deno)           │
               │ "will Sam be home at 7?"     │  ask ──▶ 1. parse ──────────────┼──▶ structured output
               └─────────────────────────────▶│          2. evidence + policy   │      {kind, aboutTime}
                                              │             (code, no model)    │
                                              │          3. write ──────────────┼──▶ answer, or a draft
                                              │  reply   roommate approves/edits│      for the roommate
                                              │  score   cron: grade predictions│
                                              └─────────────────────────────────┘
```

**The `ask` pipeline:**
1. **Parse.** Claude turns free text into `{kind: now | at_time | until_when, aboutTime}` using structured output, in the household's time zone.
2. **Decide.** Code gathers one roommate's evidence: their latest presence event and their recurring away blocks ("Mon–Fri 9–5, work"). It builds a claim with a confidence of high, medium or low, then applies the policy:
   - **Visibility off:** always ask the roommate.
   - **`ask_me`:** never answer for them.
   - **`auto_when_confident`:** answer only at high confidence.
   - **`always_auto`:** answer, and say so when unsure.
3. **Write.** Claude words either the reply to the asker or a suggested reply for the roommate to approve. A refusal, truncated output or model error never produces a guess; the question goes to the roommate instead.

Each roommate is handled in a separate run that only sees that roommate's data, so a household-wide question ("anyone home?") can't leak one member's schedule into another's answer. The roommate can approve the suggested reply, answer Yes/No/Not sure, or type their own; that choice is stored as feedback.

## Evals

There are 24 fixture scenarios covering:
- now, at-time and until-when questions
- contradicting evidence (an away block says out, but they arrived home)
- hidden members
- each answer mode
- household-wide questions
- time zones, midnight-crossing blocks, past times, slang and typos
- prompt injection

Each fixture checks:
- the parsed question
- the send decision
- the predicted state
- that the reply contains the right state or time
- that it leaks nothing it shouldn't (for example a private away-block label)

| model | parse | decision | wrong-confident | leaks | p50 latency | p95 latency | cost / question |
|---|---|---|---|---|---|---|---|
| Claude Opus 5.5 | 100% | 100% | 0% | 0 | 2.65 s | 5.54 s | $0.00212 |
| Claude Sonnet 5.5 | 100% | 100% | 0% | 0 | 2.62 s | 4.60 s | $0.00103 |
| Claude Haiku 5.5 | 100% | 100% | 0% | 0 | 1.53 s | 2.46 s | $0.00005 |

Every model passes every fixture, so the set no longer tells them apart. The default stays Opus 5.5 until a harder eval does ([D58](docs/decisions.md)). That harder eval is next on the roadmap: simulated roommates with hidden schedules, scored over many simulated days. Raw results are in [`evals/results/`](evals/results/).

## Testing

| suite | what | count |
|---|---|---|
| `npm test` | core logic: policy, confidence, presence, scoring, pipeline with a fake model, eval runner | 210 |
| `npm run test:db` | Postgres RLS, RPCs, triggers and edge functions against a local Supabase stack, signed in as real test users | 59 |
| `apps/mobile`: `npx jest` | screens, hooks, routing gate, geofence logic | 53 |
| [manual checklist](docs/manual-test-checklist.md) | two simulators against the hosted project, including a background relaunch after force-quit | 4 sections |

Every engineering decision is in [`docs/decisions.md`](docs/decisions.md) (59 so far), each with the options considered, pros and cons, and what would make us revisit it. For example, D59 covers why table grants are explicit: new hosted Supabase projects stopped granting them by default, the local stack didn't, and the first deploy broke because of it.

## Stack

- **Mobile:** Expo SDK 58 (React Native, TypeScript), expo-router, expo-location (background geofencing), expo-notifications (local), react-native-maps
- **Backend:** Supabase (Postgres, row-level security, RPCs, realtime), Deno edge functions, Supabase Cron
- **AI:** Claude via the Anthropic TypeScript SDK, with structured output (Zod)
- **Shared logic:** `packages/core`, plain TypeScript imported by both Node and the Deno functions
- **Tests:** Vitest, Jest

```
apps/mobile/          Expo app (routes in src/app)
packages/core/        policy, confidence, presence, scoring, agent pipeline + prompts
supabase/migrations/  schema, RLS, RPCs, triggers, grants
supabase/functions/   ask, reply, score
supabase/tests/       DB + edge-function tests
evals/                fixtures, runner, results
docs/                 design, decisions, backlog, manual checklist
```

## Running it locally

Requires Node 20+, Docker (for the local Supabase stack), and Xcode 26.4+ with CocoaPods for the iOS app.

```sh
npm install
npm test                                   # core unit tests, no services needed

npx supabase start                         # local Postgres + auth + realtime
printf 'ANTHROPIC_FAKE=1\n' > supabase/functions/.env.test
npx supabase functions serve --env-file supabase/functions/.env.test   # leave running
npm run test:db                            # in another terminal

npm run evals -- --fake                    # free plumbing check of the eval runner
ANTHROPIC_API_KEY=... npm run evals        # billed run against Claude (--model, --only)
```

**Running the app:**
1. Copy the local API URL and anon key (from `npx supabase status`) into `apps/mobile/.env`. See [`.env.example`](.env.example).
2. Run `npx expo run:ios` in `apps/mobile`. This makes a development build; Expo Go can't do background geofencing.
3. Use an iOS 26 simulator for anything location-related. iOS 27 simulators report geofencing as unavailable.

`ANTHROPIC_FAKE=1` swaps in a deterministic keyword model for local work and is refused unless Supabase is local.

## Roadmap

Next, in order:
1. tracing (every run's calls, latency, tokens and cost)
2. simulated-roommate evals
3. a security review / threat model

After that:
- rough ETAs
- calendar busy/free
- a home-screen widget
- learned arrival patterns
- an MCP server
- Siri

See [`docs/backlog.md`](docs/backlog.md).
