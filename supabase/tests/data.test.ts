import { describe, expect, it } from "vitest";
import { supabaseHouseholdData } from "../../packages/core/src/data.ts";
import { admin, joinHousehold, makeHousehold, newUser, ok, requestJoin } from "./helpers.ts";

const NOW = new Date().toISOString();
const daysAgo = (d: number) => new Date(Date.parse(NOW) - d * 86_400_000).toISOString();
const data = supabaseHouseholdData(admin);

describe("supabaseHouseholdData", () => {
  it("evidence() returns that user's presence in that household from the last 56 days (EVIDENCE_DAYS) plus the latest event before, and their blocks there", async () => {
    const a = await makeHousehold(["Sam"]);
    const b = await makeHousehold();
    const [sam] = a.members;
    await joinHousehold(sam, b.household.invite_code);
    const hid = a.household.id;
    ok(await admin.from("presence_events").insert([
      { household_id: hid, user_id: sam.id, kind: "enter", at: daysAgo(70) },         // too old
      { household_id: hid, user_id: sam.id, kind: "exit", at: daysAgo(60) },          // latest before the window: the state going in
      { household_id: hid, user_id: sam.id, kind: "enter", at: daysAgo(40) },          // inside 56 days, outside the old 14
      { household_id: hid, user_id: sam.id, kind: "exit", at: daysAgo(3) },
      { household_id: hid, user_id: sam.id, kind: "enter", at: daysAgo(2) },
      { household_id: hid, user_id: sam.id, kind: "exit", at: daysAgo(1) },
      { household_id: b.household.id, user_id: sam.id, kind: "enter", at: daysAgo(1) }, // other household
      { household_id: hid, user_id: a.owner.id, kind: "enter", at: daysAgo(1) },        // other user
    ]));
    ok(await admin.from("away_blocks").insert([
      { household_id: hid, user_id: sam.id, days_of_week: [1, 3], start_local: "18:00", end_local: "21:30", label: "climbing" },
      { household_id: b.household.id, user_id: sam.id, days_of_week: [2], start_local: "09:00", end_local: "17:00" },
      { household_id: hid, user_id: a.owner.id, days_of_week: [2], start_local: "09:00", end_local: "17:00" },
    ]));

    const ev = await data.evidence(hid, sam.id, NOW);

    expect(ev).toEqual({
      now: NOW,
      timezone: "America/Los_Angeles",
      presence: [{ kind: "exit", at: daysAgo(60) }, { kind: "enter", at: daysAgo(40) }, { kind: "exit", at: daysAgo(3) }, { kind: "enter", at: daysAgo(2) }, { kind: "exit", at: daysAgo(1) }],
      blocks: [{ daysOfWeek: [1, 3], startLocal: "18:00", endLocal: "21:30", label: "climbing", createdAt: expect.any(String) }],
      awayPeriods: [],
    });
  });

  it("evidence() returns the user's calendar away periods overlapping the next 2 days, in every household they're in", async () => {
    const a = await makeHousehold(["Sam"]);
    const b = await makeHousehold();
    const [sam] = a.members;
    await joinHousehold(sam, b.household.invite_code);
    const now = new Date().toISOString();
    const h = (n: number) => new Date(Date.parse(now) + n * 3_600_000).toISOString();
    ok(await admin.from("calendar_away").insert([
      { user_id: sam.id, starts_at: h(-3), ends_at: h(-1) },   // ended
      { user_id: sam.id, starts_at: h(-1), ends_at: h(2) },    // under way
      { user_id: sam.id, starts_at: h(30), ends_at: h(38) },   // tomorrow
      { user_id: sam.id, starts_at: h(49), ends_at: h(50) },   // after 2 days
      { user_id: a.owner.id, starts_at: h(1), ends_at: h(2) }, // someone else
    ]));
    const want = [{ start: h(-1), end: h(2) }, { start: h(30), end: h(38) }];
    expect((await data.evidence(a.household.id, sam.id, now)).awayPeriods).toEqual(want);
    expect((await data.evidence(b.household.id, sam.id, now)).awayPeriods).toEqual(want);
  });

  it("evidence() never uses presence recorded while hidden, nor anything before it (C1)", async () => {
    const { household, members: [sam] } = await makeHousehold(["Sam"]);
    const hid = household.id;
    const setVisible = async (v: boolean) =>
      ok(await sam.client.rpc("update_my_settings", { p_household_id: hid, p_visibility: v, p_answer_mode: "ask_me" }));
    // Service role: a member's own insert is stamped now() (0009). The trigger still stamps visibility.
    const ins = async (kind: "enter" | "exit", at: string) =>
      ok(await admin.from("presence_events").insert({ household_id: hid, user_id: sam.id, kind, at }));
    await ins("exit", daysAgo(20));  // visible, before the window
    await ins("enter", daysAgo(3));  // visible
    await setVisible(false);
    await ins("exit", daysAgo(2));   // hidden
    await ins("enter", daysAgo(1));  // hidden, latest
    expect((await data.evidence(hid, sam.id, NOW)).presence).toEqual([]);

    await setVisible(true); // reveals the current state as a new event at the unhide time
    const now = new Date().toISOString();
    const [revealed, ...rest] = (await data.evidence(hid, sam.id, now)).presence;
    expect(rest).toEqual([]);
    expect(revealed.kind).toBe("enter");
    expect(Math.abs(Date.parse(revealed.at) - Date.parse(now))).toBeLessThan(60_000);
  });

  it("evidence() keeps the latest event before the window when the window is empty", async () => {
    const { household, members: [sam] } = await makeHousehold(["Sam"]);
    ok(await admin.from("presence_events").insert({ household_id: household.id, user_id: sam.id, kind: "enter", at: daysAgo(30) }));
    expect((await data.evidence(household.id, sam.id, NOW)).presence).toEqual([{ kind: "enter", at: daysAgo(30) }]);
  });

  it("evidence() keeps the newest events when there are more than the API returns in one response (1000)", async () => {
    const { household, members: [sam] } = await makeHousehold(["Sam"]);
    // 1200 events over the last ~50 days (a phone flapping at the geofence edge), newest is an exit an hour ago.
    const rows = Array.from({ length: 1200 }, (_, i) => ({
      household_id: household.id, user_id: sam.id, kind: (i % 2 ? "exit" : "enter") as "enter" | "exit",
      at: new Date(Date.parse(NOW) - (1200 - i) * 3_600_000).toISOString(),
    }));
    ok(await admin.from("presence_events").insert(rows));
    const p = (await data.evidence(household.id, sam.id, NOW)).presence;
    expect(p.at(-1)).toEqual({ kind: "exit", at: rows.at(-1)!.at });
    expect(p.length).toBeGreaterThanOrEqual(1000);
  });

  it("evidence() with visibleFrom drops everything before it, including the state going in (pre-join history)", async () => {
    const { household, members: [sam] } = await makeHousehold(["Sam"]);
    ok(await admin.from("presence_events").insert([
      { household_id: household.id, user_id: sam.id, kind: "exit", at: daysAgo(30) },
      { household_id: household.id, user_id: sam.id, kind: "enter", at: daysAgo(5) },
      { household_id: household.id, user_id: sam.id, kind: "exit", at: daysAgo(1) },
    ]));
    expect((await data.evidence(household.id, sam.id, NOW, daysAgo(3))).presence).toEqual([{ kind: "exit", at: daysAgo(1) }]);
    expect((await data.evidence(household.id, sam.id, NOW, daysAgo(0.5))).presence).toEqual([]);
  });

  it("membership() reports each member's joinedAt", async () => {
    const { household, owner } = await makeHousehold();
    const m = await data.membership(household.id, owner.id);
    expect(typeof m?.members[0].joinedAt).toBe("string");
  });

  it("membership() maps names and settings, and returns null for a non-member or unknown household", async () => {
    const { household, owner, members: [sam] } = await makeHousehold(["Sam"]);
    ok(await sam.client.rpc("update_my_settings", { p_household_id: household.id, p_visibility: false, p_answer_mode: "always_auto" }));
    const outsider = await newUser("Out");

    const m = await data.membership(household.id, sam.id);
    expect(m?.timezone).toBe("America/Los_Angeles");
    expect(m?.members.sort((x, y) => x.name.localeCompare(y.name))).toEqual([
      { userId: owner.id, name: "Owner", settings: { visibility: true, answerMode: "ask_me" }, joinedAt: expect.any(String) },
      { userId: sam.id, name: "Sam", settings: { visibility: false, answerMode: "always_auto" }, joinedAt: expect.any(String) },
    ]);
    expect(await data.membership(household.id, outsider.id)).toBeNull();
    expect(await data.membership(crypto.randomUUID(), sam.id)).toBeNull();
  });

  it("membership() ignores pending requests: a pending user is not a member and is not listed to others", async () => {
    const { household, owner } = await makeHousehold();
    const asking = await newUser("Pat");
    expect(await requestJoin(asking, household.invite_code)).toMatchObject({ id: household.id });

    expect(await data.membership(household.id, asking.id)).toBeNull();
    expect((await data.membership(household.id, owner.id))?.members.map((m) => m.userId)).toEqual([owner.id]);
  });
});
