import { describe, expect, it } from "vitest";
import { admin, makeHousehold, ok } from "./helpers.ts";

describe("presence dedupe trigger", () => {
  it("skips an event whose kind equals my latest in that household", async () => {
    const { household, owner } = await makeHousehold();
    const put = async (kind: "enter" | "exit") =>
      ok(await owner.client.from("presence_events").insert({ household_id: household.id, user_id: owner.id, kind }));
    const count = async () =>
      ok(await owner.client.from("presence_events").select().eq("household_id", household.id)).length;

    await put("enter");
    await put("enter");
    expect(await count()).toBe(1);
    await put("exit");
    expect(await count()).toBe(2);
    await put("enter");
    expect(await count()).toBe(3);
  });
});

describe("presence insert limits (finding 5)", () => {
  it("the server sets `at` on a member's insert, so history can't be backdated (or post-dated)", async () => {
    const { household, owner } = await makeHousehold();
    const sent = Date.now();
    for (const [kind, at] of [["enter", "2020-01-01T00:00:00Z"], ["exit", new Date(sent + 30_000).toISOString()]] as const) {
      const row = ok(await owner.client.from("presence_events")
        .insert({ household_id: household.id, user_id: owner.id, kind, at }).select("at").single());
      expect(Math.abs(Date.parse(row.at) - sent)).toBeLessThan(15_000);
    }
  });

  it("caps a member at 60 events per household per hour with rate_limited; the service role is not capped", async () => {
    const { household, owner } = await makeHousehold();
    const rows = (n: number, first: number) => Array.from({ length: n }, (_, i) => ({
      household_id: household.id, user_id: owner.id, kind: (first + i) % 2 === 0 ? "enter" as const : "exit" as const,
    }));
    ok(await owner.client.from("presence_events").insert(rows(60, 0)));

    const over = await owner.client.from("presence_events").insert(rows(1, 0));
    expect(over.error?.message).toBe("rate_limited");
    ok(await admin.from("presence_events").insert(rows(1, 0)));
    expect(ok(await admin.from("presence_events").select("id").eq("user_id", owner.id))).toHaveLength(61);
  });
});
