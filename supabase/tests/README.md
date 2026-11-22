# DB and edge-function tests

`npm run test:db` runs everything in this folder against the local stack. `functions.test.ts` also needs the
edge functions served with the deterministic fake model (no Claude calls, no cost):

```sh
npx supabase start                       # once
printf 'ANTHROPIC_FAKE=1\n' > supabase/functions/.env.test   # git-ignored
npx supabase functions serve --env-file supabase/functions/.env.test   # leave running
npm run test:db                          # in another terminal
```

If the functions are not served, `functions.test.ts` fails at once with a message saying so.
`ANTHROPIC_FAKE=1` is refused unless `SUPABASE_URL` points at a local host, so it can't be switched on in production.
