import { describe, expect, it } from "vitest";
import { supabaseHouseholdData } from "../../packages/core/src/data.ts";
import { admin, joinHousehold, makeHousehold, newUser, ok } from "./helpers.ts";

const NOW = new Date().toISOString();
const daysAgo = (d: number) => new Date(Date.parse(NOW) - d * 86_400_000).toISOString();
const data = supabaseHouseholdData(admin);

describe("supabaseHouseholdData", () => {
  it("evidence() returns only that user's presence in that household from the last 14 days, and their blocks there", async () => {
    const a = await makeHousehold(["Sam"]);
    const b = await makeHousehold();
    const [sam] = a.members;
    await joinHousehold(sam, b.household.invite_code);
    const hid = a.household.id;
    ok(await admin.from("presence_events").insert([
      { household_id: hid, user_id: sam.id, kind: "exit", at: daysAgo(15) },          // too old
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
      presence: [{ kind: "enter", at: daysAgo(2) }, { kind: "exit", at: daysAgo(1) }],
      blocks: [{ daysOfWeek: [1, 3], startLocal: "18:00", endLocal: "21:30", label: "climbing" }],
    });
  });

  it("membership() maps names and settings, and returns null for a non-member or unknown household", async () => {
    const { household, owner, members: [sam] } = await makeHousehold(["Sam"]);
    ok(await sam.client.rpc("update_my_settings", { p_household_id: household.id, p_visibility: false, p_answer_mode: "always_auto" }));
    const outsider = await newUser("Out");

    const m = await data.membership(household.id, sam.id);
    expect(m?.timezone).toBe("America/Los_Angeles");
    expect(m?.members.sort((x, y) => x.name.localeCompare(y.name))).toEqual([
      { userId: owner.id, name: "Owner", settings: { visibility: true, answerMode: "ask_me" } },
      { userId: sam.id, name: "Sam", settings: { visibility: false, answerMode: "always_auto" } },
    ]);
    expect(await data.membership(household.id, outsider.id)).toBeNull();
    expect(await data.membership(crypto.randomUUID(), sam.id)).toBeNull();
  });
});
