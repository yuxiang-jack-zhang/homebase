import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../packages/core/src/db.types.ts";

export type Client = SupabaseClient<Database>;
export interface TestUser { id: string; email: string; client: Client }

// Keys come from the env or the running local stack; never hard-coded.
function localEnv(): Record<string, string> {
  const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY) {
    return { API_URL: SUPABASE_URL, ANON_KEY: SUPABASE_ANON_KEY, SERVICE_ROLE_KEY: SUPABASE_SERVICE_ROLE_KEY };
  }
  const out = execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return Object.fromEntries(
    [...out.matchAll(/^([A-Z_]+)="?([^"\n]*)"?$/gm)].map(([, k, v]) => [k, v]),
  );
}

const env = localEnv();
export const API_URL = env.API_URL;
export const SERVICE_ROLE_KEY = env.SERVICE_ROLE_KEY;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const PASSWORD = "test-password-123";

/** Service-role client: bypasses RLS. Stands in for the edge functions. */
export const admin: Client = createClient<Database>(env.API_URL, env.SERVICE_ROLE_KEY, opts);

/** Signed-out client (anon key only). */
export const anon: Client = createClient<Database>(env.API_URL, env.ANON_KEY, opts);

/** A supabase-js client signed in as the given test user. */
export async function asUser(email: string): Promise<Client> {
  const client = createClient<Database>(env.API_URL, env.ANON_KEY, opts);
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return client;
}

/** Creates a confirmed user with a profile (display_name metadata) and signs them in. */
export async function newUser(displayName: string): Promise<TestUser> {
  const email = `${displayName.toLowerCase()}-${randomUUID()}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true, user_metadata: { display_name: displayName },
  });
  if (error) throw error;
  return { id: data.user.id, email, client: await asUser(email) };
}

/** Throws on a supabase-js error, otherwise returns the data. */
export function ok<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data;
}

export async function joinHousehold(user: TestUser, inviteCode: string, confirm = true) {
  const household = ok(await user.client.rpc("join_household", { p_invite_code: inviteCode }));
  if (confirm) ok(await user.client.rpc("confirm_home", { p_household_id: household.id }));
  return household;
}

/**
 * A household with a fresh owner plus one fresh member per name.
 * Members confirm the home unless `confirm: false`.
 */
export async function makeHousehold(memberNames: string[] = [], { confirm = true } = {}) {
  const owner = await newUser("Owner");
  const household = ok(await owner.client.rpc("create_household", {
    p_name: "Test home", p_lat: 37.4275, p_lng: -122.1697, p_radius_m: 100, p_timezone: "America/Los_Angeles",
  }));
  const members: TestUser[] = [];
  for (const name of memberNames) {
    const member = await newUser(name);
    await joinHousehold(member, household.invite_code, confirm);
    members.push(member);
  }
  return { household, owner, members };
}

/** Service-role insert of a question about `target` asked by `asker`; returns the question_target id. */
export async function makeQuestion(householdId: string, asker: TestUser, target: TestUser) {
  const question = ok(await admin.from("questions")
    .insert({ household_id: householdId, asker_id: asker.id, text: "Are you home?", kind: "at_time" })
    .select().single());
  const qt = ok(await admin.from("question_targets")
    .insert({ question_id: question.id, user_id: target.id, status: "awaiting_reply" })
    .select().single());
  return { questionId: question.id, questionTargetId: qt.id };
}
