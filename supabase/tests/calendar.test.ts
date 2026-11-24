import { describe, expect, it } from "vitest";
import { admin, anon, makeHousehold, newUser, ok } from "./helpers.ts";

const H = 3_600_000;
const fromNow = (ms: number) => new Date(Date.now() + ms).toISOString();
const span = (fromH: number, toH: number) => ({ start: fromNow(fromH * H), end: fromNow(toH * H) });
const rowsOf = async (userId: string) =>
  ok(await admin.from("calendar_away").select("starts_at, ends_at").eq("user_id", userId).order("starts_at"));

describe("calendar_away (0012)", () => {
  it("sync_calendar_away replaces only the caller's future periods; past ones and other people's stay", async () => {
    const [ann, bob] = [await newUser("Ann"), await newUser("Bob")];
    ok(await admin.from("calendar_away").insert([
      { user_id: ann.id, starts_at: fromNow(-3 * H), ends_at: fromNow(-2 * H) }, // ended: kept
      { user_id: ann.id, starts_at: fromNow(1 * H), ends_at: fromNow(2 * H) },   // future: replaced
      { user_id: bob.id, starts_at: fromNow(1 * H), ends_at: fromNow(2 * H) },   // someone else's
    ]));

    ok(await ann.client.rpc("sync_calendar_away", { p_periods: [span(-0.5, 1), span(24, 32)] }));

    const rows = await rowsOf(ann.id);
    expect(rows).toHaveLength(3);
    expect(Date.parse(rows[0].ends_at)).toBeLessThan(Date.now());
    expect(rows.slice(1).map((r) => Date.parse(r.ends_at) - Date.parse(r.starts_at))).toEqual([1.5 * H, 8 * H]);
    expect(await rowsOf(bob.id)).toHaveLength(1);

    ok(await ann.client.rpc("sync_calendar_away", { p_periods: [] })); // unselecting every calendar clears the future
    expect(await rowsOf(ann.id)).toHaveLength(1);
  });

  it("rejects bad lists with invalid_periods and changes nothing", async () => {
    const ann = await newUser("Ann");
    ok(await ann.client.rpc("sync_calendar_away", { p_periods: [span(1, 2)] }));
    const many = (n: number) => Array.from({ length: n }, (_, i) => span(i + 1, i + 1.5));
    for (const p_periods of [
      {}, [1], [{ start: "nope", end: "x" }], [{ start: fromNow(H) }],
      [{ start: fromNow(H), end: fromNow(H + 30_000) }], // under a minute
      [span(1, 25.1)],                                  // over 24 hours
      [span(2, 1)],                                     // ends before it starts
      [span(16 * 24, 16 * 24 + 1)],                     // starts after 15 days
      many(201),
    ]) {
      expect((await ann.client.rpc("sync_calendar_away", { p_periods })).error?.message).toBe("invalid_periods");
    }
    expect(await rowsOf(ann.id)).toHaveLength(1);
    ok(await ann.client.rpc("sync_calendar_away", { p_periods: many(200) }));
    expect(await rowsOf(ann.id)).toHaveLength(200);
  });

  it("each person reads only their own periods, even a roommate; nobody writes rows directly", async () => {
    const { members: [sam, mia] } = await makeHousehold(["Sam", "Mia"]);
    ok(await sam.client.rpc("sync_calendar_away", { p_periods: [span(1, 2)] }));
    expect(ok(await sam.client.from("calendar_away").select("user_id")).map((r) => r.user_id)).toEqual([sam.id]);
    expect(ok(await mia.client.from("calendar_away").select())).toEqual([]);
    const insert = await mia.client.from("calendar_away").insert({ user_id: mia.id, starts_at: fromNow(H), ends_at: fromNow(2 * H) });
    expect(insert.error?.code).toBe("42501");
    const del = await sam.client.from("calendar_away").delete().eq("user_id", sam.id);
    expect(del.error?.code).toBe("42501");
  });

  it("signed-out (anon) callers can neither read nor sync", async () => {
    expect((await anon.from("calendar_away").select()).error?.code).toBe("42501");
    const res = await anon.rpc("sync_calendar_away", { p_periods: [] });
    expect(res.error?.code).toBe("42501");
    expect(res.error?.message).toMatch(/^permission denied for function/);
  });
});
