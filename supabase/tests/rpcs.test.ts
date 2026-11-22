import { describe, expect, it } from "vitest";
import { admin, joinHousehold, makeHousehold, makeQuestion, newUser, ok } from "./helpers.ts";

async function memberRow(householdId: string, userId: string) {
  return ok(await admin.from("household_members").select()
    .eq("household_id", householdId).eq("user_id", userId).single());
}

describe("RPCs", () => {
  it("create_household makes caller owner with home_confirmed_at set, returns a 6-char invite code from [A-HJ-NP-Z2-9]", async () => {
    const owner = await newUser("Olive");
    const household = ok(await owner.client.rpc("create_household", {
      p_name: "Flat 4", p_lat: 51.5, p_lng: -0.12, p_radius_m: 150, p_timezone: "Europe/London",
    }));
    expect(household).toMatchObject({ name: "Flat 4", home_lat: 51.5, home_lng: -0.12, home_radius_m: 150, created_by: owner.id });
    expect(household.invite_code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    const row = await memberRow(household.id, owner.id);
    expect(row.role).toBe("owner");
    expect(row.home_confirmed_at).not.toBeNull();
  });

  it("join_household with valid code adds member with visibility=true, answer_mode=ask_me, home_confirmed_at=null", async () => {
    const { household } = await makeHousehold();
    const joiner = await newUser("Jo");
    const joined = ok(await joiner.client.rpc("join_household", { p_invite_code: household.invite_code }));
    expect(joined.id).toBe(household.id);
    expect(await memberRow(household.id, joiner.id)).toMatchObject({
      role: "member", visibility: true, answer_mode: "ask_me", home_confirmed_at: null,
    });
  });

  it("join_household with bad code raises invalid_invite_code; joining a household you're already in raises already_member; joining a second household succeeds", async () => {
    const a = await makeHousehold();
    const b = await makeHousehold();
    const u = a.owner;

    expect((await u.client.rpc("join_household", { p_invite_code: "000000" })).error?.message).toBe("invalid_invite_code");
    expect((await u.client.rpc("join_household", { p_invite_code: a.household.invite_code })).error?.message).toBe("already_member");
    const second = ok(await u.client.rpc("join_household", { p_invite_code: b.household.invite_code }));
    expect(second.id).toBe(b.household.id);
    expect(ok(await admin.from("household_members").select("household_id").eq("user_id", u.id))).toHaveLength(2);
  });

  it("update_home by non-owner raises not_owner; by owner resets other members' home_confirmed_at to null and keeps owner's", async () => {
    const h = await makeHousehold(["Mia", "Leo"]);
    const [mia, leo] = h.members;
    const hid = h.household.id;
    const ownerConfirmed = (await memberRow(hid, h.owner.id)).home_confirmed_at;
    const move = { p_household_id: hid, p_lat: 40.0, p_lng: -74.0, p_radius_m: 200 };

    expect((await mia.client.rpc("update_home", move)).error?.message).toBe("not_owner");
    expect(ok(await admin.from("households").select("home_lat").eq("id", hid).single()).home_lat).toBe(37.4275);
    expect((await memberRow(hid, mia.id)).home_confirmed_at).not.toBeNull();

    ok(await h.owner.client.rpc("update_home", move));
    expect(ok(await admin.from("households").select().eq("id", hid).single()))
      .toMatchObject({ home_lat: 40, home_lng: -74, home_radius_m: 200 });
    expect((await memberRow(hid, mia.id)).home_confirmed_at).toBeNull();
    expect((await memberRow(hid, leo.id)).home_confirmed_at).toBeNull();
    expect((await memberRow(hid, h.owner.id)).home_confirmed_at).toBe(ownerConfirmed);
  });

  it("update_my_settings changes only the caller's visibility/answer_mode, and only in the named household", async () => {
    const a = await makeHousehold(["Mia"]);
    const b = await makeHousehold();
    const [mia] = a.members;
    await joinHousehold(mia, b.household.invite_code);

    ok(await mia.client.rpc("update_my_settings", {
      p_household_id: a.household.id, p_visibility: false, p_answer_mode: "always_auto",
    }));
    expect(await memberRow(a.household.id, mia.id)).toMatchObject({ visibility: false, answer_mode: "always_auto", role: "member" });
    expect(await memberRow(b.household.id, mia.id)).toMatchObject({ visibility: true, answer_mode: "ask_me" });
    expect(await memberRow(a.household.id, a.owner.id)).toMatchObject({ visibility: true, answer_mode: "ask_me" });
  });

  it("household_accuracy raises not_member for non-members; members get per-kind counts", async () => {
    const h = await makeHousehold(["Mia"]);
    const [mia] = h.members;
    const outsider = await newUser("Eve");
    const rows = [
      { kind: "at_time", outcome: "correct" },
      { kind: "at_time", outcome: "incorrect" },
      { kind: "until_when", outcome: "unscored" },
      { kind: "until_when", outcome: null },
    ] as const;
    for (const r of rows) {
      const { questionTargetId } = await makeQuestion(h.household.id, h.owner, mia);
      ok(await admin.from("predictions").insert({
        question_target_id: questionTargetId, user_id: mia.id, kind: r.kind, outcome: r.outcome,
        confidence: "medium", source: "agent_auto",
      }));
    }

    expect((await outsider.client.rpc("household_accuracy", { p_household_id: h.household.id })).error?.message).toBe("not_member");
    const stats = ok(await h.owner.client.rpc("household_accuracy", { p_household_id: h.household.id }));
    expect([...stats].sort((x, y) => x.kind.localeCompare(y.kind))).toEqual([
      { kind: "at_time", correct: 1, incorrect: 1, unscored: 0 },
      { kind: "until_when", correct: 0, incorrect: 0, unscored: 1 },
    ]);
  });
});
