import { type Claim, ReplyRequest, classifyFeedback, shouldLogPrediction } from '../../../packages/core/src/index.ts';
import { adminClient, callerId, errorSummary, fail, json, readJson, serve } from '../_shared/http.ts';

const QUICK = { yes: 'Yes', no: 'No', not_sure: 'Not sure' } as const;

serve(async (req) => {
  const me = await callerId(req);
  if (!me) return fail(401, 'unauthorized');
  const body = ReplyRequest.safeParse(await readJson(req));
  if (!body.success) return fail(400, 'invalid_request');
  const { questionTargetId, action } = body.data;

  const admin = adminClient();
  const { data: qt, error } = await admin.from('question_targets')
    .select('user_id, status, responses(visibility, text, draft_claim)').eq('id', questionTargetId).maybeSingle();
  if (error) throw error;
  // Unknown ids get 403 too, so the endpoint doesn't reveal which question ids exist.
  if (!qt || qt.user_id !== me) return fail(403, 'not_target');
  if (qt.status !== 'awaiting_reply') return fail(409, 'not_awaiting_reply');
  const draft = qt.responses.find((r) => r.visibility === 'draft');
  if (action === 'approve' && !draft) return fail(409, 'no_draft');
  const claim = (draft?.draft_claim ?? null) as Claim | null;
  const text = action === 'approve' ? draft!.text : action === 'text' ? body.data.text! : QUICK[action];

  // Claim the transition first, conditionally, so two concurrent replies can't both send (late replies are fine: no timeout status).
  const { data: claimed, error: e1 } = await admin.from('question_targets')
    .update({ status: 'replied' }).eq('id', questionTargetId).eq('status', 'awaiting_reply').select('id');
  if (e1) throw e1;
  if (claimed.length === 0) return fail(409, 'not_awaiting_reply');

  const { error: e2 } = await admin.from('responses').insert({
    question_target_id: questionTargetId, source: 'human', visibility: 'sent', text, feedback: classifyFeedback(claim, action),
  });
  if (e2) {
    // Put the target back so their reply isn't lost behind a "replied" status with no response.
    await admin.from('question_targets').update({ status: 'awaiting_reply' }).eq('id', questionTargetId);
    throw e2;
  }

  if (action === 'approve' && claim && shouldLogPrediction(claim, new Date().toISOString())) {
    const { error: e3 } = await admin.from('predictions').insert({
      question_target_id: questionTargetId, user_id: me, kind: claim.kind as 'at_time' | 'until_when', about_time: claim.aboutTime,
      predicted_state: claim.predictedState, predicted_time: claim.predictedTime, confidence: claim.confidence, source: 'agent_approved',
    });
    if (e3) console.error('prediction insert failed', errorSummary(e3)); // the reply is already sent; a missing prediction only costs one stats sample
  }

  return json({ status: 'replied' });
});
