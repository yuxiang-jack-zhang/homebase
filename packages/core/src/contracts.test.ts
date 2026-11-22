import { describe, expect, it } from "vitest";
import { AskRequest, ReplyRequest } from "./contracts.ts";

const id = "123e4567-e89b-42d3-a456-426614174000";

describe("ReplyRequest", () => {
  it("requires text when action is text", () => {
    expect(ReplyRequest.safeParse({ questionTargetId: id, action: "text" }).success).toBe(false);
    expect(ReplyRequest.safeParse({ questionTargetId: id, action: "text", text: "hi" }).success).toBe(true);
  });
  it("accepts yes without text", () => {
    expect(ReplyRequest.safeParse({ questionTargetId: id, action: "yes" }).success).toBe(true);
  });
  it("rejects text longer than 280", () => {
    expect(ReplyRequest.safeParse({ questionTargetId: id, action: "text", text: "x".repeat(281) }).success).toBe(false);
  });
});

describe("AskRequest", () => {
  const base = { householdId: id, target: "everyone" as const };
  it("accepts everyone and user lists", () => {
    expect(AskRequest.safeParse({ ...base, text: "home?" }).success).toBe(true);
    expect(AskRequest.safeParse({ ...base, target: { userIds: [id] }, text: "home?" }).success).toBe(true);
  });
  it("rejects empty and 281-char text", () => {
    expect(AskRequest.safeParse({ ...base, text: "" }).success).toBe(false);
    expect(AskRequest.safeParse({ ...base, text: "x".repeat(281) }).success).toBe(false);
    expect(AskRequest.safeParse({ ...base, text: "x".repeat(280) }).success).toBe(true);
  });
});
