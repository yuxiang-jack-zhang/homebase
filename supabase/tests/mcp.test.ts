import { beforeAll, describe, expect, it } from "vitest";
import { makeTools } from "../../apps/mcp/src/tools.ts";
import { API_URL, makeHousehold, ok } from "./helpers.ts";

// The MCP tools on real signed-in users. Needs the functions served with the fake model; see README.md.
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

beforeAll(async () => {
  const res = await fetch(`${API_URL}/functions/v1/health`).catch(() => null);
  if (!res?.ok) throw new Error("Edge functions are not served. Run: npx supabase functions serve --env-file supabase/functions/.env.test");
});

describe("MCP tools", () => {
  it("whos_home shows visible members' presence and hides members who turned sharing off", async () => {
    const { household, owner, members: [sam, ann] } = await makeHousehold(["Sam", "Ann"]);
    ok(await sam.client.from("presence_events").insert({ household_id: household.id, user_id: sam.id, kind: "enter", at: minutesAgo(5) }));
    ok(await ann.client.from("presence_events").insert({ household_id: household.id, user_id: ann.id, kind: "exit", at: minutesAgo(5) }));
    ok(await ann.client.rpc("update_my_settings", { p_household_id: household.id, p_visibility: false, p_answer_mode: "ask_me" }));
    const tools = makeTools(owner.client, owner.id);

    expect(await tools.list_households()).toBe("Test home");
    const out = await tools.whos_home({});
    expect(out).toMatch(/^Sam: home since /m);
    expect(out).toContain("Ann: not shared");
    expect(out).toContain("Owner (you): no updates yet");
  });

  it("ask by name goes through the ask function and returns the asker's text", async () => {
    const { household, owner, members: [sam] } = await makeHousehold(["Sam"]);
    ok(await sam.client.from("presence_events").insert({ household_id: household.id, user_id: sam.id, kind: "enter", at: minutesAgo(5) }));
    const tools = makeTools(owner.client, owner.id);

    expect(await tools.ask({ who: ["sam"], question: "is Sam home" })).toBe("Fake model: home.");
    await expect(tools.ask({ who: ["Bob"], question: "is Bob home" })).rejects.toThrow('No one called "Bob"');
    expect(await tools.my_questions({})).toMatch(/^\(Text in «» .+\)\n«is Sam home» \(.+\)\n {2}Sam: «Fake model: home\.»$/);
  });

  it("a forwarded question shows in the target's inbox with the draft; approving it answers the asker", async () => {
    const { household, owner, members: [sam] } = await makeHousehold(["Sam"]);
    const all = [0, 1, 2, 3, 4, 5, 6];
    ok(await sam.client.from("away_blocks").insert([
      { household_id: household.id, user_id: sam.id, days_of_week: all, start_local: "00:00", end_local: "12:00" },
      { household_id: household.id, user_id: sam.id, days_of_week: all, start_local: "12:00", end_local: "00:00" },
    ]));
    const asker = makeTools(owner.client, owner.id);
    const target = makeTools(sam.client, sam.id);

    expect(await asker.ask({ who: ["Sam"], question: "will Sam be home at 9" })).toBe("Asked Sam — waiting for a reply.");
    expect(await asker.my_questions({})).toContain("  Sam: waiting for a reply.");

    const inbox = await target.my_inbox();
    expect(inbox).toMatch(/^\(Text in «» .+\)\n\[[0-9a-f-]{36}\] Owner asked: «will Sam be home at 9»\n {2}Suggested answer: Fake model: away at \d{1,2}:\d{2}\s[AP]M\.$/);
    const id = inbox.match(/^\[([0-9a-f-]{36})\]/m)![1];

    expect(await target.reply({ question_id: id, answer: "approve" })).toBe("Reply sent.");
    expect(await target.my_inbox()).toBe("Nothing is waiting for your reply.");
    await expect(target.reply({ question_id: id, answer: "yes" })).rejects.toThrow("already answered");
    expect(await asker.my_questions({})).toMatch(/ {2}Sam: «Fake model: away at \d{1,2}:\d{2}\s[AP]M\.»$/);
  });
});
