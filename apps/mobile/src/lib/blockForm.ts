const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface BlockInput { days: number[]; start: string; end: string; label: string }
export type BlockResult =
  | { ok: true; value: { days_of_week: number[]; start_local: string; end_local: string; label: string | null } }
  | { ok: false; error: string };

export const crossesMidnight = (start: string, end: string) => HHMM.test(start) && HHMM.test(end) && end < start;

export function validateBlock({ days, start, end, label }: BlockInput): BlockResult {
  if (days.length === 0) return { ok: false, error: 'Pick at least one day.' };
  if (!HHMM.test(start) || !HHMM.test(end)) return { ok: false, error: 'Use 24-hour times like 09:00.' };
  if (start === end) return { ok: false, error: 'Start and end must differ.' };
  const l = label.trim();
  if (l.length > 40) return { ok: false, error: 'Label is at most 40 characters.' };
  return { ok: true, value: { days_of_week: [...days].sort(), start_local: start, end_local: end, label: l || null } };
}
