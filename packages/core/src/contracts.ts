import { z } from "zod";

const text = z.string().min(1).max(280);

/**
 * Caps on `ask`, which spends API credits: per asker over rolling windows (429), plus a global circuit breaker so a
 * flood from many accounts can't drain the credits (503). maxTargets caps model calls per question ("everyone" too).
 */
export const ASK_LIMITS = { perHour: 30, perDay: 200, globalPerDay: 3000, maxTargets: 20 } as const;

export const AskRequest = z.object({
  householdId: z.uuid(),
  target: z.union([z.object({ userIds: z.array(z.uuid()).max(ASK_LIMITS.maxTargets) }), z.literal("everyone")]),
  text,
});
export type AskRequest = z.infer<typeof AskRequest>;

export const AskResponse = z.object({
  questionId: z.uuid(),
  targets: z.array(z.object({
    userId: z.uuid(),
    status: z.enum(["answered", "awaiting_reply", "unknown"]),
    text: z.string().nullable(),
  })),
});
export type AskResponse = z.infer<typeof AskResponse>;

const ReplyActionSchema = z.enum(["approve", "yes", "no", "not_sure", "text"]);

export const ReplyRequest = z.object({
  questionTargetId: z.uuid(),
  action: ReplyActionSchema,
  text: text.optional(),
}).refine((r) => (r.action === "text") === (r.text !== undefined), {
  message: "text is required if and only if action is 'text'",
  path: ["text"],
});
export type ReplyRequest = z.infer<typeof ReplyRequest>;

export const ReplyResponse = z.object({ status: z.literal("replied") });
export type ReplyResponse = z.infer<typeof ReplyResponse>;
