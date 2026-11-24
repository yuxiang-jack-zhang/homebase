import { beforeAll, describe, expect, it } from "vitest";
import { ASK_LIMITS } from "../../packages/core/src/contracts.ts";
import { isLocalUrl, modelFromEnv } from "../functions/_shared/model.ts";
import { API_URL, SERVICE_ROLE_KEY, admin, makeHousehold, newUser, ok, type TestUser } from "./helpers.ts";

// Needs the functions served with the fake model; see supabase/tests/README.md.
const FN = `${API_URL}/functions/v1`;
// The keyword fake restates the claim it is given, so the writer check (acceptWriterText) keeps it.
const FAKE_HOME = "Fake model: home.";
const FAKE_AWAY_AT = expect.stringMatching(/^Fake model: away at \d{1,2}:\d{2} [AP]M\.$/);
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

async function token(user: TestUser) {
  const { data } = await user.client.auth.getSession();
  return data.session!.access_token;
}

async function call(fn: string, bearer: string | null, body?: unknown, method = "POST") {
  const res = await fetch(`${FN}/${fn}`, {
    method,
    headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const ask = async (user: TestUser, body: unknown) => call("ask", await token(user), body);
const reply = async (user: TestUser, body: unknown) => call("reply", await token(user), body);

/** Sam (ask_me, home now) has away blocks covering the whole week, so a future question gets an "away" draft. */
async function escalatedQuestion() {
  const { household, owner, members: [sam] } = await makeHousehold(["Sam"]);
  const all = [0, 1, 2, 3, 4, 5, 6];
  ok(await sam.client.from("away_blocks").insert([
    { household_id: household.id, user_id: sam.id, days_of_week: all, start_local: "00:00", end_local: "12:00" },
    { household_id: household.id, user_id: sam.id, days_of_week: all, start_local: "12:00", end_local: "00:00" },
  ]));
  const r = await ask(owner, { householdId: household.id, target: { userIds: [sam.id] }, text: "will Sam be home at 9" });
  expect(r.status).toBe(200);
  const qt = ok(await admin.from("question_targets").select().eq("question_id", r.body.questionId).single());
  return { household, owner, sam, ask: r.body, qt };
}

beforeAll(async () => {
  const res = await fetch(`${FN}/health`).catch(() => null);
  if (!res?.ok) {
    throw new Error("Edge functions are not served. Run: npx supabase functions serve --env-file supabase/functions/.env.test");
  }
});

describe("isLocalUrl", () => {
  it.each(["http://127.0.0.1:54321", "http://localhost:54321", "http://kong:8000", "http://host.docker.internal:54321"])(
    "%s is local", (u) => expect(isLocalUrl(u)).toBe(true));
  it.each(["https://abc.supabase.co", "https://localhost.evil.com", "not a url", ""])(
    "%s is not local", (u) => expect(isLocalUrl(u)).toBe(false));
});

describe("modelFromEnv", () => {
  const env = (vars: Record<string, string>) => ({ get: (k: string) => vars[k] });
  const parseModel = async (m: ReturnType<typeof modelFromEnv>) =>
    (await m.parse({ system: "", user: "<question>\nis Sam home\n</question>", schema: {} as never })).usage.model;

  it("ANTHROPIC_FAKE=1 against a remote SUPABASE_URL throws", () => {
    expect(() => modelFromEnv(env({ ANTHROPIC_FAKE: "1", SUPABASE_URL: "https://abc.supabase.co", ANTHROPIC_API_KEY: "k" }))).toThrow(/local/);
    expect(() => modelFromEnv(env({ ANTHROPIC_FAKE: "1" }))).toThrow(/local/);
  });
  it("ANTHROPIC_FAKE=1 against a local SUPABASE_URL returns the keyword fake", async () => {
    expect(await parseModel(modelFromEnv(env({ ANTHROPIC_FAKE: "1", SUPABASE_URL: "http://kong:8000" })))).toBe("keyword-fake");
  });
  it("without the fake, a missing API key throws", () => {
    expect(() => modelFromEnv(env({ SUPABASE_URL: "http://kong:8000" }))).toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe("ask", () => {
  it('"is Sam home" (Sam visible, home) -> answered, response visible to asker', async () => {
    const { household, owner, members: [sam] } = await makeHousehold(["Sam"]);
    ok(await sam.client.from("presence_events").insert({ household_id: household.id, user_id: sam.id, kind: "enter", at: minutesAgo(5) }));

    const r = await ask(owner, { householdId: household.id, target: { userIds: [sam.id] }, text: "is Sam home" });

    expect(r.status).toBe(200);
    expect(r.body.targets).toEqual([{ userId: sam.id, status: "answered", text: FAKE_HOME }]);
    const q = ok(await owner.client.from("questions").select("kind, question_targets(status, responses(visibility, text, source))")
      .eq("id", r.body.questionId).single());
    expect(q).toEqual({ kind: "now", question_targets: [{ status: "answered", responses: [{ visibility: "sent", text: FAKE_HOME, source: "agent" }] }] });
  });

  it("writes a trace: one run linked to the question, a parse call and one answer call; users can't read traces (D62)", async () => {
    const { household, owner, members: [sam] } = await makeHousehold(["Sam"]);
    ok(await sam.client.from("presence_events").insert({ household_id: household.id, user_id: sam.id, kind: "enter", at: minutesAgo(5) }));
    const r = await ask(owner, { householdId: household.id, target: { userIds: [sam.id] }, text: "is Sam home" });
    expect(r.status).toBe(200);

    const run = ok(await admin.from("agent_runs").select("id, ok, latency_ms, agent_calls(step, ok, model, target_user_id, error)")
      .eq("question_id", r.body.questionId).single());
    expect(run.ok).toBe(true);
    expect(run.latency_ms).toBeGreaterThanOrEqual(0);
    expect(run.agent_calls.sort((a, b) => a.step.localeCompare(b.step))).toEqual([
      { step: "answer", ok: true, model: "keyword-fake", target_user_id: sam.id, error: null },
      { step: "parse", ok: true, model: "keyword-fake", target_user_id: null, error: null },
    ]);
    for (const table of ["agent_runs", "agent_calls"] as const) {
      expect((await owner.client.from(table).select("id")).error?.code).toBe("42501");
    }
  });

  it("a future question about an ask_me member -> awaiting_reply; asker sees no draft (RLS); target sees draft", async () => {
    const { owner, sam, ask: r, qt } = await escalatedQuestion();

    expect(r.targets).toEqual([{ userId: sam.id, status: "awaiting_reply", text: "Asked Sam — waiting for a reply." }]);
    expect(qt).toMatchObject({ status: "awaiting_reply", fallback_guess: null });
    expect(ok(await owner.client.from("responses").select().eq("question_target_id", qt.id))).toEqual([]);
    const drafts = ok(await sam.client.from("responses").select().eq("question_target_id", qt.id));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ visibility: "draft", text: FAKE_AWAY_AT, draft_claim: { kind: "at_time", predictedState: "away" } });
    // An unapproved draft is not a prediction yet.
    expect(ok(await admin.from("predictions").select().eq("question_target_id", qt.id))).toEqual([]);
  });

  it("a hidden member -> awaiting_reply with no answer, guess or draft built from their presence", async () => {
    const { household, owner, members: [sam] } = await makeHousehold(["Sam"]);
    ok(await sam.client.rpc("update_my_settings", { p_household_id: household.id, p_visibility: false, p_answer_mode: "always_auto" }));
    ok(await sam.client.from("presence_events").insert({ household_id: household.id, user_id: sam.id, kind: "enter", at: minutesAgo(5) }));

    const r = await ask(owner, { householdId: household.id, target: { userIds: [sam.id] }, text: "is Sam home" });

    expect(r.status).toBe(200);
    expect(r.body.targets).toEqual([{ userId: sam.id, status: "awaiting_reply", text: "Asked Sam — waiting for a reply." }]);
    const qt = ok(await admin.from("question_targets").select("id, fallback_guess").eq("question_id", r.body.questionId).single());
    expect(qt.fallback_guess).toBeNull();
    expect(ok(await admin.from("responses").select().eq("question_target_id", qt.id))).toEqual([]);
  });

  it("after visibility is back on, a past question about the hidden window is not answered from hidden presence (C1)", async () => {
    const { household, owner, members: [sam] } = await makeHousehold(["Sam"]);
    const settings = async (v: boolean) => ok(await sam.client.rpc("update_my_settings",
      { p_household_id: household.id, p_visibility: v, p_answer_mode: "auto_when_confident" }));
    await settings(false);
    ok(await sam.client.from("presence_events").insert({ household_id: household.id, user_id: sam.id, kind: "enter", at: minutesAgo(150) }));
    ok(await sam.client.from("presence_events").insert({ household_id: household.id, user_id: sam.id, kind: "exit", at: minutesAgo(60) }));
    await settings(true);

    // The fake parses "was ..." as two hours ago, inside the hidden window where Sam was really home.
    const r = await ask(owner, { householdId: household.id, target: { userIds: [sam.id] }, text: "was Sam home at 3" });

    expect(r.status).toBe(200);
    expect(r.body.targets).toEqual([{ userId: sam.id, status: "awaiting_reply", text: "Asked Sam — waiting for a reply." }]);
    const qt = ok(await admin.from("question_targets").select("id, fallback_guess").eq("question_id", r.body.questionId).single());
    expect(qt.fallback_guess).toBeNull();
    expect(ok(await admin.from("responses").select().eq("question_target_id", qt.id))).toEqual([]); // no claim, so no draft
    // "Now" is answered from the latest event, which turning visibility on revealed.
    const now = await ask(owner, { householdId: household.id, target: { userIds: [sam.id] }, text: "is Sam home" });
    expect(now.body.targets[0].status).toBe("answered");
  });

  it("'everyone' with mixed modes: ask_me -> unknown (not pinged), auto with no prediction -> awaiting_reply, always_auto with a block -> answered (D54)", async () => {
    const { household, owner, members: [ann, bo, cy] } = await makeHousehold(["Ann", "Bo", "Cy"]);
    ok(await bo.client.rpc("update_my_settings", { p_household_id: household.id, p_visibility: true, p_answer_mode: "auto_when_confident" }));
    ok(await cy.client.rpc("update_my_settings", { p_household_id: household.id, p_visibility: true, p_answer_mode: "always_auto" }));
    const all = [0, 1, 2, 3, 4, 5, 6];
    ok(await cy.client.from("away_blocks").insert([
      { household_id: household.id, user_id: cy.id, days_of_week: all, start_local: "00:00", end_local: "12:00" },
      { household_id: household.id, user_id: cy.id, days_of_week: all, start_local: "12:00", end_local: "00:00" },
    ]));

    const r = await ask(owner, { householdId: household.id, target: "everyone", text: "will anyone be home at 9" });

    expect(r.status).toBe(200);
    const byUser = Object.fromEntries(r.body.targets.map((t: { userId: string; status: string; text: string }) => [t.userId, t]));
    expect(byUser[ann.id]).toEqual({ userId: ann.id, status: "unknown", text: "Ann: unknown" });
    expect(byUser[bo.id]).toEqual({ userId: bo.id, status: "awaiting_reply", text: "Asked Bo — waiting for a reply." });
    expect(byUser[cy.id]).toEqual({ userId: cy.id, status: "answered", text: FAKE_AWAY_AT });
    const statuses = ok(await admin.from("question_targets").select("user_id, status").eq("question_id", r.body.questionId));
    expect(statuses).toHaveLength(3);
  });

  it("targeting a non-member id -> 400", async () => {
    const { household, owner } = await makeHousehold(["Sam"]);
    const stranger = await newUser("Stranger");
    const r = await ask(owner, { householdId: household.id, target: { userIds: [stranger.id] }, text: "is Stranger home" });
    expect(r.status).toBe(400);
  });

  it("targeting yourself -> 400; everyone with no co-members -> 400 no_targets", async () => {
    const { household, owner } = await makeHousehold();
    expect((await ask(owner, { householdId: household.id, target: { userIds: [owner.id] }, text: "am I home" })).status).toBe(400);
    const r = await ask(owner, { householdId: household.id, target: "everyone", text: "anyone home" });
    expect(r).toMatchObject({ status: 400, body: { error: "no_targets" } });
  });

  it("a household the caller isn't in -> 403, and nothing is written", async () => {
    const { household, members: [sam] } = await makeHousehold(["Sam"]);
    const outsider = await newUser("Out");
    const r = await ask(outsider, { householdId: household.id, target: { userIds: [sam.id] }, text: "is Sam home" });
    expect(r.status).toBe(403);
    expect(ok(await admin.from("questions").select().eq("household_id", household.id))).toEqual([]);
  });

  it("invalid body -> 400, wrong method -> 405, no JWT -> 401", async () => {
    const { household, owner, members: [sam] } = await makeHousehold(["Sam"]);
    expect((await ask(owner, { householdId: household.id, target: { userIds: [sam.id] }, text: "" })).status).toBe(400);
    expect((await ask(owner, "not json")).status).toBe(400);
    expect((await call("ask", await token(owner), undefined, "GET")).status).toBe(405);
    expect((await call("ask", null, { householdId: household.id, target: "everyone", text: "hi" })).status).toBe(401);
  });
});

describe("ask limits (finding 3)", () => {
  const admit = (userId: string, perHour: number, perDay = 1_000, globalPerDay = 1_000_000) =>
    admin.rpc("admit_ask", { p_user_id: userId, p_per_hour: perHour, p_per_day: perDay, p_global_per_day: globalPerDay });

  it("admit_ask: ok until the hour or day is full; rejected attempts are not recorded; busy past the global cap", async () => {
    const user = await newUser("Limited");
    expect([ok(await admit(user.id, 2)), ok(await admit(user.id, 2)), ok(await admit(user.id, 2))]).toEqual(["ok", "ok", "rate_limited"]);
    expect(ok(await admit(user.id, 3))).toBe("ok"); // the rejected third attempt didn't count
    expect(ok(await admit(user.id, 100, 4))).toBe("rate_limited"); // day full
    expect(ok(await admit((await newUser("Fresh")).id, 100, 100, 0))).toBe("busy");
  });

  it("admit_ask: parallel calls can't overshoot the per-user limit", async () => {
    const user = await newUser("Burst");
    const verdicts = await Promise.all(Array.from({ length: 10 }, async () => ok(await admit(user.id, 3))));
    expect(verdicts.filter((v) => v === "ok")).toHaveLength(3);
  });

  it("admit_ask: users can't call it (they could use up someone else's quota)", async () => {
    const user = await newUser("Sneaky");
    const res = await user.client.rpc("admit_ask", { p_user_id: user.id, p_per_hour: 1, p_per_day: 1, p_global_per_day: 1 });
    expect(res.error?.code).toBe("42501");
  });

  it(`ask: once the asker's hour is full (${ASK_LIMITS.perHour}) -> 429 rate_limited before any model call or write`, async () => {
    const { household, owner, members: [sam] } = await makeHousehold(["Sam"]);
    for (let i = 0; i < ASK_LIMITS.perHour; i++) expect(ok(await admit(owner.id, ASK_LIMITS.perHour))).toBe("ok");

    const r = await ask(owner, { householdId: household.id, target: { userIds: [sam.id] }, text: "is Sam home" });

    expect(r).toEqual({ status: 429, body: { error: "rate_limited" } });
    expect(ok(await admin.from("questions").select().eq("household_id", household.id))).toEqual([]);
    // Sam's own quota is separate.
    expect((await ask(sam, { householdId: household.id, target: { userIds: [owner.id] }, text: "is Owner home" })).status).toBe(200);
  });
});

describe("reply", () => {
  it("approve -> sent response with feedback approved, status replied, prediction agent_approved; a second reply -> 409", async () => {
    const { owner, sam, qt } = await escalatedQuestion();

    const r = await reply(sam, { questionTargetId: qt.id, action: "approve" });

    expect(r).toEqual({ status: 200, body: { status: "replied" } });
    const sent = ok(await owner.client.from("responses").select().eq("question_target_id", qt.id));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ visibility: "sent", source: "human", text: FAKE_AWAY_AT, feedback: "approved" });
    expect(ok(await owner.client.from("question_targets").select("status").eq("id", qt.id).single()).status).toBe("replied");
    const pred = ok(await admin.from("predictions").select().eq("question_target_id", qt.id).single());
    expect(pred).toMatchObject({ user_id: sam.id, kind: "at_time", predicted_state: "away", source: "agent_approved", outcome: null });

    expect((await reply(sam, { questionTargetId: qt.id, action: "yes" })).status).toBe(409);
  });

  it("a quick reply sends the fixed word and logs no prediction", async () => {
    const { owner, sam, qt } = await escalatedQuestion();
    expect((await reply(sam, { questionTargetId: qt.id, action: "not_sure" })).status).toBe(200);
    const sent = ok(await owner.client.from("responses").select().eq("question_target_id", qt.id));
    expect(sent).toMatchObject([{ text: "Not sure", feedback: null }]);
    expect(ok(await admin.from("predictions").select().eq("question_target_id", qt.id))).toEqual([]);
  });

  it("by a non-target -> 403", async () => {
    const { owner, qt } = await escalatedQuestion();
    expect((await reply(owner, { questionTargetId: qt.id, action: "yes" })).status).toBe(403);
    expect(ok(await admin.from("question_targets").select("status").eq("id", qt.id).single()).status).toBe("awaiting_reply");
  });

  it("invalid body -> 400 (text without action 'text')", async () => {
    const { sam, qt } = await escalatedQuestion();
    expect((await reply(sam, { questionTargetId: qt.id, action: "yes", text: "sure" })).status).toBe(400);
  });
});

describe("score", () => {
  it("rejects a normal user with 403", async () => {
    const user = await newUser("Nosy");
    expect((await call("score", await token(user), {})).status).toBe(403);
    expect((await call("score", null, {})).status).toBe(403);
  });

  it("marks a past at_time prediction correct from presence events", async () => {
    const { household, owner, members: [sam] } = await makeHousehold(["Sam"]);
    ok(await admin.from("presence_events").insert({ household_id: household.id, user_id: sam.id, kind: "enter", at: minutesAgo(180) }));
    const question = ok(await admin.from("questions")
      .insert({ household_id: household.id, asker_id: owner.id, text: "home at 7?", kind: "at_time" }).select().single());
    const qt = ok(await admin.from("question_targets")
      .insert({ question_id: question.id, user_id: sam.id, status: "answered" }).select().single());
    const pred = ok(await admin.from("predictions").insert({
      question_target_id: qt.id, user_id: sam.id, kind: "at_time", about_time: minutesAgo(60),
      predicted_state: "home", confidence: "medium", source: "agent_auto", created_at: minutesAgo(120),
    }).select().single());

    const r = await call("score", SERVICE_ROLE_KEY, {});

    expect(r.status).toBe(200);
    expect(r.body.scored).toBeGreaterThanOrEqual(1);
    const after = ok(await admin.from("predictions").select().eq("id", pred.id).single());
    expect(after.outcome).toBe("correct");
    expect(after.scored_at).not.toBeNull();
  });

  it("anchors a late-approved until_when prediction at question time, not approval time (I2)", async () => {
    const { household, owner, members: [sam] } = await makeHousehold(["Sam"]);
    ok(await admin.from("presence_events").insert([
      { household_id: household.id, user_id: sam.id, kind: "exit", at: minutesAgo(180) },
      { household_id: household.id, user_id: sam.id, kind: "enter", at: minutesAgo(50) }, // arrived before Sam approved
    ]));
    const question = ok(await admin.from("questions").insert({
      household_id: household.id, asker_id: owner.id, text: "when are you back?", kind: "until_when", created_at: minutesAgo(120),
    }).select().single());
    const qt = ok(await admin.from("question_targets")
      .insert({ question_id: question.id, user_id: sam.id, status: "replied", created_at: minutesAgo(120) }).select().single());
    const pred = ok(await admin.from("predictions").insert({
      question_target_id: qt.id, user_id: sam.id, kind: "until_when", predicted_state: "away", predicted_time: minutesAgo(40),
      confidence: "medium", source: "agent_approved", created_at: minutesAgo(45),
    }).select().single());

    expect((await call("score", SERVICE_ROLE_KEY, {})).status).toBe(200);

    expect(ok(await admin.from("predictions").select("outcome").eq("id", pred.id).single()).outcome).toBe("correct");
  });

  it("scores from the latest event before the 48 h window when the window has no state-setting event (M1)", async () => {
    const { household, owner, members: [sam] } = await makeHousehold(["Sam"]);
    ok(await admin.from("presence_events").insert([
      { household_id: household.id, user_id: sam.id, kind: "enter", at: minutesAgo(60 * 60) }, // home since 60 h ago
      { household_id: household.id, user_id: sam.id, kind: "exit", at: minutesAgo(10) },
    ]));
    const question = ok(await admin.from("questions")
      .insert({ household_id: household.id, asker_id: owner.id, text: "home at 1?", kind: "at_time" }).select().single());
    const qt = ok(await admin.from("question_targets")
      .insert({ question_id: question.id, user_id: sam.id, status: "answered", created_at: minutesAgo(180) }).select().single());
    const pred = ok(await admin.from("predictions").insert({
      question_target_id: qt.id, user_id: sam.id, kind: "at_time", about_time: minutesAgo(60),
      predicted_state: "home", confidence: "medium", source: "agent_auto", created_at: minutesAgo(180),
    }).select().single());

    expect((await call("score", SERVICE_ROLE_KEY, {})).status).toBe(200);

    expect(ok(await admin.from("predictions").select("outcome").eq("id", pred.id).single()).outcome).toBe("correct");
  });

  it("leaves a not-yet-due at_time prediction unscored when the member has no recent events", async () => {
    const { household, owner, members: [sam] } = await makeHousehold(["Sam"]);
    const question = ok(await admin.from("questions")
      .insert({ household_id: household.id, asker_id: owner.id, text: "home at 9?", kind: "at_time" }).select().single());
    const qt = ok(await admin.from("question_targets")
      .insert({ question_id: question.id, user_id: sam.id, status: "answered" }).select().single());
    const pred = ok(await admin.from("predictions").insert({
      question_target_id: qt.id, user_id: sam.id, kind: "at_time", about_time: new Date(Date.now() + 2 * 3_600_000).toISOString(),
      predicted_state: "away", confidence: "medium", source: "agent_auto",
    }).select().single());

    expect((await call("score", SERVICE_ROLE_KEY, {})).status).toBe(200);

    const after = ok(await admin.from("predictions").select().eq("id", pred.id).single());
    expect(after).toMatchObject({ outcome: null, scored_at: null });
  });
});
