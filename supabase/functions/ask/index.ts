import { AskRequest, type AskResponse, answerForTarget, parseQuestion } from '../../../packages/core/src/index.ts';
import { supabaseHouseholdData } from '../../../packages/core/src/data.ts';
import { adminClient, callerId, fail, json, readJson, serve } from '../_shared/http.ts';
import { modelFromEnv } from '../_shared/model.ts';

const STATUS = { answer: 'answered', escalate: 'awaiting_reply', unknown: 'unknown' } as const;

serve(async (req) => {
  const me = await callerId(req);
  if (!me) return fail(401, 'unauthorized');
  const body = AskRequest.safeParse(await readJson(req));
  if (!body.success) return fail(400, 'invalid_request');
  const { householdId, target, text } = body.data;
  const model = modelFromEnv(Deno.env); // throws (500) before any write if misconfigured

  const admin = adminClient();
  const data = supabaseHouseholdData(admin);
  const household = await data.membership(householdId, me);
  if (!household) return fail(403, 'not_member');

  const others = household.members.filter((m) => m.userId !== me);
  let targets = others;
  if (target !== 'everyone') {
    const ids = [...new Set(target.userIds)];
    if (ids.includes(me)) return fail(400, 'cannot_target_self');
    targets = others.filter((m) => ids.includes(m.userId));
    if (targets.length !== ids.length) return fail(400, 'target_not_member');
  }
  if (targets.length === 0) return fail(400, 'no_targets');

  const now = new Date().toISOString();
  const parsed = await parseQuestion(model, text, now, household.timezone);
  const question = must(await admin.from('questions')
    .insert({ household_id: householdId, asker_id: me, text, kind: parsed.kind, about_time: parsed.aboutTime })
    .select('id').single());

  // shortcut: writes are not one transaction, so a mid-way failure leaves a partial question; move into an RPC if that shows up.
  const results = await Promise.all(targets.map(async (t) => {
    const evidence = await data.evidence(householdId, t.userId, now);
    const r = await answerForTarget(model, {
      question: text, parsed, targetName: t.name, settings: t.settings, evidence, householdWide: target === 'everyone',
    });
    const status = STATUS[r.decision.action];
    const qt = must(await admin.from('question_targets')
      .insert({ question_id: question.id, user_id: t.userId, status, fallback_guess: r.fallbackGuess })
      .select('id').single());

    if (status === 'answered') {
      must(await admin.from('responses')
        .insert({ question_target_id: qt.id, source: 'agent', visibility: 'sent', text: r.askerText! }));
      if (r.logPrediction && r.claim) {
        const c = r.claim;
        must(await admin.from('predictions').insert({
          question_target_id: qt.id, user_id: t.userId, kind: c.kind as 'at_time' | 'until_when', about_time: c.aboutTime,
          predicted_state: c.predictedState, predicted_time: c.predictedTime, confidence: c.confidence, source: 'agent_auto',
        }));
      }
    } else if (status === 'awaiting_reply' && r.draftText) {
      // Drafts are target-only (RLS); the claim travels with it so `reply` can classify feedback and log the prediction.
      must(await admin.from('responses').insert({
        question_target_id: qt.id, source: 'agent', visibility: 'draft', text: r.draftText, draft_claim: r.claim,
      }));
    }

    // Model text reaches the asker only for an answer (D6).
    const askerText = status === 'answered' ? r.askerText
      : status === 'awaiting_reply' ? `Asked ${t.name} — waiting for a reply.`
      : `${t.name}: unknown`;
    return { userId: t.userId, status, text: askerText };
  }));

  return json({ questionId: question.id, targets: results } satisfies AskResponse);
});

function must<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data as T;
}
