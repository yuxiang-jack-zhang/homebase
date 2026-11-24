import { describe, expect, it } from "vitest";
import { admin, makeHousehold, makeQuestion, newUser, ok, requestJoin, type TestUser } from "./helpers.ts";

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

async function addPresence(user: TestUser, householdId: string, kind: "enter" | "exit", at?: string) {
  ok(await user.client.from("presence_events").insert({ household_id: householdId, user_id: user.id, kind, ...(at ? { at } : {}) }));
}

async function memberRows(householdId: string) {
  return ok(await admin.from("household_members").select("user_id, role, status").eq("household_id", householdId));
}

/** A household (owner + `names`, all active) and one fresh user whose request to join is pending. */
async function withPending(names: string[] = []) {
  const h = await makeHousehold(names);
  const pending = await newUser("Pat");
  expect(await requestJoin(pending, h.household.invite_code)).toEqual({ id: h.household.id, name: "Test home" });
  return { ...h, hid: h.household.id, pending };
}

describe("pending members", () => {
  it("see only the household name and owner: no location, code, members, presence or stats; can't confirm home or report presence", async () => {
    const { hid, owner, members: [mia], pending } = await withPending(["Mia"]);
    await addPresence(owner, hid, "enter", minutesAgo(5));
    const c = pending.client;

    expect(ok(await c.rpc("my_pending_households"))).toEqual([{ id: hid, name: "Test home", owner_name: "Owner" }]);
    expect(ok(await c.from("households").select().eq("id", hid))).toEqual([]);
    expect(ok(await c.from("household_members").select("user_id, status").eq("household_id", hid)))
      .toEqual([{ user_id: pending.id, status: "pending" }]); // only their own row
    expect(ok(await c.from("presence_events").select().eq("household_id", hid))).toEqual([]);
    expect(ok(await c.from("current_presence").select().eq("household_id", hid))).toEqual([]);
    expect(ok(await c.from("profiles").select("id").in("id", [owner.id, mia.id]))).toEqual([]);
    expect((await c.rpc("household_accuracy", { p_household_id: hid })).error?.message).toBe("not_member");
    expect((await c.rpc("confirm_home", { p_household_id: hid })).error?.message).toBe("not_member");
    expect((await c.from("presence_events").insert({ household_id: hid, user_id: pending.id, kind: "enter" })).error?.code).toBe("42501");
    // Not a co-member for anyone else either.
    expect(ok(await mia.client.rpc("my_pending_households"))).toEqual([]);
  });

  it("the owner sees the request (and the asker's name); approve makes them active from now, and presence before that stays hidden", async () => {
    const { hid, owner, pending } = await withPending();
    await addPresence(owner, hid, "exit", minutesAgo(30)); // before approval
    expect(ok(await owner.client.from("household_members").select("user_id, status").eq("user_id", pending.id)))
      .toEqual([{ user_id: pending.id, status: "pending" }]);
    expect(ok(await owner.client.from("profiles").select("display_name").eq("id", pending.id))).toEqual([{ display_name: "Pat" }]);

    ok(await owner.client.rpc("approve_member", { p_household_id: hid, p_user_id: pending.id }));
    const row = ok(await admin.from("household_members").select("status, joined_at").eq("household_id", hid).eq("user_id", pending.id).single());
    expect(row.status).toBe("active");
    expect(Date.now() - Date.parse(row.joined_at!)).toBeLessThan(60_000);
    await addPresence(owner, hid, "enter"); // after approval

    const c = pending.client;
    expect(ok(await c.from("households").select("home_lat, invite_code").eq("id", hid))).toHaveLength(1);
    expect(ok(await c.from("household_members").select().eq("household_id", hid))).toHaveLength(2);
    expect(ok(await c.from("presence_events").select("kind").eq("user_id", owner.id))).toEqual([{ kind: "enter" }]);
    expect(ok(await c.from("current_presence").select("kind").eq("user_id", owner.id))).toEqual([{ kind: "enter" }]);
    expect(ok(await c.rpc("my_pending_households"))).toEqual([]);
    // The owner still sees all of their own history.
    expect(ok(await owner.client.from("presence_events").select().eq("user_id", owner.id))).toHaveLength(2);
  });

  it("only the owner approves or declines; decline deletes the request; a missing request is no_request", async () => {
    const { hid, owner, members: [mia], pending } = await withPending(["Mia"]);
    const args = { p_household_id: hid, p_user_id: pending.id };

    expect((await mia.client.rpc("approve_member", args)).error?.message).toBe("not_owner");
    expect((await mia.client.rpc("decline_member", args)).error?.message).toBe("not_owner");
    expect((await pending.client.rpc("approve_member", args)).error?.message).toBe("not_owner");
    expect((await owner.client.rpc("approve_member", { p_household_id: hid, p_user_id: mia.id })).error?.message).toBe("no_request");

    ok(await owner.client.rpc("decline_member", args));
    expect((await memberRows(hid)).map((m) => m.user_id)).not.toContain(pending.id);
    expect((await owner.client.rpc("approve_member", args)).error?.message).toBe("no_request");
    expect(ok(await pending.client.rpc("my_pending_households"))).toEqual([]);
  });

  it("a pending member can cancel their request with leave_household", async () => {
    const { hid, pending } = await withPending();
    ok(await pending.client.rpc("leave_household", { p_household_id: hid }));
    expect((await memberRows(hid)).map((m) => m.user_id)).not.toContain(pending.id);
  });
});

describe("remove_member", () => {
  it("owner removes a member: their presence and away blocks there are deleted and they lose access", async () => {
    const { household, owner, members: [mia, leo] } = await makeHousehold(["Mia", "Leo"]);
    const hid = household.id;
    await addPresence(mia, hid, "enter", minutesAgo(5));
    ok(await mia.client.from("away_blocks").insert({ household_id: hid, user_id: mia.id, days_of_week: [1], start_local: "09:00", end_local: "17:00" }));

    expect((await leo.client.rpc("remove_member", { p_household_id: hid, p_user_id: mia.id })).error?.message).toBe("not_owner");
    expect((await owner.client.rpc("remove_member", { p_household_id: hid, p_user_id: owner.id })).error?.message).toBe("cannot_remove_self");
    ok(await owner.client.rpc("remove_member", { p_household_id: hid, p_user_id: mia.id }));
    expect((await owner.client.rpc("remove_member", { p_household_id: hid, p_user_id: mia.id })).error?.message).toBe("not_member");

    expect((await memberRows(hid)).map((m) => m.user_id).sort()).toEqual([owner.id, leo.id].sort());
    expect(ok(await admin.from("presence_events").select().eq("household_id", hid).eq("user_id", mia.id))).toEqual([]);
    expect(ok(await admin.from("away_blocks").select().eq("household_id", hid).eq("user_id", mia.id))).toEqual([]);
    expect(ok(await mia.client.from("households").select().eq("id", hid))).toEqual([]);
    expect(ok(await mia.client.from("household_members").select().eq("household_id", hid))).toEqual([]);
  });
});

describe("leave_household", () => {
  it("a member leaves: their row, presence and blocks go; the rest stays", async () => {
    const { household, owner, members: [mia] } = await makeHousehold(["Mia"]);
    const hid = household.id;
    await addPresence(mia, hid, "enter", minutesAgo(5));
    ok(await mia.client.rpc("leave_household", { p_household_id: hid }));

    expect(await memberRows(hid)).toEqual([{ user_id: owner.id, role: "owner", status: "active" }]);
    expect(ok(await admin.from("presence_events").select().eq("user_id", mia.id))).toEqual([]);
    expect((await mia.client.rpc("leave_household", { p_household_id: hid })).error?.message).toBe("not_member");
  });

  it("the owner leaves: the earliest-joined active member becomes owner (never a pending one)", async () => {
    const { household, owner, members: [mia, leo] } = await makeHousehold(["Mia", "Leo"]);
    const hid = household.id;
    ok(await admin.from("household_members").update({ joined_at: "1999-01-01T00:00:00Z" }).eq("household_id", hid).eq("user_id", leo.id));
    const pat = await newUser("Pat");
    await requestJoin(pat, household.invite_code);

    ok(await owner.client.rpc("leave_household", { p_household_id: hid }));

    const rows = await memberRows(hid);
    expect(rows.find((m) => m.user_id === leo.id)?.role).toBe("owner");
    expect(rows.find((m) => m.user_id === mia.id)?.role).toBe("member");
    expect(rows.map((m) => m.user_id)).not.toContain(owner.id);
    ok(await leo.client.rpc("approve_member", { p_household_id: hid, p_user_id: pat.id }));
  });

  it("the last active member leaves: the household and its questions are deleted", async () => {
    const { household, owner, members: [mia] } = await makeHousehold(["Mia"]);
    const hid = household.id;
    const { questionId } = await makeQuestion(hid, owner, mia);
    ok(await mia.client.rpc("leave_household", { p_household_id: hid }));
    const pat = await newUser("Pat");
    await requestJoin(pat, household.invite_code);

    ok(await owner.client.rpc("leave_household", { p_household_id: hid }));

    expect(ok(await admin.from("households").select().eq("id", hid))).toEqual([]);
    expect(ok(await admin.from("household_members").select().eq("household_id", hid))).toEqual([]);
    expect(ok(await admin.from("questions").select().eq("id", questionId))).toEqual([]);
  });
});

describe("rotate_invite_code", () => {
  it("owner only; the old code stops working and the new one works", async () => {
    const { household, owner, members: [mia] } = await makeHousehold(["Mia"]);
    const hid = household.id;
    expect((await mia.client.rpc("rotate_invite_code", { p_household_id: hid })).error?.message).toBe("not_owner");

    const code = ok(await owner.client.rpc("rotate_invite_code", { p_household_id: hid }));
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(code).not.toBe(household.invite_code);
    expect(ok(await admin.from("households").select("invite_code").eq("id", hid).single()).invite_code).toBe(code);

    expect(await requestJoin(await newUser("Old"), household.invite_code)).toEqual({ error: "invalid_invite_code" });
    expect(await requestJoin(await newUser("New"), code)).toMatchObject({ id: hid });
  });
});

describe("join_household rate limit", () => {
  it("5 failed codes per hour are allowed and recorded; the 6th attempt, even with a valid code, is rate_limited", async () => {
    const { household } = await makeHousehold();
    const guesser = await newUser("Guess");
    for (let i = 0; i < 5; i++) {
      expect(await requestJoin(guesser, `BAD00${i}`)).toEqual({ error: "invalid_invite_code" });
    }
    // The failures were returned, not raised, so each attempt committed.
    expect(ok(await admin.from("join_attempts").select("user_id").eq("user_id", guesser.id))).toHaveLength(5);

    const sixth = await guesser.client.rpc("join_household", { p_invite_code: household.invite_code });
    expect(sixth.error?.message).toBe("rate_limited");
    expect((await memberRows(household.id)).map((m) => m.user_id)).not.toContain(guesser.id);

    // Another user is unaffected; a successful join records no failure.
    const other = await newUser("Other");
    expect(await requestJoin(other, household.invite_code)).toMatchObject({ id: household.id });
    expect(ok(await admin.from("join_attempts").select().eq("user_id", other.id))).toEqual([]);
  });

  it("attempts older than an hour don't count", async () => {
    const guesser = await newUser("Guess");
    for (let i = 0; i < 5; i++) await requestJoin(guesser, `BAD00${i}`);
    ok(await admin.from("join_attempts").update({ at: minutesAgo(61) }).eq("user_id", guesser.id));
    expect(await requestJoin(guesser, "BAD009")).toEqual({ error: "invalid_invite_code" });
  });
});

describe("account deletion", () => {
  it("a member's account deletes cleanly: membership, presence, questions they asked and were asked go", async () => {
    const { household, owner, members: [mia] } = await makeHousehold(["Mia"]);
    const hid = household.id;
    await addPresence(mia, hid, "enter", minutesAgo(5));
    const asked = await makeQuestion(hid, mia, owner);
    const about = await makeQuestion(hid, owner, mia);
    ok(await admin.from("predictions").insert({
      question_target_id: about.questionTargetId, user_id: mia.id, kind: "at_time", confidence: "medium", source: "agent_auto",
    }));

    expect((await admin.auth.admin.deleteUser(mia.id)).error).toBeNull();

    expect(ok(await admin.from("profiles").select().eq("id", mia.id))).toEqual([]);
    expect(await memberRows(hid)).toEqual([{ user_id: owner.id, role: "owner", status: "active" }]);
    expect(ok(await admin.from("presence_events").select().eq("user_id", mia.id))).toEqual([]);
    expect(ok(await admin.from("questions").select().eq("id", asked.questionId))).toEqual([]);
    expect(ok(await admin.from("question_targets").select().eq("id", about.questionTargetId))).toEqual([]);
    expect(ok(await admin.from("predictions").select().eq("user_id", mia.id))).toEqual([]);
  });

  it("an owner's account deletes cleanly: ownership passes on, or the household goes if they were alone", async () => {
    const shared = await makeHousehold(["Mia"]);
    const solo = await makeHousehold();
    const owner = shared.owner;
    ok(await admin.from("household_members").delete().eq("household_id", solo.household.id)); // reuse one user for both
    ok(await admin.from("household_members").insert({ household_id: solo.household.id, user_id: owner.id, role: "owner" }));

    expect((await admin.auth.admin.deleteUser(owner.id)).error).toBeNull();

    expect(await memberRows(shared.household.id)).toEqual([{ user_id: shared.members[0].id, role: "owner", status: "active" }]);
    expect(ok(await admin.from("households").select("created_by").eq("id", shared.household.id).single()).created_by).toBeNull();
    expect(ok(await admin.from("households").select().eq("id", solo.household.id))).toEqual([]);
  });
});
