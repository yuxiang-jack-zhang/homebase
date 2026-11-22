import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './db.types.ts';
import type { Evidence, MemberSettings } from './types.ts';

export interface Membership { timezone: string; members: { userId: string; name: string; settings: MemberSettings }[] }

export interface HouseholdData {
  /** null = the user is not a member (or the household does not exist). */
  membership(householdId: string, userId: string): Promise<Membership | null>;
  /** That household's presence for the user over the last 14 days, plus their blocks in that household. */
  evidence(householdId: string, userId: string, now: string): Promise<Evidence>;
}

const DAY = 86_400_000;

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
        .select('timezone, household_members(user_id, visibility, answer_mode, profiles(display_name))')
        .eq('id', householdId).maybeSingle();
      if (error) throw error;
      if (!h || !h.household_members.some((m) => m.user_id === userId)) return null;
      return {
        timezone: h.timezone,
        members: h.household_members.map((m) => ({
          userId: m.user_id, name: m.profiles.display_name,
          settings: { visibility: m.visibility, answerMode: m.answer_mode },
        })),
      };
    },

    async evidence(householdId, userId, now) {
      const [h, presence, blocks] = await Promise.all([
        admin.from('households').select('timezone').eq('id', householdId).single(),
        admin.from('presence_events').select('kind, at')
          .eq('household_id', householdId).eq('user_id', userId)
          .gte('at', new Date(Date.parse(now) - 14 * DAY).toISOString()).order('at'),
        admin.from('away_blocks').select('days_of_week, start_local, end_local, label')
          .eq('household_id', householdId).eq('user_id', userId),
      ]);
      return {
        now,
        timezone: must(h).timezone,
        presence: must(presence).map((e) => ({ kind: e.kind, at: new Date(e.at).toISOString() })),
        blocks: must(blocks).map((b) => ({
          daysOfWeek: b.days_of_week, startLocal: b.start_local.slice(0, 5), endLocal: b.end_local.slice(0, 5),
          ...(b.label ? { label: b.label } : {}),
        })),
      };
    },
  };
}
