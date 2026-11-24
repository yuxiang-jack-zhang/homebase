import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './db.types.ts';
import { EVIDENCE_DAYS } from './patterns.ts';
import type { Evidence, MemberSettings } from './types.ts';

export interface Membership { timezone: string; members: { userId: string; name: string; settings: MemberSettings; joinedAt: string | null }[] }

export interface HouseholdData {
  /** null = the user is not a member (or the household does not exist). */
  membership(householdId: string, userId: string): Promise<Membership | null>;
  /**
   * That household's presence for the user over the last EVIDENCE_DAYS (56) days plus the latest event before (the state going in),
   * keeping only events after the last one recorded while hidden (so a hidden window reads as unknown), and their blocks there.
   * `visibleFrom` (the asker's join time) drops everything earlier, so answers can't reveal presence the asker can't see.
   */
  evidence(householdId: string, userId: string, now: string, visibleFrom?: string): Promise<Evidence>;
}

const DAY = 86_400_000;
const RECENT_CAP = 1000;

// supabase-js types data as nullable on the error branch; after the error check it is the row(s).
function must<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data as T;
}

/** Reads with a service-role client: callers must check membership first, RLS is not protecting these reads. */
export function supabaseHouseholdData(admin: SupabaseClient<Database>): HouseholdData {
  return {
    async membership(householdId, userId) {
      const { data: h, error } = await admin.from('households')
        .select('timezone, household_members(user_id, visibility, answer_mode, joined_at, profiles(display_name))')
        .eq('id', householdId).eq('household_members.status', 'active').maybeSingle(); // pending requests aren't members
      if (error) throw error;
      if (!h || !h.household_members.some((m) => m.user_id === userId)) return null;
      return {
        timezone: h.timezone,
        members: h.household_members.map((m) => ({
          userId: m.user_id, name: m.profiles.display_name,
          settings: { visibility: m.visibility, answerMode: m.answer_mode }, joinedAt: m.joined_at,
        })),
      };
    },

    async evidence(householdId, userId, now, visibleFrom) {
      const since = new Date(Date.parse(now) - EVIDENCE_DAYS * DAY).toISOString();
      const events = () => {
        const q = admin.from('presence_events').select('kind, at, visible').eq('household_id', householdId).eq('user_id', userId);
        return visibleFrom ? q.gte('at', visibleFrom) : q;
      };
      const [h, before, recent, blocks] = await Promise.all([
        admin.from('households').select('timezone').eq('id', householdId).single(),
        events().lt('at', since).order('at', { ascending: false }).order('id', { ascending: false }).limit(1),
        // Newest first with an explicit cap (PostgREST returns at most 1000 rows): if history is cut, the oldest goes, never today's.
        events().gte('at', since).order('at', { ascending: false }).order('id', { ascending: false }).limit(RECENT_CAP),
        admin.from('away_blocks').select('days_of_week, start_local, end_local, label')
          .eq('household_id', householdId).eq('user_id', userId),
      ]);
      // Questions are always about another member, so presence recorded while hidden (and anything before it) is never evidence (D55).
      const window = must(recent).reverse();
      // A full page means older events in the window were cut, so the "state going in" event would sit after a gap.
      const all = [...(window.length === RECENT_CAP ? [] : must(before)), ...window];
      const visible = all.slice(all.map((e) => e.visible).lastIndexOf(false) + 1);
      return {
        now,
        timezone: must(h).timezone,
        presence: visible.map((e) => ({ kind: e.kind, at: new Date(e.at).toISOString() })),
        blocks: must(blocks).map((b) => ({
          daysOfWeek: b.days_of_week, startLocal: b.start_local.slice(0, 5), endLocal: b.end_local.slice(0, 5),
          ...(b.label ? { label: b.label } : {}),
        })),
      };
    },
  };
}
