import { describe, expect, it } from "vitest";
import { admin, joinHousehold, makeHousehold, makeQuestion, newUser, ok, type TestUser } from "./helpers.ts";

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

async function addPresence(user: TestUser, householdId: string, kind: "enter" | "exit" = "enter", at = minutesAgo(5)) {
  ok(await user.client.from("presence_events").insert({ household_id: householdId, user_id: user.id, kind, at }));
}

describe("RLS", () => {
  it("household B member cannot see household A's households, members, presence, questions", async () => {
    const a = await makeHousehold(["Ana"]);
    const b = await makeHousehold();
    const [ana] = a.members;
    await addPresence(a.owner, a.household.id);
    await makeQuestion(a.household.id, a.owner, ana);
    const outsider = b.owner.client;
    const hid = a.household.id;

    expect(ok(await outsider.from("households").select().eq("id", hid))).toEqual([]);
    expect(ok(await outsider.from("household_members").select().eq("household_id", hid))).toEqual([]);
    expect(ok(await outsider.from("presence_events").select().eq("household_id", hid))).toEqual([]);
    expect(ok(await outsider.from("current_presence").select().eq("household_id", hid))).toEqual([]);
    expect(ok(await outsider.from("questions").select().eq("household_id", hid))).toEqual([]);
    expect(ok(await outsider.from("profiles").select().in("id", [a.owner.id, ana.id]))).toEqual([]);

    // Control: a member of A sees all of it, so the empty results above are RLS, not missing data.
    expect(ok(await ana.client.from("households").select().eq("id", hid))).toHaveLength(1);
    expect(ok(await ana.client.from("household_members").select().eq("household_id", hid))).toHaveLength(2);
    expect(ok(await ana.client.from("presence_events").select().eq("household_id", hid))).toHaveLength(1);
    expect(ok(await ana.client.from("questions").select().eq("household_id", hid))).toHaveLength(1);
    expect(ok(await ana.client.from("profiles").select().in("id", [a.owner.id, ana.id]))).toHaveLength(2);
  });

  it("user U in households A and B; C only in B: C cannot read U's presence events tagged with household A", async () => {
    const a = await makeHousehold();
    const b = await makeHousehold(["C"]);
    const u = a.owner;
    const [c] = b.members;
    await joinHousehold(u, b.household.invite_code);
    await addPresence(u, a.household.id, "exit");
    await addPresence(u, b.household.id, "enter");

    const seen = ok(await c.client.from("presence_events").select().eq("user_id", u.id));
    expect(seen.map((e) => e.household_id)).toEqual([b.household.id]);
    const current = ok(await c.client.from("current_presence").select().eq("user_id", u.id));
    expect(current.map((e) => e.household_id)).toEqual([b.household.id]);
    // U still sees both of their own.
    expect(ok(await u.client.from("presence_events").select().eq("user_id", u.id))).toHaveLength(2);
  });

  it("member cannot insert a presence event tagged with a household they don't belong to", async () => {
    const a = await makeHousehold();
    const b = await makeHousehold();
    const res = await a.owner.client.from("presence_events")
      .insert({ household_id: b.household.id, user_id: a.owner.id, kind: "enter" });
    expect(res.error?.code).toBe("42501"); // RLS WITH CHECK, which runs before the FK check
    expect(ok(await admin.from("presence_events").select().eq("household_id", b.household.id))).toEqual([]);
  });

  it("roommate cannot read presence of a member with visibility=false; that member can read their own", async () => {
    const h = await makeHousehold(["Hidden"]);
    const [hidden] = h.members;
    ok(await hidden.client.rpc("update_my_settings", {
      p_household_id: h.household.id, p_visibility: false, p_answer_mode: "ask_me",
    }));
    await addPresence(hidden, h.household.id);

    expect(ok(await h.owner.client.from("presence_events").select().eq("user_id", hidden.id))).toEqual([]);
    expect(ok(await hidden.client.from("presence_events").select().eq("user_id", hidden.id))).toHaveLength(1);
  });

  it("current_presence returns only visible members' latest state", async () => {
    const h = await makeHousehold(["Vis", "Hid"]);
    const [vis, hid] = h.members;
    ok(await hid.client.rpc("update_my_settings", {
      p_household_id: h.household.id, p_visibility: false, p_answer_mode: "ask_me",
    }));
    await addPresence(vis, h.household.id, "exit", minutesAgo(120));
    await addPresence(vis, h.household.id, "enter", minutesAgo(60));
    await addPresence(hid, h.household.id, "enter", minutesAgo(30));

    const rows = ok(await h.owner.client.from("current_presence").select().eq("household_id", h.household.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: vis.id, kind: "enter" });
  });

  it("roommate cannot read another member's away_blocks", async () => {
    const h = await makeHousehold(["Mia"]);
    const [mia] = h.members;
    const block = ok(await mia.client.from("away_blocks").insert({
      household_id: h.household.id, user_id: mia.id, days_of_week: [1, 2], start_local: "09:00", end_local: "17:00",
    }).select().single());
    const owner = h.owner.client;

    expect(ok(await owner.from("away_blocks").select().eq("user_id", mia.id))).toEqual([]);
    expect(ok(await mia.client.from("away_blocks").select().eq("user_id", mia.id))).toHaveLength(1);
    // Nor write them: update/delete touch 0 rows, insert-for-someone-else errors.
    expect(ok(await owner.from("away_blocks").update({ label: "hacked" }).eq("id", block.id).select())).toEqual([]);
    expect(ok(await owner.from("away_blocks").delete().eq("id", block.id).select())).toEqual([]);
    const ins = await owner.from("away_blocks").insert({
      household_id: h.household.id, user_id: mia.id, days_of_week: [3], start_local: "09:00", end_local: "10:00",
    });
    expect(ins.error).not.toBeNull();
    expect(ok(await admin.from("away_blocks").select().eq("user_id", mia.id))).toMatchObject([{ id: block.id, label: null }]);
  });

  it("member cannot insert a presence event for someone else", async () => {
    const h = await makeHousehold(["Mia"]);
    const [mia] = h.members;
    const res = await h.owner.client.from("presence_events")
      .insert({ household_id: h.household.id, user_id: mia.id, kind: "exit" });
    expect(res.error).not.toBeNull();
    expect(ok(await admin.from("presence_events").select().eq("user_id", mia.id))).toEqual([]);
  });

  it("member cannot insert presence before confirming home; can after confirm_home()", async () => {
    const h = await makeHousehold(["New"], { confirm: false });
    const [fresh] = h.members;
    const before = await fresh.client.from("presence_events")
      .insert({ household_id: h.household.id, user_id: fresh.id, kind: "enter" });
    expect(before.error).not.toBeNull();

    ok(await fresh.client.rpc("confirm_home", { p_household_id: h.household.id }));
    await addPresence(fresh, h.household.id);
    expect(ok(await admin.from("presence_events").select().eq("user_id", fresh.id))).toHaveLength(1);
  });

  it("member cannot update household_members directly (e.g. set role='owner') — error or 0 rows changed", async () => {
    const h = await makeHousehold(["Mia"]);
    const [mia] = h.members;
    const hid = h.household.id;

    const res = await mia.client.from("household_members").update({ role: "owner" })
      .eq("household_id", hid).eq("user_id", mia.id).select();
    expect(res.error !== null || res.data?.length === 0).toBe(true);
    const row = ok(await admin.from("household_members").select("role").eq("household_id", hid).eq("user_id", mia.id).single());
    expect(row.role).toBe("member");

    // No other direct write path: owner can't edit the household row, outsiders can't insert themselves.
    expect(ok(await h.owner.client.from("households").update({ home_lat: 0 }).eq("id", hid).select())).toEqual([]);
    const outsider = await newUser("Eve");
    const join = await outsider.client.from("household_members").insert({ household_id: hid, user_id: outsider.id });
    expect(join.error).not.toBeNull();
    const create = await outsider.client.from("households").insert({
      name: "x", invite_code: "ZZZZZZ", home_lat: 0, home_lng: 0, timezone: "UTC", created_by: outsider.id,
    });
    expect(create.error).not.toBeNull();
    expect(ok(await admin.from("household_members").select().eq("household_id", hid))).toHaveLength(2);
  });

  it("draft response readable by target, not by asker; sent response readable by both", async () => {
    const h = await makeHousehold(["Mia", "Zed"]);
    const [mia, zed] = h.members;
    const { questionId, questionTargetId } = await makeQuestion(h.household.id, h.owner, mia);
    const [draft, sent] = ok(await admin.from("responses").insert([
      { question_target_id: questionTargetId, source: "agent", visibility: "draft", text: "Back by 9" },
      { question_target_id: questionTargetId, source: "human", visibility: "sent", text: "Back by 10" },
    ]).select());

    const forTarget = ok(await mia.client.from("responses").select().eq("question_target_id", questionTargetId));
    expect(forTarget.map((r) => r.id).sort()).toEqual([draft.id, sent.id].sort());
    const forAsker = ok(await h.owner.client.from("responses").select().eq("question_target_id", questionTargetId));
    expect(forAsker.map((r) => r.id)).toEqual([sent.id]);

    // Asker and target see the question and target row; an uninvolved roommate sees none of it.
    for (const u of [h.owner, mia]) {
      expect(ok(await u.client.from("questions").select().eq("id", questionId))).toHaveLength(1);
      expect(ok(await u.client.from("question_targets").select().eq("id", questionTargetId))).toHaveLength(1);
    }
    expect(ok(await zed.client.from("questions").select().eq("id", questionId))).toEqual([]);
    expect(ok(await zed.client.from("question_targets").select().eq("id", questionTargetId))).toEqual([]);
    expect(ok(await zed.client.from("responses").select().eq("question_target_id", questionTargetId))).toEqual([]);
  });

  it("asker cannot read predictions about the target", async () => {
    const h = await makeHousehold(["Mia"]);
    const [mia] = h.members;
    const { questionTargetId } = await makeQuestion(h.household.id, h.owner, mia);
    ok(await admin.from("predictions").insert({
      question_target_id: questionTargetId, user_id: mia.id, kind: "at_time", about_time: minutesAgo(-60),
      predicted_state: "away", confidence: "medium", source: "agent_auto",
    }));

    expect(ok(await h.owner.client.from("predictions").select().eq("question_target_id", questionTargetId))).toEqual([]);
    expect(ok(await mia.client.from("predictions").select().eq("question_target_id", questionTargetId))).toHaveLength(1);
  });

  it("members cannot write questions, targets, responses or predictions directly (service role only)", async () => {
    const h = await makeHousehold(["Mia"]);
    const [mia] = h.members;
    const { questionId, questionTargetId } = await makeQuestion(h.household.id, h.owner, mia);
    const asker = h.owner.client;

    expect((await asker.from("questions").insert({ household_id: h.household.id, asker_id: h.owner.id, text: "hi" })).error).not.toBeNull();
    expect((await asker.from("question_targets").insert({ question_id: questionId, user_id: h.owner.id, status: "unknown" })).error).not.toBeNull();
    expect((await mia.client.from("responses").insert({ question_target_id: questionTargetId, source: "human", visibility: "sent", text: "yes" })).error).not.toBeNull();
    expect((await mia.client.from("predictions").insert({
      question_target_id: questionTargetId, user_id: mia.id, kind: "at_time", confidence: "high", source: "agent_auto",
    })).error).not.toBeNull();
    expect(ok(await mia.client.from("question_targets").update({ status: "replied" }).eq("id", questionTargetId).select())).toEqual([]);
    expect(ok(await asker.from("questions").delete().eq("id", questionId).select())).toEqual([]);

    expect(ok(await admin.from("questions").select().eq("household_id", h.household.id))).toHaveLength(1);
    expect(ok(await admin.from("question_targets").select("status").eq("question_id", questionId))).toEqual([{ status: "awaiting_reply" }]);
    expect(ok(await admin.from("responses").select().eq("question_target_id", questionTargetId))).toEqual([]);
    expect(ok(await admin.from("predictions").select().eq("question_target_id", questionTargetId))).toEqual([]);
  });

  it("question_targets.updated_at advances on update", async () => {
    const h = await makeHousehold(["Mia"]);
    const { questionTargetId } = await makeQuestion(h.household.id, h.owner, h.members[0]);
    const before = ok(await admin.from("question_targets").select("updated_at").eq("id", questionTargetId).single());
    const after = ok(await admin.from("question_targets").update({ status: "replied" }).eq("id", questionTargetId)
      .select("updated_at").single());
    expect(Date.parse(after.updated_at)).toBeGreaterThan(Date.parse(before.updated_at));
  });
});
