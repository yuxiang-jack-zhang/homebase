import { adminClient, callerId, fail, json, serve } from '../_shared/http.ts';

// Deletes the caller's account. A trigger on profiles (0008) hands each owned household to the next member,
// or deletes it if they were the last; the cascades remove the rest.
serve(async (req) => {
  const me = await callerId(req);
  if (!me) return fail(401, 'unauthorized');
  const { error } = await adminClient().auth.admin.deleteUser(me);
  if (error) throw error;
  return json({ status: 'deleted' });
});
