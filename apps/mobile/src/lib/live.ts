import type { RealtimeChannel } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import { supabase } from './supabase';

/**
 * Subscribes `channel` and calls `resync` whenever it re-joins after a dropped connection and whenever the
 * app returns to the foreground: realtime does not replay events missed while disconnected (D60).
 * The first join is skipped because callers load once on mount. Returns the cleanup.
 */
export function subscribeLive(channel: RealtimeChannel, resync: () => void): () => void {
  let joined = false;
  channel.subscribe((status) => {
    if (status !== 'SUBSCRIBED') return;
    if (joined) resync();
    joined = true;
  });
  const sub = AppState.addEventListener('change', (s) => { if (s === 'active') resync(); });
  return () => {
    sub.remove();
    supabase.removeChannel(channel);
  };
}
