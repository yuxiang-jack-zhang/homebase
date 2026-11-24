import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { ask, deleteAccount } from './api';
import { supabase } from './supabase';

jest.mock('./supabase', () => ({ supabase: { functions: { invoke: jest.fn() } } }));
const invoke = jest.mocked(supabase.functions.invoke);

const Q = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const req = { householdId: Q, target: { userId: B }, text: 'are you home?' };
const ok = { data: { questionId: Q, targets: [] }, error: null };

beforeEach(() => invoke.mockReset());

test('retries once when the request never got a response', async () => {
  invoke.mockResolvedValueOnce({ data: null, error: new FunctionsFetchError({}) } as never).mockResolvedValueOnce(ok as never);
  await expect(ask(req as never)).resolves.toEqual(ok.data);
  expect(invoke).toHaveBeenCalledTimes(2);
});

test('gives up after the second network failure', async () => {
  invoke.mockResolvedValue({ data: null, error: new FunctionsFetchError({}) } as never);
  await expect(ask(req as never)).rejects.toThrow('Failed to send a request to the Edge Function');
  expect(invoke).toHaveBeenCalledTimes(2);
});

test('does not retry a server error', async () => {
  const res = new Response(JSON.stringify({ error: 'internal_error' }), { status: 500 });
  invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(res) } as never);
  await expect(ask(req as never)).rejects.toThrow('internal_error');
  expect(invoke).toHaveBeenCalledTimes(1);
});

test('deleteAccount calls delete-account and checks the reply', async () => {
  invoke.mockResolvedValue({ data: { status: 'deleted' }, error: null } as never);
  await expect(deleteAccount()).resolves.toEqual({ status: 'deleted' });
  expect(invoke).toHaveBeenCalledWith('delete-account', { body: {} });
  invoke.mockResolvedValue({ data: { status: 'nope' }, error: null } as never);
  await expect(deleteAccount()).rejects.toThrow('bad_response');
});
