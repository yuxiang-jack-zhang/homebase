import { describe, expect, it } from "vitest";
import { makeHousehold, ok } from "./helpers.ts";

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
