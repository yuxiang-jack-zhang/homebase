import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../../packages/core/src/db.types.ts';

export const json = (body: unknown, status = 200) => Response.json(body, { status });
export const fail = (status: number, error: string) => json({ error }, status);

const url = () => Deno.env.get('SUPABASE_URL')!;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

/** Service-role client: bypasses RLS. Every write goes through it; check authorization first. */
export const adminClient = () => createClient<Database>(url(), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, opts);

/** The caller's user id from their JWT, verified by Auth; never taken from the body. */
export async function callerId(req: Request): Promise<string | null> {
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer /, '');
  if (!jwt) return null;
  const { data, error } = await createClient(url(), Deno.env.get('SUPABASE_ANON_KEY')!, opts).auth.getUser(jwt);
  return error ? null : data.user.id;
}

export async function readJson(req: Request): Promise<unknown> {
  return await req.json().catch(() => undefined);
}

/**
 * What may be logged about an error: name, code and message only. Postgres errors carry the failing row in
 * `details` ("Failing row contains (…)"), which can hold question or reply text, so that and `hint` are dropped.
 */
export function errorSummary(e: unknown): { name?: string; code?: string; message?: string } {
  const x = (e ?? {}) as { name?: unknown; code?: unknown; message?: unknown };
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  return { name: str(x.name), code: str(x.code), message: typeof e === 'string' ? e : str(x.message) };
}

/** Wraps a handler: wrong method -> 405, uncaught error -> logged 500 without details. */
export function serve(handler: (req: Request) => Promise<Response>) {
  Deno.serve(async (req) => {
    if (req.method !== 'POST') return fail(405, 'method_not_allowed');
    try {
      return await handler(req);
    } catch (e) {
      console.error('unhandled error', errorSummary(e));
      return fail(500, 'internal_error');
    }
  });
}
