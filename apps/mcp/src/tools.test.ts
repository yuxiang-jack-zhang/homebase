import { FunctionsFetchError, FunctionsHttpError } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { makeTools, type Client } from "./tools.ts";

const ME = "00000000-0000-4000-8000-000000000001";
const SAM = "00000000-0000-4000-8000-000000000002";
const SAM2 = "00000000-0000-4000-8000-000000000003";
const ANN = "00000000-0000-4000-8000-000000000004";
const HOME = "10000000-0000-4000-8000-000000000001";
const QT = "20000000-0000-4000-8000-000000000001";
const AT = "2026-11-24T02:05:00Z"; // 6:05 PM in Los Angeles

/** A supabase-js stand-in: every query on a table resolves to its fixture rows (the filters are the DB's job). */
function fake(tables: Record<string, unknown[]>, invoke = vi.fn()) {
  const query = (rows: unknown[]) => {
    const q: Record<string, unknown> = { then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(ok) };
    for (const m of ["select", "eq", "order", "limit"]) q[m] = () => q;
    return q;
  };
  const client = { from: (t: string) => query(tables[t] ?? []), functions: { invoke } } as unknown as Client;
  return { tools: makeTools(client, ME), invoke };
}

const base = {
  households: [{ id: HOME, name: "Elm St", timezone: "America/Los_Angeles" }],
  household_members: [{ user_id: ME }, { user_id: SAM }, { user_id: ANN }],
  profiles: [{ id: ME, display_name: "Jack" }, { id: SAM, display_name: "Sam Lee" }, { id: ANN, display_name: "Ann" }],
};
const httpError = (status: number, error: string) => new FunctionsHttpError(new Response(JSON.stringify({ error }), { status }));

describe("households", () => {
  it("lists them; defaults to the only one; asks which when there are several", async () => {
    const one = fake(base).tools;
    expect(await one.list_households()).toBe("Elm St");
    expect(await one.whos_home({})).toContain("Sam Lee");

    const two = fake({ ...base, households: [...base.households, { id: "x", name: "Lake House", timezone: "UTC" }] }).tools;
    await expect(two.whos_home({})).rejects.toThrow("Which household? You're in: Elm St, Lake House.");
    await expect(two.whos_home({ household: "nope" })).rejects.toThrow('No household called "nope". You\'re in: Elm St, Lake House.');
    expect(await two.whos_home({ household: "elm st" })).toContain("Sam Lee");
    await expect(fake({ ...base, households: [] }).tools.list_households()).resolves.toBe("You're not in any household yet.");
  });
});

describe("whos_home", () => {
  it("shows last reported home/away in the household's time zone, and members who share nothing", async () => {
    const { tools } = fake({ ...base, current_presence: [{ user_id: SAM, kind: "enter", at: AT }, { user_id: ME, kind: "exit", at: AT }] });
    expect(await tools.whos_home({})).toBe([
      "Jack (you): away since Nov 23, 6:05 PM PST",
      "Sam Lee: home since Nov 23, 6:05 PM PST",
      "Ann: not shared",
    ].join("\n"));
  });
});

describe("ask", () => {
  const answered = { questionId: QT, targets: [{ userId: SAM, status: "answered", text: "Sam is probably home." }] };

  it("maps full or first names (any case) to ids and returns each target's text", async () => {
    const { tools, invoke } = fake(base, vi.fn().mockResolvedValue({ data: answered, error: null }));
    expect(await tools.ask({ who: ["sam"], question: "is Sam home" })).toBe("Sam is probably home.");
    expect(invoke).toHaveBeenCalledWith("ask", { body: { householdId: HOME, target: { userIds: [SAM] }, text: "is Sam home" } });
    await tools.ask({ who: ["Sam Lee", "ANN"], question: "home?" });
    expect(invoke.mock.calls[1][1].body.target).toEqual({ userIds: [SAM, ANN] });
  });

  it('"everyone" asks the whole household', async () => {
    const { tools, invoke } = fake(base, vi.fn().mockResolvedValue({ data: answered, error: null }));
    await tools.ask({ who: ["Everyone"], question: "anyone home" });
    expect(invoke.mock.calls[0][1].body.target).toBe("everyone");
  });

  it("refuses unknown, ambiguous and own names without calling the server", async () => {
    const twoSams = fake({ ...base, household_members: [...base.household_members, { user_id: SAM2 }],
      profiles: [...base.profiles, { id: SAM2, display_name: "Sam Park" }] });
    await expect(twoSams.tools.ask({ who: ["Bob"], question: "home?" })).rejects.toThrow('No one called "Bob" in Elm St. Members: Sam Lee, Ann, Sam Park.');
    await expect(twoSams.tools.ask({ who: ["sam"], question: "home?" })).rejects.toThrow('More than one "sam": Sam Lee, Sam Park. Use the full name.');
    await expect(twoSams.tools.ask({ who: ["Jack"], question: "home?" })).rejects.toThrow("You can't ask about yourself.");
    await expect(twoSams.tools.ask({ who: ["Ann"], question: "x".repeat(281) })).rejects.toThrow("1 to 280 characters");
    expect(twoSams.invoke).not.toHaveBeenCalled();
  });

  it("turns server error codes into plain messages", async () => {
    const err = async (error: unknown) => fake(base, vi.fn().mockResolvedValue({ data: null, error })).tools.ask({ who: ["Ann"], question: "home?" });
    await expect(err(httpError(429, "rate_limited"))).rejects.toThrow("You've asked too many questions (limit 30 an hour, 200 a day). Try again later.");
    await expect(err(httpError(503, "busy"))).rejects.toThrow("Homebase is busy right now. Try again later.");
    await expect(err(httpError(500, "something_new"))).rejects.toThrow("Homebase error: something_new");
    await expect(err(new FunctionsFetchError("boom"))).rejects.toThrow("Couldn't reach Homebase.");
  });

  it("rejects a malformed server response", async () => {
    const { tools } = fake(base, vi.fn().mockResolvedValue({ data: { nope: 1 }, error: null }));
    await expect(tools.ask({ who: ["Ann"], question: "home?" })).rejects.toThrow("unexpected response");
  });
});

describe("my_inbox", () => {
  it("lists questions awaiting my reply with the suggested answer, or says there are none", async () => {
    const { tools } = fake({ ...base, question_targets: [
      { id: QT, created_at: AT, questions: { text: "home at 9?", asker_id: SAM }, responses: [{ visibility: "draft", text: "Probably away at 9." }] },
      { id: "q2", created_at: AT, questions: { text: "dinner?", asker_id: ANN }, responses: [] },
    ] });
    expect(await tools.my_inbox()).toBe([
      `[${QT}] Sam Lee asked: "home at 9?"`, "  Suggested answer: Probably away at 9.",
      `[q2] Ann asked: "dinner?"`, "  No suggested answer.",
    ].join("\n"));
    expect(await fake(base).tools.my_inbox()).toBe("Nothing is waiting for your reply.");
  });
});

describe("reply", () => {
  it("sends a valid reply through the function", async () => {
    const { tools, invoke } = fake(base, vi.fn().mockResolvedValue({ data: { status: "replied" }, error: null }));
    expect(await tools.reply({ question_id: QT, answer: "text", text: "back at 10" })).toBe("Reply sent.");
    expect(invoke).toHaveBeenCalledWith("reply", { body: { questionTargetId: QT, action: "text", text: "back at 10" } });
  });

  it("checks the request first and maps server codes", async () => {
    const { tools, invoke } = fake(base, vi.fn().mockResolvedValue({ data: null, error: httpError(409, "not_awaiting_reply") }));
    await expect(tools.reply({ question_id: QT, answer: "yes", text: "extra" })).rejects.toThrow("text only with answer \"text\"");
    await expect(tools.reply({ question_id: "abc", answer: "yes" })).rejects.toThrow("question_id must be an id from my_inbox");
    expect(invoke).not.toHaveBeenCalled();
    await expect(tools.reply({ question_id: QT, answer: "yes" })).rejects.toThrow("That question was already answered.");
  });
});

describe("my_questions", () => {
  it("shows each target's latest sent answer, the fallback guess, or that it's waiting", async () => {
    const t = (user_id: string, status: string, extra = {}) => ({ id: user_id, user_id, status, created_at: AT, target_guesses: null, responses: [], ...extra });
    const { tools } = fake({ ...base, questions: [{ id: "q", text: "anyone home", created_at: AT, question_targets: [
      t(SAM, "replied", { responses: [
        { visibility: "sent", text: "old", created_at: "2026-11-24T02:06:00Z" },
        { visibility: "sent", text: "Yes", created_at: "2026-11-24T02:07:00Z" },
        { visibility: "draft", text: "draft", created_at: "2026-11-24T02:08:00Z" },
      ] }),
      t(ANN, "awaiting_reply", { target_guesses: { guess: "Ann is probably away." } }),
      t(SAM2, "awaiting_reply"),
      t(ME, "unknown"),
    ] }] });
    expect(await tools.my_questions({})).toBe([
      '"anyone home" (Nov 23, 6:05 PM PST)',
      "  Sam Lee: Yes",
      "  Ann: no reply yet. Best guess: Ann is probably away.",
      "  Roommate: waiting for a reply.",
      "  Jack: unknown",
    ].join("\n"));
    expect(await fake(base).tools.my_questions({})).toBe("You haven't asked anything in Elm St yet.");
  });
});
