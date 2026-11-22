import { timingSafeEqual } from 'node:crypto';
import { scoreClaim } from '../../../packages/core/src/index.ts';
import { adminClient, fail, json, serve } from '../_shared/http.ts';

const HOUR = 3_600_000;

/** Service role only (D39): the bearer must be the service-role key itself. */
function isServiceRole(req: Request): boolean {
  const got = new TextEncoder().encode(req.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '');
  const want = new TextEncoder().encode(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  return want.length > 0 && got.length === want.length && timingSafeEqual(got, want);
}

serve(async (req) => {
  if (!isServiceRole(req)) return fail(403, 'forbidden');
  const admin = adminClient();
  const now = new Date().toISOString();

  const { data: preds, error } = await admin.from('predictions')
    .select('id, user_id, kind, about_time, predicted_state, predicted_time, question_targets(created_at, questions(household_id))')
    .is('scored_at', null);
  if (error) throw error;

  let scored = 0;
  // shortcut: one presence query per prediction; batch per member if the backlog of unscored predictions grows.
  for (const p of preds) {
    const householdId = p.question_targets.questions.household_id;
    // Anchor at question time, not prediction time: an approved prediction is created when the member replies,
    // and an arrival between the question and the approval still counts (D56).
    const askedAt = p.question_targets.created_at;
    const since = new Date(Date.parse(askedAt) - 48 * HOUR).toISOString();
    const events = () => admin.from('presence_events').select('kind, at').eq('household_id', householdId).eq('user_id', p.user_id);
    const [before, recent] = await Promise.all([
      events().lt('at', since).order('at', { ascending: false }).limit(1), // the state going into the window
      events().gte('at', since).lte('at', now),
    ]);
    if (before.error) throw before.error;
    if (recent.error) throw recent.error;
    const outcome = scoreClaim({
      kind: p.kind as 'at_time' | 'until_when', aboutTime: p.about_time,
      predictedState: p.predicted_state as 'home' | 'away' | null, predictedTime: p.predicted_time, createdAt: askedAt,
    }, [...before.data, ...recent.data], now);
    if (outcome === 'pending') continue;
    const { error: e2 } = await admin.from('predictions').update({ outcome, scored_at: now }).eq('id', p.id);
    if (e2) throw e2;
    scored++;
  }
  return json({ scored });
});
