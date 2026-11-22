import Anthropic from '@anthropic-ai/sdk';
import { anthropicModel } from '../../../packages/core/src/agent/anthropic.ts';
import { keywordFakeModel, type ModelClient } from '../../../packages/core/src/agent/model.ts';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', 'kong', 'host.docker.internal']);

export function isLocalUrl(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** The fake model only runs against a local stack (D38), so a stray env var can't fake answers in production. */
export function modelFromEnv(env: { get(key: string): string | undefined }): ModelClient {
  if (env.get('ANTHROPIC_FAKE') === '1') {
    if (!isLocalUrl(env.get('SUPABASE_URL') ?? '')) throw new Error('ANTHROPIC_FAKE=1 is only allowed against a local Supabase');
    return keywordFakeModel();
  }
  const apiKey = env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  // Bounded so a slow model cannot hang `ask`: 20 s per attempt and one retry (SDK default is 2 retries); a failure escalates.
  return anthropicModel(new Anthropic({ apiKey, timeout: 20_000, maxRetries: 1 }));
}
