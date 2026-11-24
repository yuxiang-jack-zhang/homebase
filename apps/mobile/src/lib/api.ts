import { AskResponse, DeleteAccountResponse, ReplyResponse, type AskRequest, type ReplyRequest } from '@homebase/core/src/contracts';
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase';

/** Error whose message is the server's code (e.g. `not_awaiting_reply`), so `friendlyError` can map it. */
export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

async function call<T>(fn: 'ask' | 'reply' | 'delete-account', body: Record<string, unknown>, schema: { parse: (v: unknown) => T }): Promise<T> {
  let { data, error } = await supabase.functions.invoke(fn, { body });
  // The request never got a response (e.g. iOS -1005 on a stale pooled connection): retry once (D61).
  if (error instanceof FunctionsFetchError) ({ data, error } = await supabase.functions.invoke(fn, { body }));
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const res = error.context as Response;
      const code = await res.json().then((b: { error?: string }) => b.error, () => undefined);
      throw new ApiError(code ?? `http_${res.status}`, res.status);
    }
    throw new ApiError(error.message);
  }
  try {
    return schema.parse(data);
  } catch {
    throw new ApiError('bad_response');
  }
}

export const ask = (req: AskRequest) => call('ask', req, AskResponse);
export const reply = (req: ReplyRequest) => call('reply', req, ReplyResponse);
export const deleteAccount = () => call('delete-account', {}, DeleteAccountResponse);
